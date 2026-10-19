import { closeSync, existsSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../paths'
import { planPoll, seenKey, WATCH_EXT, type FileStat, type Pending } from './plan'

// Папка-наблюдатель (волна 5): кладёшь запись в папку (диктофон, OneDrive,
// Яндекс.Диск) — «Слово» само её импортирует и, если включено, расшифровывает.
// Опрос раз в 10 с, а не fs.watch: тот ненадёжен на сетевых и облачных папках.
// Что уже взяли — помним в watch-seen.json (имя + размер + время изменения).

const SEEN_FILE = join(DATA_DIR, 'watch-seen.json')
const POLL_MS = 10_000

let timer: ReturnType<typeof setInterval> | null = null
let dir = ''
let pending = new Map<string, Pending>()
let busy = false

function loadSeen(): Record<string, string[]> {
  try {
    return JSON.parse(readFileSync(SEEN_FILE, 'utf8')) as Record<string, string[]>
  } catch {
    return {}
  }
}

function saveSeen(all: Record<string, string[]>): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(SEEN_FILE, JSON.stringify(all), 'utf8')
  } catch {
    /* не критично: в худшем случае файл возьмётся ещё раз */
  }
}

function listFiles(d: string): FileStat[] {
  const out: FileStat[] = []
  for (const name of readdirSync(d)) {
    try {
      const st = statSync(join(d, name))
      if (st.isFile()) out.push({ name, size: st.size, mtimeMs: st.mtimeMs })
    } catch {
      /* файл исчез между чтением папки и stat */
    }
  }
  return out
}

/** Файл ещё пишет другая программа — открыть на запись не дадут (Windows). */
function locked(path: string): boolean {
  try {
    closeSync(openSync(path, 'r+'))
    return false
  } catch {
    return true
  }
}

export interface WatchHooks {
  /** Импорт файла; вернуть название записи. */
  importFile: (path: string) => Promise<string>
  onImported: (title: string) => void
  onError: (message: string) => void
}

/**
 * Начать следить за папкой. takeExisting=false — файлы, которые уже лежат в
 * папке, считаем взятыми (берём только новые).
 */
export function startWatchFolder(folder: string, takeExisting: boolean, hooks: WatchHooks): void {
  stopWatchFolder()
  if (!folder) return
  dir = folder
  pending = new Map()
  // Папки может не быть сейчас (флешка диктофона, сетевой диск) — следим всё
  // равно: появится — начнём брать (ревью волны 5: раньше наблюдатель молча не стартовал).
  // «Уже лежащие» файлы фиксируем в момент выбора папки. Если папки сейчас нет,
  // ничего и не лежит: всё, что появится потом (флешку вставили), — новое.
  const init = (files: () => string[]): void => {
    const all = loadSeen()
    if (all[dir]) return
    all[dir] = takeExisting ? [] : files()
    saveSeen(all)
  }
  if (existsSync(folder)) init(() => listFiles(folder).filter((f) => WATCH_EXT.test(f.name)).map(seenKey))
  else {
    init(() => [])
    hooks.onError(`Папка-наблюдатель сейчас недоступна: ${folder}. Возьму записи, когда она появится.`)
  }
  const poll = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      if (!existsSync(dir)) return
      const seenAll = loadSeen()
      const seen = new Set(seenAll[dir] ?? [])
      const plan = planPoll(listFiles(dir), seen, pending)
      pending = plan.pending
      for (const f of plan.ready) {
        const path = join(dir, f.name)
        if (locked(path)) {
          pending.set(f.name, { size: f.size, mtimeMs: f.mtimeMs, stable: 0 })
          continue
        }
        // Помечаем до импорта: битый файл не будет повторяться каждые 10 с.
        seen.add(seenKey(f))
        seenAll[dir] = [...seen].slice(-5000)
        saveSeen(seenAll)
        try {
          hooks.onImported(await hooks.importFile(path))
        } catch (err) {
          hooks.onError(`Не удалось взять «${f.name}» из папки-наблюдателя: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } catch (err) {
      console.error('[watch]', err)
    } finally {
      busy = false
    }
  }
  timer = setInterval(() => void poll(), POLL_MS)
  void poll()
}

export function stopWatchFolder(): void {
  if (timer) clearInterval(timer)
  timer = null
  dir = ''
  pending = new Map()
}
