import type { ProjectMeta, Turn, Word } from '../../shared/types'
import type { Vocab } from '../../shared/vocab'
import type { AiProvider } from './provider'
import { buildAnonOverlay, anonPlain } from '../../shared/anon'
import {
  engineVariant,
  historyCandidates,
  soundCandidates,
  vocabCandidates,
  type AiEntry,
  type Variant,
  type WordIndex
} from '../../shared/wordVariants'
import { buildFragment, closeDict, filterAiVariants, type AiItem } from '../../shared/wordVariantsAi'
import { getWordIndex } from '../words/ruWords'

// Окошко «возможные варианты» (волна 7): слой «по звучанию» (быстро, без сети) и слой ИИ
// (по щелчку на слове или пачками на всю запись). Ответы ИИ лежат в папке проекта отдельным
// файлом variants.json: не в патчах и не в истории отмены.


export function findWord(meta: ProjectMeta, wordId: number): { turn: Turn; word: Word } | null {
  for (const turn of meta.turns ?? []) {
    const word = turn.words.find((w) => w.id === wordId)
    if (word) return { turn, word }
  }
  return null
}

// ---------------------------------------------------------------- слой «по звучанию»

export interface SoundLayers {
  /** Слова словаря, как распознал движок, прошлые правки записи. */
  pinned: Variant[]
  /** Похожие по звучанию из списка русских слов. */
  sound: Variant[]
}

export function soundLayers(meta: ProjectMeta, wordId: number, vocab: Vocab | undefined, index: WordIndex = getWordIndex()): SoundLayers | null {
  const f = findWord(meta, wordId)
  if (!f) return null
  const { word } = f
  const pinned = [...vocabCandidates(word.t, vocab), ...engineVariant(word), ...historyCandidates(word.t, meta.turns)]
  return { pinned, sound: soundCandidates(word.t, index, 8) }
}

// ---------------------------------------------------------------- слой ИИ

/** Провайдер можно звать за вариантами: у него есть метод и он готов (ключ задан / сервер жив). */
export async function aiReady(provider: AiProvider | undefined | null): Promise<boolean> {
  if (!provider?.wordVariants) return false
  try {
    return await provider.isAvailable()
  } catch {
    return false
  }
}

/**
 * Спрашивает ИИ про слова пачкой. Облачному ИИ — обезличенный фрагмент (имена по правилам записи)
 * и без слов словаря, которые сами обезличиваются. Возвращает записи для кэша; слова,
 * на которые ИИ не ответил, в результат не попадают (их можно спросить ещё раз).
 */
export async function askAi(
  provider: AiProvider,
  meta: ProjectMeta,
  wordIds: number[],
  vocab: Vocab | undefined,
  opts: { timeoutMs: number; index?: WordIndex }
): Promise<Map<number, AiEntry>> {
  const out = new Map<number, AiEntry>()
  if (!provider.wordVariants) return out
  const index = opts.index ?? getWordIndex()
  const cloud = !provider.isLocal
  const rules = cloud ? meta.anon : undefined
  const overlay = rules?.length ? buildAnonOverlay(meta.turns ?? [], rules) : undefined
  const vocabWords = (vocab?.words ?? []).concat((vocab?.replacements ?? []).map((r) => r.to))
  // В облако не отправляем слова словаря, которые закрыты правилами обезличивания (имена клиентов).
  const safeVocab = rules?.length ? vocabWords.filter((w) => anonPlain(w, rules) === w) : vocabWords

  const items: AiItem[] = []
  const words = new Map<number, Word>()
  for (const id of wordIds) {
    const f = findWord(meta, id)
    if (!f) continue
    const frag = buildFragment(f.turn, id, overlay)
    if (!frag || !frag.word) continue
    words.set(id, f.word)
    items.push({
      id,
      left: frag.left,
      word: frag.word,
      right: frag.right,
      conf: f.word.p === undefined ? undefined : Math.round(f.word.p * 100),
      dict: closeDict(f.word.t, safeVocab, 20),
      hints: soundCandidates(f.word.t, index, 5).map((v) => v.text)
    })
  }
  if (!items.length) return out

  const raw = await provider.wordVariants(items, { timeoutMs: opts.timeoutMs })
  for (const r of raw) {
    const w = words.get(r.id)
    if (!w || out.has(r.id)) continue
    out.set(r.id, { t: w.t, ok: r.ok, variants: filterAiVariants(w.t, r.variants, vocabWords) })
  }
  return out
}

