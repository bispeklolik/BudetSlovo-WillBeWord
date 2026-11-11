import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { Word } from '../../shared/types'
import type { Vocab } from '../../shared/vocab'
import type { AiProvider } from './provider'
import { getProject, projectDir, writeJsonAtomic } from '../project/store'
import { listUncertain, type AiEntry, type WordIndex } from '../../shared/wordVariants'
import { askAi, findWord } from './wordVariants'

// Кэш ответов ИИ и работа «на всю запись». Ответы лежат в папке проекта отдельным файлом
// variants.json: не в патчах и не в истории отмены.

/** Сколько слов отправляем в одном запросе пачкой. */
export const BATCH_SIZE = 12
/** Сколько ждём ИИ у окошка: человек стоит и смотрит. */
export const SINGLE_TIMEOUT_MS = 8000
/** Пачка длиннее — ждём дольше. */
export const BATCH_TIMEOUT_MS = 40_000

const cacheFile = (slug: string): string => join(projectDir(slug), 'variants.json')

export type AiCache = Record<string, AiEntry>

export function loadCache(slug: string): AiCache {
  try {
    const f = cacheFile(slug)
    if (!existsSync(f)) return {}
    const d = JSON.parse(readFileSync(f, 'utf8')) as AiCache
    return d && typeof d === 'object' ? d : {}
  } catch {
    return {}
  }
}

function saveCache(slug: string, cache: AiCache): void {
  writeJsonAtomic(cacheFile(slug), cache)
}

/** Ответ в кэше годится, только если текст слова с тех пор не менялся. */
export function cachedFor(cache: AiCache, w: Word): AiEntry | null {
  const e = cache[String(w.id)]
  return e && e.t === w.t ? e : null
}

export interface AiForWordResult {
  state: 'ok' | 'none'
  entry: AiEntry | null
}

/** Ответ ИИ для одного слова: из кэша или новым запросом (и в кэш). */
export async function aiForWord(
  provider: AiProvider,
  slug: string,
  wordId: number,
  vocab: Vocab | undefined,
  opts: { timeoutMs?: number; index?: WordIndex } = {}
): Promise<AiForWordResult> {
  const meta = getProject(slug)
  const f = meta ? findWord(meta, wordId) : null
  if (!meta || !f) return { state: 'none', entry: null }
  const cache = loadCache(slug)
  const hit = cachedFor(cache, f.word)
  if (hit) return { state: 'ok', entry: hit }
  const res = await askAi(provider, meta, [wordId], vocab, { timeoutMs: opts.timeoutMs ?? SINGLE_TIMEOUT_MS, index: opts.index })
  const entry = res.get(wordId) ?? null
  if (entry) {
    // Кэш читаем заново: пока шёл запрос, пачка могла записать другие слова.
    const fresh = loadCache(slug)
    fresh[String(wordId)] = entry
    saveCache(slug, fresh)
  }
  return { state: entry ? 'ok' : 'none', entry }
}

// ---------------------------------------------------------------- «на всю запись»

export interface PrepareCount {
  /** Неуверенных слов в записи. */
  total: number
  /** Из них без готового ответа — их и спросим. */
  todo: number
  /** Сколько запросов выйдет. */
  requests: number
}

export function prepareCount(slug: string): PrepareCount {
  const meta = getProject(slug)
  if (!meta) return { total: 0, todo: 0, requests: 0 }
  const cache = loadCache(slug)
  const ids = listUncertain(meta.turns)
  const todo = ids.filter((u) => {
    const f = findWord(meta, u.wordId)
    return f && !cachedFor(cache, f.word)
  }).length
  return { total: ids.length, todo, requests: Math.ceil(todo / BATCH_SIZE) }
}

export interface PrepareProgress {
  done: number
  total: number
}

export interface PrepareResult {
  asked: number
  answered: number
  cancelled: boolean
}

/**
 * Готовит варианты для всех неуверенных слов записи: пачками по BATCH_SIZE слов, результат
 * после каждой пачки идёт в кэш. Отмена (signal) останавливает после текущей пачки.
 */
export async function prepareAll(
  provider: AiProvider,
  slug: string,
  vocab: Vocab | undefined,
  onProgress: (p: PrepareProgress) => void,
  signal: { cancelled: boolean },
  opts: { index?: WordIndex } = {}
): Promise<PrepareResult> {
  const meta = getProject(slug)
  if (!meta) return { asked: 0, answered: 0, cancelled: false }
  const cache = loadCache(slug)
  const ids: number[] = []
  for (const u of listUncertain(meta.turns)) {
    const f = findWord(meta, u.wordId)
    if (f && !cachedFor(cache, f.word)) ids.push(u.wordId)
  }
  let answered = 0
  let done = 0
  onProgress({ done: 0, total: ids.length })
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    if (signal.cancelled) return { asked: done, answered, cancelled: true }
    const chunk = ids.slice(i, i + BATCH_SIZE)
    const res = await askAi(provider, meta, chunk, vocab, { timeoutMs: BATCH_TIMEOUT_MS, index: opts.index })
    const fresh = loadCache(slug)
    for (const [id, entry] of res) {
      fresh[String(id)] = entry
      answered++
    }
    saveCache(slug, fresh)
    done += chunk.length
    onProgress({ done, total: ids.length })
  }
  return { asked: done, answered, cancelled: signal.cancelled }
}

