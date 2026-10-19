import type { SpeakerInfo, Turn, Word } from './types'

// Звонок пишется двумя дорожками: микрофон («Я») и системный звук («Собеседник»).
// Каждая дорожка расшифровывается отдельно, потом слова сливаются по времени.

export interface ChannelWord {
  s: number
  e: number
  t: string
  p?: number
}

const ECHO_WINDOW_SEC = 0.7 // насколько близко по времени слово-эхо к оригиналу
const SPLIT_SILENCE_SEC = 8 // пауза в одном канале, после которой начинается новая реплика
const EPS = 1e-9 // запас на ошибки float у границы окна

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

function byStart(a: ChannelWord, b: ChannelWord): number {
  return a.s - b.s
}

// Слова реплик → плоский список только со временем (вставленные слова без s не годятся).
export function wordsFromTurns(turns: Turn[]): ChannelWord[] {
  const out: ChannelWord[] = []
  for (const turn of turns) {
    for (const w of turn.words) {
      const t = w.t.trim()
      if (!isNum(w.s) || !t) continue
      const cw: ChannelWord = { s: w.s, e: isNum(w.e) ? w.e : w.s, t }
      if (isNum(w.p)) cw.p = w.p
      out.push(cw)
    }
  }
  return out.sort(byStart)
}

// Вывод faster-whisper / Faster-Whisper-XXL (JSON) → слова. Мусор пропускаем молча.
export function parseWhisperJsonWords(json: unknown): ChannelWord[] {
  const out: ChannelWord[] = []
  const segments = (json as { segments?: unknown } | null)?.segments
  if (!Array.isArray(segments)) return out

  for (const seg of segments) {
    if (!seg || typeof seg !== 'object') continue
    const { start, end, text, words } = seg as Record<string, unknown>
    if (!isNum(start) || !isNum(end)) continue

    const before = out.length
    if (Array.isArray(words)) {
      for (const w of words) {
        if (!w || typeof w !== 'object') continue
        const { start: ws, end: we, word, probability } = w as Record<string, unknown>
        if (!isNum(ws) || !isNum(we) || typeof word !== 'string') continue
        const t = word.trim()
        if (!t) continue
        const cw: ChannelWord = { s: ws, e: we, t }
        if (isNum(probability)) cw.p = probability
        out.push(cw)
      }
    }
    if (out.length > before || typeof text !== 'string') continue

    // Таймингов слов нет — делим текст сегмента поровну, это лучше, чем потерять его.
    const parts = text.split(/\s+/).filter(Boolean)
    const step = (end - start) / (parts.length || 1)
    parts.forEach((t, i) => out.push({ s: start + i * step, e: start + (i + 1) * step, t }))
  }
  return out.sort(byStart)
}

// Для сравнения слов: регистр, ё и знаки препинания не важны.
function normalize(t: string): string {
  return t.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '')
}

// Первый индекс, где arr[i] >= x (arr отсортирован).
function lowerBound(arr: number[], x: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Если человек говорит через колонки, голос собеседника попадает в микрофон.
// Такое слово совпадает с системным по тексту и началу — убираем его с дорожки микрофона.
// Но только в серии из 2+ совпавших слов подряд: одиночное «да», «ну», «угу»
// часто звучит у обеих сторон одновременно, и это настоящая реплика, а не эхо
// (ревью волны 3: терялись короткие ответы психолога и клиента).
export function dropEcho(mic: ChannelWord[], sys: ChannelWord[]): ChannelWord[] {
  // Индекс: нормализованный текст → отсортированные времена начала в системной дорожке.
  const index = new Map<string, number[]>()
  for (const w of sys) {
    const n = normalize(w.t)
    if (n.length < 2) continue
    const list = index.get(n)
    if (list) list.push(w.s)
    else index.set(n, [w.s])
  }
  for (const list of index.values()) list.sort((a, b) => a - b)

  const matched = mic.map((w) => {
    const n = normalize(w.t)
    if (n.length < 2) return false // короткие («я», «и») слишком часто совпадают случайно
    const list = index.get(n)
    if (!list) return false
    const i = lowerBound(list, w.s - ECHO_WINDOW_SEC - EPS)
    return i < list.length && list[i] <= w.s + ECHO_WINDOW_SEC + EPS
  })
  return mic.filter((_, i) => !(matched[i] && (matched[i - 1] || matched[i + 1])))
}

// Слияние двух дорожек по времени в реплики. S0 — микрофон, S1 — системный звук.
export function mergeChannels(
  mic: ChannelWord[],
  sys: ChannelWord[],
  names: [string, string]
): { speakers: SpeakerInfo[]; turns: Turn[] } {
  const speakers: SpeakerInfo[] = [
    { id: 'S0', engineLabel: 'mic', name: names[0], colorKey: 'spk1' },
    { id: 'S1', engineLabel: 'sys', name: names[1], colorKey: 'spk2' }
  ]

  const all = [
    ...mic.map((w) => ({ w, ch: 0 })),
    ...sys.map((w) => ({ w, ch: 1 }))
  ]
  // Сортировка стабильная; при равном s микрофон идёт первым (он добавлен раньше).
  all.sort((a, b) => a.w.s - b.w.s || a.ch - b.ch)

  const turns: Turn[] = []
  let wordId = 0
  let cur: Turn | null = null
  let curCh = -1
  let lastEnd = 0
  for (const { w, ch } of all) {
    // Долгая тишина внутри одного канала — тоже новая реплика.
    const gap = w.s - lastEnd
    if (!cur || ch !== curCh || gap >= SPLIT_SILENCE_SEC) {
      cur = { id: 'T' + turns.length, spk: 'S' + ch, startSec: w.s, words: [] }
      curCh = ch
      turns.push(cur)
    }
    const word: Word = { id: wordId++, s: w.s, e: w.e, t: w.t }
    if (w.p !== undefined) word.p = w.p
    cur.words.push(word)
    lastEnd = Math.max(w.e, w.s)
  }
  return { speakers, turns }
}

// Сдвиг времени: расшифровали только кусок файла, а слова нужны в общей шкале.
// Округляем до сотых: иначе 1.38 + 8 даёт 9.379999… (живой прогон).
const r2 = (x: number): number => Math.round(x * 100) / 100

export function offsetTurns(turns: Turn[], sec: number): Turn[] {
  return turns.map((t) => ({
    ...t,
    startSec: r2(t.startSec + sec),
    words: t.words.map((w) => {
      const c: Word = { ...w }
      if (isNum(w.s)) c.s = r2(w.s + sec)
      if (isNum(w.e)) c.e = r2(w.e + sec)
      return c
    })
  }))
}

// Имена применяются по порядку первого появления в речи: кто заговорил первым — тот names[0].
export function applySpeakerNames(
  speakers: SpeakerInfo[],
  turns: Turn[],
  names: string[]
): SpeakerInfo[] {
  const known = new Set(speakers.map((s) => s.id))
  const order: string[] = []
  for (const t of turns) {
    if (known.has(t.spk) && !order.includes(t.spk)) order.push(t.spk)
  }
  return speakers.map((s) => {
    const name = names[order.indexOf(s.id)]?.trim()
    return order.includes(s.id) && name ? { ...s, name } : { ...s }
  })
}
