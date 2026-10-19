import { spawn, type ChildProcess } from 'child_process'
import { OLLAMA_ADDR, ollamaExe, ollamaModelsOverride } from '../paths'

// Управление локальным движком ИИ (Ollama) как подпроцессом — тот же паттерн,
// что и движок расшифровки. Лениво поднимаем сервер при первом ИИ-вызове, если
// он ещё не запущен; глушим свой процесс при выходе. Чужой уже запущенный
// сервер (например, Ollama из трея) не трогаем — только проверяем доступность.
let child: ChildProcess | null = null
const BASE = `http://${OLLAMA_ADDR}`

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

export async function ensureOllama(): Promise<boolean> {
  if (await reachable()) return true
  const exe = ollamaExe()
  if (!exe) return false
  if (!child || child.exitCode !== null) {
    const models = ollamaModelsOverride(exe)
    child = spawn(exe, ['serve'], {
      env: {
        ...process.env,
        OLLAMA_HOST: OLLAMA_ADDR,
        ...(models ? { OLLAMA_MODELS: models } : {}),
        OLLAMA_FLASH_ATTENTION: '1'
      },
      windowsHide: true,
      stdio: 'ignore'
    })
    child.on('error', () => {
      child = null
    })
  }
  // ждём готовности до ~20с (первый старт + дискавери GPU)
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await reachable()) return true
  }
  return false
}

export function stopOllama(): void {
  if (child && child.exitCode === null) {
    try {
      child.kill()
    } catch {
      // ignore
    }
  }
  child = null
}

export interface OllamaStatus {
  installed: boolean
  running: boolean
  models: string[]
}

/** Есть ли Ollama и какие модели уже скачаны (для двери «На этом компьютере»). */
export async function ollamaStatus(): Promise<OllamaStatus> {
  if (!(await reachable())) {
    if (!ollamaExe()) return { installed: false, running: false, models: [] }
    // Установлена, но не запущена — поднимем сами, чтобы увидеть модели.
    if (!(await ensureOllama())) return { installed: true, running: false, models: [] }
  }
  try {
    const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(3000) })
    const j = (await r.json()) as { models?: { name: string }[] }
    return { installed: true, running: true, models: (j.models ?? []).map((m) => m.name) }
  } catch {
    return { installed: true, running: true, models: [] }
  }
}

/** Скачать модель через Ollama с прогрессом (поток NDJSON от /api/pull). */
export async function pullOllamaModel(
  name: string,
  onProgress: (p: { status: string; done: number; total: number }) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!(await ensureOllama())) throw new Error('Ollama не запустилась. Установите её с ollama.com и попробуйте снова.')
  const res = await fetch(`${BASE}/api/pull`, {
    method: 'POST',
    body: JSON.stringify({ name, stream: true }),
    signal
  })
  if (!res.ok || !res.body) throw new Error(`Ollama не начала загрузку (${res.status}).`)
  let buf = ''
  const dec = new TextDecoder()
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      const j = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string }
      if (j.error) throw new Error('Ollama: ' + j.error)
      onProgress({ status: j.status ?? '', done: j.completed ?? 0, total: j.total ?? 0 })
    }
  }
}
