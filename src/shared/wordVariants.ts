// Варианты неуверенного слова (волна 7): чистые функции без сети и без Electron.
// Слой «по звучанию» — русский Metaphone + список частотных слов; слой словаря и
// прошлых правок; слияние слоёв в итоговый список из 5 вариантов.

import type { Turn, Word } from './types'
import { phoneticKey } from './phonetic'
import { editDistance } from './learn'

/** Откуда взялся вариант — для серой метки в окошке. */
export type VariantBasis = 'vocab' | 'engine' | 'history' | 'meaning' | 'sound'

export interface Variant {
  /** Слово без знаков по краям и без привязки к регистру исходного слова. */
  text: string
  basis: VariantBasis
}

export const BASIS_LABEL: Record<VariantBasis, string> = {
  vocab: 'из словаря',
  engine: 'как распознал движок',
  history: 'ваша прошлая правка',
  meaning: 'по смыслу',
  sound: 'по звучанию'
}

export const MAX_VARIANTS = 5

/**
 * Слова реже этого порога слой «по звучанию» не предлагает. В ru_50k самое редкое слово
 * встречается 138 раз, так что сейчас порог ничего не отсекает: это защита на случай более
 * длинного списка. Порог низкий, чтобы проходили слова из психологии («проекция» — 143,
 * «агрессия» — 249). Опечатки субтитров вроде «здраствуйте» отсекает looksLikeTypo.
 */
export const MIN_SOUND_FREQ = 100

/** Ключ для сравнения вариантов: «пришёл» и «пришел» — одно и то же слово. */
export const yeKey = (s: string): string => s.toLowerCase().replace(/ё/g, 'е')

/** Ответ ИИ про одно слово, как он лежит в кэше. */
export interface AiEntry {
  /** Текст слова, для которого ответ получен: поменялся текст — ответ устарел. */
  t: string
  /** ИИ считает слово верным. */
  ok: boolean
  variants: Variant[]
}

/** Ответ main на «слой по звучанию»: сразу, без сети. */
export interface WordSoundReply {
  /** Слова словаря, «как распознал движок», прошлые правки записи — показываем выше всех. */
  pinned: Variant[]
  /** Похожие по звучанию из списка русских слов. */
  sound: Variant[]
  /** Готовый ответ ИИ из кэша (если слово уже спрашивали). */
  cached: AiEntry | null
  /** 'ready' — ИИ подключён и спросить можно; 'off' — нет ключа или ИИ не настроен. */
  aiState: 'ready' | 'off'
}

/** Сколько работы у кнопки «Подготовить варианты для неуверенных слов». */
export interface PrepareInfo {
  total: number
  todo: number
  requests: number
  aiReady: boolean
}

export interface PrepareDone {
  asked: number
  answered: number
  /** Пачки, на которые ИИ не ответил. */
  failed: number
  cancelled: boolean
}

// ---------------------------------------------------------------- слово и его оболочка

const SPLIT = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su

/** «Говорит,» → { lead: '', core: 'Говорит', trail: ',' }. */
export function splitToken(t: string): { lead: string; core: string; trail: string } {
  const m = SPLIT.exec(t)
  return m ? { lead: m[1], core: m[2], trail: m[3] } : { lead: '', core: t, trail: '' }
}

export const coreOf = (t: string): string => splitToken(t).core
export const normCore = (t: string): string => coreOf(t).toLowerCase()

const isLetter = (ch: string | undefined): boolean => !!ch && ch.toLowerCase() !== ch.toUpperCase()
const isUpper = (ch: string | undefined): boolean => isLetter(ch) && ch === ch!.toUpperCase()
const capFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/**
 * Вариант в форме исходного слова: заглавная буква остаётся («Говорит» → «Говорю»),
 * слово ЗАГЛАВНЫМИ тоже. Слова словаря со своей заглавной («Шварцман») не трогаем.
 */
export function shapeCore(variant: string, sourceCore: string): string {
  if (!variant) return variant
  const letters = [...sourceCore].filter(isLetter)
  const allUpper = letters.length >= 2 && letters.every(isUpper)
  if (allUpper && variant === variant.toLowerCase()) return variant.toUpperCase()
  if (isUpper(sourceCore[0]) && variant === variant.toLowerCase()) return capFirst(variant)
  return variant
}

/** Вариант в оболочке исходного слова: знаки по краям и регистр как были. */
export function shapeLike(variant: string, sourceToken: string): string {
  const { lead, core, trail } = splitToken(sourceToken)
  return lead + shapeCore(variant, core) + trail
}

// ---------------------------------------------------------------- неуверенные слова

/** Уровень подсветки по уверенности движка: 'low' (<0.5), 'mid' (<0.72) или ''. */
export function confLevel(w: Word): '' | 'low' | 'mid' {
  if (w.ok || w.t0 !== undefined || w.p === undefined) return ''
  if (w.p < 0.5) return 'low'
  if (w.p < 0.72) return 'mid'
  return ''
}

/** Слово подсвечено как неуверенное: на него открывается окошко вариантов и встаёт Tab. */
export function isUncertain(w: Word): boolean {
  if (w.ok || w.t0 !== undefined) return false
  if (!coreOf(w.t)) return false
  return confLevel(w) !== '' || w.src === 'suspect'
}

export interface UncertainRef {
  turnIndex: number
  turnId: string
  wordId: number
}

/** Неуверенные слова записи по порядку чтения. */
export function listUncertain(turns: Turn[] | undefined): UncertainRef[] {
  const out: UncertainRef[] = []
  ;(turns ?? []).forEach((t, turnIndex) => {
    for (const w of t.words) if (isUncertain(w)) out.push({ turnIndex, turnId: t.id, wordId: w.id })
  })
  return out
}

/**
 * Следующее (dir 1) или предыдущее (dir -1) неуверенное слово от слова fromWordId.
 * Само fromWordId не считается, даже если оно неуверенное. Дальше слов нет (или раньше) — null:
 * по кругу не ходим. Нет ни одного неуверенного слова — тоже null.
 */
export function stepUncertain(turns: Turn[] | undefined, fromWordId: number | null, dir: 1 | -1): UncertainRef | null {
  const list = listUncertain(turns)
  if (!list.length) return null
  const edge = dir === 1 ? list[0] : list[list.length - 1]
  if (fromWordId === null) return edge
  const order = new Map<number, number>()
  let n = 0
  for (const t of turns ?? []) for (const w of t.words) order.set(w.id, n++)
  const pos = order.get(fromWordId)
  if (pos === undefined) return edge
  if (dir === 1) return list.find((u) => (order.get(u.wordId) ?? -1) > pos) ?? null
  for (let i = list.length - 1; i >= 0; i--) if ((order.get(list[i].wordId) ?? -1) < pos) return list[i]
  return null
}

// ---------------------------------------------------------------- слой «по звучанию»

export interface WordIndex {
  words: string[]
  keys: string[]
  freq: number[]
}

/** Список «слово частота» (по строке на слово) → индекс с фонетическими ключами. */
export function buildIndex(text: string): WordIndex {
  const words: string[] = []
  const keys: string[] = []
  const freq: number[] = []
  for (const line of text.split('\n')) {
    const sp = line.indexOf(' ')
    if (sp < 1) continue
    const w = line.slice(0, sp).trim().toLowerCase()
    if (w.length < 2 || !/^[а-яё]+$/.test(w)) continue
    const k = phoneticKey(w)
    if (!k) continue
    words.push(w)
    keys.push(k)
    freq.push(Number(line.slice(sp + 1)) || 1)
  }
  return { words, keys, freq }
}

/** Допуск по расстоянию между ключами: короткие слова строже. */
function keyTolerance(keyLen: number): number {
  return keyLen >= 7 ? 2 : 1
}

const tail = (s: string, n = 2): string => s.slice(Math.max(0, s.length - n))

const RU = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'
const freqMaps = new WeakMap<WordIndex, Map<string, number>>()

function freqMap(index: WordIndex): Map<string, number> {
  let m = freqMaps.get(index)
  if (!m) {
    m = new Map()
    for (let i = 0; i < index.words.length; i++) m.set(index.words[i], index.freq[i])
    freqMaps.set(index, m)
  }
  return m
}

/**
 * Опечатка из субтитров: длинное слово, которое без одной лишней буквы или с одной
 * недостающей становится словом, встречающимся хотя бы в 20 раз чаще
 * («здраствуйте» → «здравствуйте»). Окончание (2 последние буквы) не трогаем:
 * «агрессия» и «агрессии» — формы, а не опечатки. Короткие слова не проверяем:
 * там легко спутать настоящие слова («плот» и «пот»).
 */
export function looksLikeTypo(w: string, freq: number, index: WordIndex): boolean {
  if (w.length < 6) return false
  const m = freqMap(index)
  const need = freq * 20
  const stop = w.length - 2
  for (let i = 0; i < stop; i++) {
    const del = w.slice(0, i) + w.slice(i + 1)
    if ((m.get(del) ?? 0) >= need) return true
  }
  for (let i = 0; i <= stop; i++) {
    for (const ch of RU) {
      const ins = w.slice(0, i) + ch + w.slice(i)
      if ((m.get(ins) ?? 0) >= need) return true
    }
  }
  return false
}

/**
 * Похожие по звучанию слова из списка. Порядок: тот же ключ, потом ближе по буквам,
 * потом та же форма окончания, потом чаще встречается. Само слово не возвращаем.
 */
export function soundCandidates(token: string, index: WordIndex, limit = 8, minFreq = 0): Variant[] {
  const word = normCore(token)
  if ([...word].length < 3 || !/^[а-яё-]+$/.test(word)) return []
  const key = phoneticKey(word)
  if (!key) return []
  const tol = keyTolerance(key.length)
  const letterMax = Math.max(3, Math.ceil(word.length / 3))
  const scored: { w: string; f: number; score: number }[] = []
  for (let i = 0; i < index.words.length; i++) {
    const w = index.words[i]
    if (w === word) continue
    if (index.freq[i] < minFreq) continue // в списке из субтитров редкие «слова» — чаще всего опечатки
    const k = index.keys[i]
    if (Math.abs(k.length - key.length) > tol) continue
    const dk = k === key ? 0 : editDistance(k, key, tol)
    if (dk > tol) continue
    const dl = editDistance(w, word, letterMax)
    if (dl > letterMax) continue
    const sameEnd = tail(w) === tail(word)
    const score = dk * 40 + dl * 12 + (sameEnd ? 0 : 10) - Math.log10(index.freq[i] + 1) * 3
    scored.push({ w, f: index.freq[i], score })
  }
  scored.sort((a, b) => a.score - b.score || a.w.localeCompare(b.w, 'ru'))
  const out: Variant[] = []
  for (const s of scored) {
    if (out.length >= limit) break
    if (minFreq > 0 && looksLikeTypo(s.w, s.f, index)) continue
    out.push({ text: s.w, basis: 'sound' })
  }
  return out
}

// ---------------------------------------------------------------- словарь и прошлые правки

/** Похоже ли слово cand на слово word настолько, чтобы показать его как вариант. */
export function isNear(cand: string, word: string): boolean {
  if (cand === word) return false
  const kc = phoneticKey(cand)
  const kw = phoneticKey(word)
  if (!kc || !kw) return false
  const tol = Math.max(keyTolerance(kw.length), Math.floor(kw.length / 4))
  if (Math.abs(kc.length - kw.length) <= tol && editDistance(kc, kw, tol) <= tol) return true
  return editDistance(cand, word, 2) <= 2
}

export interface VocabLike {
  words?: string[]
  replacements?: { from: string; to: string }[]
}

/**
 * Слова словаря пользователя, похожие на данное: слова для распознавания и цели точных замен.
 * Только однословные записи; фразы в окошке не показываем.
 */
export function vocabCandidates(token: string, vocab: VocabLike | undefined): Variant[] {
  const word = normCore(token)
  if (!word || !vocab) return []
  const out: Variant[] = []
  const seen = new Set<string>([word])
  const add = (raw: string, force = false): void => {
    const t = raw.trim()
    if (!t || /\s/.test(t)) return
    const n = t.toLowerCase()
    // Замена, которая лишь меняет регистр («кпт» → «КПТ»), — тоже вариант.
    if (seen.has(n) && !(force && t !== word)) return
    if (!force && !isNear(n, word)) return
    seen.add(n)
    out.push({ text: t, basis: 'vocab' })
  }
  // Точная замена «как распознаётся → как писать» срабатывает на самом слове.
  for (const r of vocab.replacements ?? []) if (r.from.trim().toLowerCase() === word) add(r.to, true)
  for (const w of vocab.words ?? []) add(w)
  for (const r of vocab.replacements ?? []) add(r.to)
  return out
}

/** Прошлые правки этой записи: «движок написал X, человек исправил на Y», где X похоже на слово. */
export function historyCandidates(token: string, turns: Turn[] | undefined): Variant[] {
  const word = normCore(token)
  if (!word) return []
  const out: Variant[] = []
  const seen = new Set<string>([word])
  for (const t of turns ?? []) {
    for (const w of t.words) {
      if (w.t0 === undefined) continue
      const from = normCore(w.t0)
      const to = coreOf(w.t)
      const nTo = to.toLowerCase()
      if (!from || !to || /\s/.test(to) || seen.has(nTo)) continue
      if (from === word || isNear(from, word)) {
        seen.add(nTo)
        out.push({ text: to, basis: 'history' })
      }
    }
  }
  return out
}

/** Слово, как его выдал движок, — если слово правили. */
export function engineVariant(w: Word): Variant[] {
  if (w.t0 === undefined) return []
  const core = coreOf(w.t0)
  if (!core || /\s/.test(core) || core.toLowerCase() === normCore(w.t)) return []
  return [{ text: core, basis: 'engine' }]
}

// ---------------------------------------------------------------- слияние слоёв

/** Слои по порядку важности → не больше limit вариантов, без повторов и без самого слова. */
export function mergeVariants(layers: Variant[][], currentToken: string, limit = MAX_VARIANTS): Variant[] {
  const cur = normCore(currentToken)
  const seen = new Set<string>()
  const out: Variant[] = []
  for (const layer of layers) {
    for (const v of layer) {
      const n = v.text.trim().toLowerCase()
      if (!n || n === cur || seen.has(yeKey(n))) continue
      seen.add(yeKey(n))
      out.push({ text: v.text.trim(), basis: v.basis })
      if (out.length >= limit) return out
    }
  }
  return out
}

// ---------------------------------------------------------------- «такое слово есть ещё»

/** Сколько ещё слов записи совпадают с этим (без знаков и регистра), не считая его самого и уже правленых. */
export function sameWordCount(turns: Turn[] | undefined, token: string, exceptWordId: number): number {
  const n = normCore(token)
  if (!n) return 0
  let c = 0
  for (const t of turns ?? [])
    for (const w of t.words) if (w.id !== exceptWordId && w.t0 === undefined && normCore(w.t) === n) c++
  return c
}
