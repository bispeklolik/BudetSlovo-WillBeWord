// Папка-наблюдатель (волна 5): чистая логика «какие файлы пора брать».
// Файл берём, когда он перестал расти два опроса подряд — диктофон или
// синхронизация (OneDrive, Яндекс.Диск) могут ещё дописывать его.

export const WATCH_EXT = /\.(m4a|mp3|wav|aac|ogg|oga|flac|opus|wma|amr|mp4|mov|mkv|avi|webm|m4v|3gp)$/i

export interface FileStat {
  name: string
  size: number
  mtimeMs: number
}

/** Ключ «этот файл в этом виде уже видели». */
export const seenKey = (f: FileStat): string => `${f.name}|${f.size}|${Math.round(f.mtimeMs)}`

export interface Pending {
  size: number
  mtimeMs: number
  stable: number
}

/**
 * Один опрос: новые медиафайлы → ожидание; не менялись STABLE_POLLS опросов —
 * готовы к импорту. Возвращает готовые файлы и новое состояние ожидания.
 */
export function planPoll(
  files: FileStat[],
  seen: Set<string>,
  pending: Map<string, Pending>,
  stablePolls = 2
): { ready: FileStat[]; pending: Map<string, Pending> } {
  const next = new Map<string, Pending>()
  const ready: FileStat[] = []
  for (const f of files) {
    if (!WATCH_EXT.test(f.name) || f.name.startsWith('~$') || f.name.startsWith('.')) continue
    if (seen.has(seenKey(f)) || f.size === 0) continue
    const prev = pending.get(f.name)
    const stable = prev && prev.size === f.size && prev.mtimeMs === f.mtimeMs ? prev.stable + 1 : 0
    if (stable >= stablePolls) ready.push(f)
    else next.set(f.name, { size: f.size, mtimeMs: f.mtimeMs, stable })
  }
  return { ready, pending: next }
}
