import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, readFileSync } from 'fs'
import { join, sep } from 'path'
import { downloadFile, type DlProgress } from './downloader'
import { enginePaths } from './location'
import { ENGINE_RELEASE, localModel, type LocalModel } from '../../shared/localModels'
import { ENGINE_EXE_NAME } from '../pathsResolve'

// Дверь «На этом компьютере»: скачать движок Faster-Whisper-XXL (если его нет),
// распаковать, скачать выбранную модель Whisper. Всё в фоне, с докачкой после
// обрыва/перезапуска. Владелец с готовым D:\STT получает только модель.

import type { SetupProgress } from '../../shared/types'
export type { SetupProgress }

// ---------- чистые помощники (под тестами) ----------

interface GhAsset {
  name: string
  size: number
  browser_download_url: string
  digest?: string | null
}

/** Самый свежий виндовый архив движка из ответа GitHub API. */
export function pickEngineAsset(assets: GhAsset[]): GhAsset | null {
  const ver = (n: string): number[] =>
    (ENGINE_RELEASE.asset.exec(n)?.[1] ?? '0').split('.').map((x) => Number(x) || 0)
  const cmp = (a: number[], b: number[]): number => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0)
      if (d) return d
    }
    return 0
  }
  const win = assets.filter((a) => ENGINE_RELEASE.asset.test(a.name))
  win.sort((a, b) => cmp(ver(b.name), ver(a.name)))
  return win[0] ?? null
}

interface HfEntry {
  type: string
  path: string
  size: number
  lfs?: { oid: string; size: number }
}

export interface ModelFile {
  path: string
  size: number
  sha256?: string
}

/** Файлы модели из дерева HF: без README/.gitattributes; у больших — sha256. */
export function modelFilesFromTree(tree: HfEntry[]): ModelFile[] {
  return tree
    .filter((e) => e.type === 'file' && !/^(README\.md|\.gitattributes)$/i.test(e.path))
    .map((e) => ({ path: e.path, size: e.lfs?.size ?? e.size, sha256: e.lfs?.oid }))
}

export function modelDir(modelsDir: string, id: string): string {
  return join(modelsDir, `faster-whisper-${id}`)
}

/** Модель стоит, если есть model.bin и не висит недокачка. */
export function modelInstalled(modelsDir: string, id: string): boolean {
  const d = modelDir(modelsDir, id)
  return existsSync(join(d, 'model.bin')) && !existsSync(join(d, 'model.bin.dl.json'))
}

/** Процент из вывода 7za с -bsp1 («  42% 13 - file»). */
export function parse7zPercent(chunk: string): number | null {
  const all = [...chunk.matchAll(/(\d{1,3})%/g)]
  if (!all.length) return null
  const n = Number(all[all.length - 1][1])
  return n >= 0 && n <= 100 ? n : null
}

// ---------- сама установка ----------

let running: { ctrl: AbortController; promise: Promise<void> } | null = null
let last: SetupProgress | null = null
let notify: (p: SetupProgress) => void = () => {}

export function setSetupNotifier(fn: (p: SetupProgress) => void): void {
  notify = fn
}

function emit(p: SetupProgress): void {
  last = p
  notify(p)
}

function stateFile(): string {
  return join(enginePaths().modelsDir, '..', 'setup.json')
}

/** Незаконченная установка с прошлого запуска (чтобы предложить «Продолжить»). */
export function pendingSetup(): { modelId: string } | null {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8')) as { modelId: string; active: boolean }
    return s.active ? { modelId: s.modelId } : null
  } catch {
    return null
  }
}

export function setupStatus(): SetupProgress | null {
  return running ? last : null
}

function sevenZip(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = (require('7zip-bin') as { path7za: string }).path7za
  return p.replace('app.asar' + sep, 'app.asar.unpacked' + sep)
}

function findEngineDir(root: string, depth = 3): string | null {
  if (existsSync(join(root, ENGINE_EXE_NAME))) return root
  if (depth === 0) return null
  for (const name of readdirSync(root)) {
    const p = join(root, name)
    if (statSync(p).isDirectory()) {
      const hit = findEngineDir(p, depth - 1)
      if (hit) return hit
    }
  }
  return null
}

function extract(archive: string, outDir: string, signal: AbortSignal, onPct: (n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(sevenZip(), ['x', archive, `-o${outDir}`, '-y', '-bsp1', '-bso0'], { windowsHide: true })
    const onAbort = (): void => {
      child.kill()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (s: string) => {
      const n = parse7zPercent(s)
      if (n !== null) onPct(n)
    })
    let err = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (s: string) => (err += s))
    child.on('error', (e) => reject(new Error('Не удалось запустить распаковку: ' + e.message)))
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) reject(new Error('Загрузка остановлена'))
      else if (code === 0) resolve()
      else reject(new Error(`Архив движка не распаковался (код ${code}). ${err.slice(0, 200)}`))
    })
  })
}

async function installEngine(modelId: string, signal: AbortSignal): Promise<void> {
  const e = enginePaths()
  const root = join(e.dir, '..')
  const dlDir = join(root, 'download')
  mkdirSync(dlDir, { recursive: true })

  emit({ stage: 'engine', modelId, label: 'Ищу движок расшифровки', done: 0, total: 0, bytesPerSec: 0 })
  const rel = await fetch(`https://api.github.com/repos/${ENGINE_RELEASE.repo}/releases/tags/${ENGINE_RELEASE.tag}`, {
    signal,
    headers: { Accept: 'application/vnd.github+json' }
  })
  if (!rel.ok) throw new Error(`GitHub не отдал список версий движка (${rel.status}). Попробуйте позже.`)
  const asset = pickEngineAsset(((await rel.json()) as { assets: GhAsset[] }).assets)
  if (!asset) throw new Error('На GitHub не нашлось архива движка для Windows.')

  const archive = join(dlDir, asset.name)
  const sha = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : undefined
  if (!existsSync(archive) || statSync(archive).size !== asset.size) {
    await downloadFile(asset.browser_download_url, archive, {
      segments: 4,
      signal,
      sha256: sha,
      onProgress: (p: DlProgress) =>
        emit({ stage: 'engine', modelId, label: 'Скачиваю движок расшифровки', ...p, total: p.total || asset.size })
    })
  }

  emit({ stage: 'extract', modelId, label: 'Распаковываю движок', done: 0, total: 100, bytesPerSec: 0 })
  const tmp = join(root, '_extract')
  rmSync(tmp, { recursive: true, force: true })
  await extract(archive, tmp, signal, (n) =>
    emit({ stage: 'extract', modelId, label: 'Распаковываю движок', done: n, total: 100, bytesPerSec: 0 })
  )
  const found = findEngineDir(tmp)
  if (!found) throw new Error('В архиве не нашёлся faster-whisper-xxl.exe.')
  rmSync(e.dir, { recursive: true, force: true })
  renameSync(found, e.dir)
  rmSync(tmp, { recursive: true, force: true })
  rmSync(archive, { force: true })
}

async function installModel(m: LocalModel, signal: AbortSignal): Promise<void> {
  const e = enginePaths()
  const dir = modelDir(e.modelsDir, m.id)
  emit({ stage: 'model', modelId: m.id, label: `Готовлю загрузку модели ${m.label}`, done: 0, total: m.approxBytes, bytesPerSec: 0 })
  const tr = await fetch(`https://huggingface.co/api/models/${m.repo}/tree/main`, { signal })
  if (!tr.ok) throw new Error(`HuggingFace не отдал список файлов модели (${tr.status}). Попробуйте позже.`)
  const files = modelFilesFromTree((await tr.json()) as HfEntry[])
  const total = files.reduce((s, f) => s + f.size, 0)
  let base = 0
  for (const f of files) {
    const dest = join(dir, f.path)
    const ready = existsSync(dest) && statSync(dest).size === f.size && !existsSync(dest + '.dl.json')
    if (!ready) {
      await downloadFile(`https://huggingface.co/${m.repo}/resolve/main/${f.path}`, dest, {
        segments: f.size > 50_000_000 ? 4 : 1,
        signal,
        sha256: f.sha256,
        onProgress: (p) =>
          emit({ stage: 'model', modelId: m.id, label: `Скачиваю модель ${m.label}`, done: base + p.done, total, bytesPerSec: p.bytesPerSec })
      })
    }
    base += f.size
  }
}

/**
 * Запустить (или продолжить) установку. onDone вызывается после успеха —
 * там main сохраняет выбранную модель в настройки.
 */
export function startSetup(modelId: string, onDone: (modelId: string) => void): void {
  if (running) return
  const m = localModel(modelId)
  const ctrl = new AbortController()
  const st = stateFile()
  mkdirSync(join(st, '..'), { recursive: true })
  writeFileSync(st, JSON.stringify({ modelId: m.id, active: true }), 'utf8')
  const promise = (async () => {
    try {
      if (!enginePaths().installed) await installEngine(m.id, ctrl.signal)
      if (!modelInstalled(enginePaths().modelsDir, m.id)) await installModel(m, ctrl.signal)
      writeFileSync(st, JSON.stringify({ modelId: m.id, active: false }), 'utf8')
      onDone(m.id)
      emit({ stage: 'done', modelId: m.id, label: 'Готово: можно расшифровывать на этом компьютере', done: 1, total: 1, bytesPerSec: 0 })
    } catch (err) {
      if (ctrl.signal.aborted) {
        emit({ stage: 'stopped', modelId: m.id, label: 'Загрузка на паузе — скачанное сохранено', done: last?.done ?? 0, total: last?.total ?? 0, bytesPerSec: 0 })
      } else {
        emit({
          stage: 'error',
          modelId: m.id,
          label: 'Загрузка не удалась',
          done: last?.done ?? 0,
          total: last?.total ?? 0,
          bytesPerSec: 0,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    } finally {
      running = null
    }
  })()
  running = { ctrl, promise }
}

export function stopSetup(): void {
  running?.ctrl.abort()
}
