import {
  createWriteStream,
  createReadStream,
  existsSync,
  statSync,
  readFileSync,
  writeFileSync,
  rmSync,
  renameSync,
  mkdirSync
} from 'fs'
import { dirname } from 'path'
import { createHash } from 'crypto'
import { once } from 'events'

// Загрузчик больших файлов (движок 1,4 ГБ, модель до 3 ГБ) для медленной и
// рвущейся сети: качает несколькими параллельными кусками (Range), после обрыва
// или отмены продолжает с места остановки, в конце сверяет sha256.
// Каждый запрос идёт по ИСХОДНОЙ ссылке: подписанные ссылки GitHub/HF на CDN
// живут минуты, а загрузка — часы.

export interface DlProgress {
  done: number
  total: number
  bytesPerSec: number
}

export interface DlOptions {
  segments?: number
  signal?: AbortSignal
  onProgress?: (p: DlProgress) => void
  sha256?: string
  /** сколько обрывов подряд без прогресса терпим на один кусок */
  retries?: number
  retryDelayMs?: number
  progressIntervalMs?: number
  /** только для тестов: пауза после каждого принятого блока */
  chunkThrottleMs?: number
}

interface Probe {
  size: number | null
  ranges: boolean
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function probe(url: string, signal?: AbortSignal): Promise<Probe> {
  // Не HEAD: часть CDN его не любит. Просим первый байт — по ответу 206 видно и
  // размер, и поддержку докачки.
  const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal })
  try {
    if (res.status === 206) {
      const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')
      return { size: m ? Number(m[1]) : null, ranges: !!m }
    }
    if (res.ok) {
      const len = res.headers.get('content-length')
      return { size: len ? Number(len) : null, ranges: false }
    }
    throw new Error(`Сервер ответил ${res.status}`)
  } finally {
    await res.body?.cancel().catch(() => {})
  }
}

function partSize(file: string): number {
  return existsSync(file) ? statSync(file).size : 0
}

async function pump(
  url: string,
  file: string,
  range: string | null,
  o: DlOptions,
  onBytes: (n: number) => void
): Promise<void> {
  const res = await fetch(url, {
    headers: range ? { Range: range } : {},
    redirect: 'follow',
    signal: o.signal
  })
  if (range ? res.status !== 206 : !res.ok) {
    await res.body?.cancel().catch(() => {})
    throw new Error(`Сервер ответил ${res.status}`)
  }
  const ws = createWriteStream(file, { flags: range ? 'a' : 'w' })
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!ws.write(chunk)) await once(ws, 'drain')
      onBytes(chunk.length)
      if (o.chunkThrottleMs) await sleep(o.chunkThrottleMs)
    }
  } finally {
    await new Promise<void>((r) => ws.end(() => r()))
  }
}

async function sha256Of(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}

export async function downloadFile(url: string, dest: string, o: DlOptions = {}): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true })
  const stateFile = dest + '.dl.json'
  const p = await probe(url, o.signal)
  const segments = p.ranges && p.size ? Math.max(1, Math.min(o.segments ?? 4, 16)) : 1
  const total = p.size ?? 0

  // Состояние прошлой попытки годится, только если файл тот же (размер) и
  // нарезка та же. Иначе — начинаем с чистого листа.
  let reuse = false
  try {
    const st = JSON.parse(readFileSync(stateFile, 'utf8')) as { size: number; segments: number }
    reuse = p.ranges && st.size === total && st.segments === segments
  } catch {
    reuse = false
  }
  const parts = Array.from({ length: segments }, (_, i) => `${dest}.part${i}`)
  if (!reuse) for (const f of parts) rmSync(f, { force: true })
  writeFileSync(stateFile, JSON.stringify({ url, size: total, segments }), 'utf8')

  const bounds = parts.map((_, i) => {
    const per = Math.ceil(total / segments)
    const start = i * per
    const end = Math.min(total, start + per) - 1
    return { start, end }
  })

  let done = parts.reduce((s, f) => s + partSize(f), 0)
  const interval = o.progressIntervalMs ?? 200
  let lastEmit = 0
  const window: { t: number; d: number }[] = [{ t: Date.now(), d: done }]
  const emit = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmit < interval) return
    lastEmit = now
    window.push({ t: now, d: done })
    while (window.length > 2 && now - window[0].t > 5000) window.shift()
    const dt = (now - window[0].t) / 1000
    o.onProgress?.({ done, total, bytesPerSec: dt > 0 ? (done - window[0].d) / dt : 0 })
  }
  emit(true)
  const onBytes = (n: number): void => {
    done += n
    emit()
  }

  const runSegment = async (i: number): Promise<void> => {
    const { start, end } = bounds[i]
    let failures = 0
    for (;;) {
      if (o.signal?.aborted) throw new Error('Загрузка остановлена')
      if (!p.ranges) {
        // Без докачки: каждый раз с нуля.
        done -= partSize(parts[i])
        rmSync(parts[i], { force: true })
      }
      const have = partSize(parts[i])
      if (p.ranges && have >= end - start + 1) return
      const before = done
      try {
        await pump(url, parts[i], p.ranges ? `bytes=${start + have}-${end}` : null, o, onBytes)
        if (!p.ranges) return
      } catch (err) {
        if (o.signal?.aborted) throw new Error('Загрузка остановлена')
        failures = done > before ? 1 : failures + 1
        if (failures > (o.retries ?? 8)) throw err
        await sleep((o.retryDelayMs ?? 2000) * Math.min(failures, 5))
      }
    }
  }

  await Promise.all(parts.map((_, i) => runSegment(i)))
  emit(true)

  // Склейка → проверка → готовый файл появляется только целым.
  const tmp = dest + '.tmp'
  const out = createWriteStream(tmp)
  for (const f of parts) {
    for await (const chunk of createReadStream(f)) {
      if (!out.write(chunk)) await once(out, 'drain')
    }
  }
  await new Promise<void>((r) => out.end(() => r()))
  const cleanup = (): void => {
    for (const f of parts) rmSync(f, { force: true })
    rmSync(stateFile, { force: true })
  }
  const size = statSync(tmp).size
  if (total && size !== total) {
    rmSync(tmp, { force: true })
    cleanup()
    throw new Error(`Файл скачался не полностью (${size} из ${total} байт). Попробуйте ещё раз.`)
  }
  if (o.sha256 && (await sha256Of(tmp)) !== o.sha256.toLowerCase()) {
    rmSync(tmp, { force: true })
    cleanup()
    throw new Error('Файл повреждён при загрузке (контрольная сумма не совпала). Попробуйте ещё раз.')
  }
  rmSync(dest, { force: true })
  renameSync(tmp, dest)
  cleanup()
}
