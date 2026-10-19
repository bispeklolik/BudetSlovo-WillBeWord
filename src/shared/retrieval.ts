import type { ProjectMeta, Turn } from './types'
import { buildAnonOverlay, anonTurnText, anonPlain } from './anon'

// «Спросить записи»: ИИ не может прочитать сто двухчасовых сессий разом —
// режем записи на куски (несколько реплик подряд), находим куски по словам
// вопроса (BM25 по упрощённым основам слов) и отдаём модели только их.
// Каждый кусок помнит запись и время — ответ ссылается на него как [3].

export interface Passage {
  slug: string
  title: string
  startSec: number
  /** Текст куска строками «Имя: реплика» (обезличенный, если так попросили) — его видит ИИ. */
  text: string
  /** Тот же кусок без обезличивания — показать человеку. */
  plain: string
  /** Дата записи (createdAt) — упорядочить куски по времени. */
  date: string
  /** Название записи для ИИ (обезличенное, если просили). title — для человека. */
  label?: string
}

// Окончания русских слов — от длинных к коротким. Грубо, зато без словарей:
// «матерью/матери» → «матер», «говорила/говорил» → «говор».
const ENDINGS = [
  'иями', 'ями', 'ами', 'ией', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ешь', 'ете', 'ишь', 'ите',
  'ует', 'уют', 'ала', 'ила', 'ыла', 'ела', 'ать', 'ять', 'ить', 'еть', 'уть', 'ла', 'ли', 'ло',
  'ия', 'ие', 'ий', 'ой', 'ей', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ом', 'ем', 'ам', 'ям', 'ах',
  'ях', 'ов', 'ев', 'ую', 'юю', 'ою', 'ею', 'ью', 'ет', 'ит', 'ут', 'ют', 'ат', 'ят', 'ал', 'ил',
  'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й'
]

// Слова без смысла для поиска: служебные и вопросительные.
const STOP = new Set(
  (
    'и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня ' +
    'еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там ' +
    'потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе ' +
    'под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были ' +
    'куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них ' +
    'какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда ' +
    'конечно всю между это говорил говорила сказал сказала клиент клиентка расскажи скажи какие каких сессий сессии ' +
    'сессиях сессия запись записи записях разговор разговоре'
  ).split(' ')
)

export function stem(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, 'е')
  if (w.length <= 3) return w
  for (const e of ENDINGS) {
    if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length)
  }
  return w
}

/** Слова текста → основы для поиска (без служебных слов и цифр-одиночек). */
export function terms(text: string): string[] {
  return (text.toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]+/g) ?? [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
}

const speakerName = (meta: ProjectMeta, spk: string): string =>
  meta.speakers?.find((s) => s.id === spk)?.name ?? spk

// С обезличиванием — и имя говорящего (его часто переименовывают в имя клиента).
function turnLine(meta: ProjectMeta, t: Turn, overlay: Map<number, string> | null): string {
  const text = overlay ? anonTurnText(t, overlay) : t.words.map((w) => w.t).join(' ').replace(/\s+/g, ' ').trim()
  const name = speakerName(meta, t.spk)
  return `${overlay ? anonPlain(name, meta.anon) : name}: ${text}`
}

/** Правила обезличивания записи (если есть) → наложение; иначе null. */
export function anonOverlayFor(meta: ProjectMeta, anon: boolean): Map<number, string> | null {
  if (!anon || !meta.anon?.length || !meta.turns) return null
  return buildAnonOverlay(meta.turns, meta.anon)
}

/**
 * Запись → куски по ~maxChars из целых реплик подряд. Соседние куски
 * перекрываются одной репликой, чтобы ответ на стыке не терялся.
 */
export function buildPassages(meta: ProjectMeta, opts: { maxChars?: number; anon?: boolean } = {}): Passage[] {
  const maxChars = opts.maxChars ?? 900
  const turns = (meta.turns ?? []).filter((t) => t.words.length)
  const overlay = anonOverlayFor(meta, !!opts.anon)
  // Границы кусков — по исходному тексту: с обезличиванием и без они совпадают.
  const plain = turns.map((t) => turnLine(meta, t, null))
  const lines = overlay ? turns.map((t) => turnLine(meta, t, overlay)) : plain
  const out: Passage[] = []
  let i = 0
  while (i < turns.length) {
    let j = i
    let len = 0
    while (j < turns.length && (j === i || len + plain[j].length + 1 <= maxChars)) {
      len += plain[j].length + 1
      j++
    }
    out.push({
      slug: meta.slug,
      title: meta.title,
      startSec: turns[i].startSec,
      text: lines.slice(i, j).join('\n'),
      plain: plain.slice(i, j).join('\n'),
      date: meta.createdAt,
      label: overlay ? anonPlain(meta.title, meta.anon) : meta.title
    })
    if (j >= turns.length) break
    // Перекрытие одной репликой — но не застревать на одной длинной.
    i = j - 1 > i ? j - 1 : j
  }
  return out
}

/**
 * Лучшие куски под вопрос (BM25). Основа слова вопроса совпадает со словом
 * текста, если одна начинается с другой («мат» ~ «матер»). Не больше perDoc
 * кусков с одной записи, чтобы ответ «за 5 сессий» видел все сессии.
 */
export function rankPassages(
  passages: Passage[],
  queryTerms: string[],
  opts: { limit?: number; perDoc?: number; budgetChars?: number } = {}
): Passage[] {
  const q = [...new Set(queryTerms.filter((t) => t.length >= 2))]
  if (!q.length || !passages.length) return []
  const limit = opts.limit ?? 12
  const perDoc = opts.perDoc ?? 4
  const budget = opts.budgetChars ?? Infinity

  const docs = passages.map((p) => terms(p.text))
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1
  const matches = (term: string, tok: string): boolean =>
    tok === term || (term.length >= 3 && tok.length >= 3 && (tok.startsWith(term) || term.startsWith(tok)))

  // Сколько кусков содержит основу — для веса редких слов (IDF).
  const df = q.map((term) => docs.filter((d) => d.some((tok) => matches(term, tok))).length)
  const N = docs.length
  const k1 = 1.2
  const b = 0.75

  const scored = docs.map((d, idx) => {
    let score = 0
    q.forEach((term, qi) => {
      if (!df[qi]) return
      const tf = d.filter((tok) => matches(term, tok)).length
      if (!tf) return
      const idf = Math.log(1 + (N - df[qi] + 0.5) / (df[qi] + 0.5))
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / avgLen))
    })
    return { idx, score }
  })

  const perSlug = new Map<string, number>()
  const out: Passage[] = []
  let used = 0
  for (const { idx, score } of scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)) {
    const p = passages[idx]
    const n = perSlug.get(p.slug) ?? 0
    if (n >= perDoc) continue
    if (used + p.text.length > budget && out.length) continue
    perSlug.set(p.slug, n + 1)
    out.push(p)
    used += p.text.length
    if (out.length >= limit) break
  }
  return out
}

/** «1:02:03» / «12:34» — так время видно и в тексте ответа, и в ссылках. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Найденные куски по порядку: записи — по дате, внутри записи — по времени. */
export function chronological(ps: Passage[]): Passage[] {
  return [...ps].sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug) || a.startSec - b.startSec)
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU')
}

/**
 * Найденные куски → нумерованный контекст для модели, сгруппированный по
 * записям: маленькая модель лучше держит, из какой записи какая фраза.
 */
export function formatPassages(ps: Passage[]): string {
  const out: string[] = []
  let cur = ''
  ps.forEach((p, i) => {
    if (p.slug !== cur) {
      cur = p.slug
      const date = fmtDate(p.date)
      out.push(`### Запись «${p.label ?? p.title}»${date ? ` (${date})` : ''}`)
    }
    out.push(`[${i + 1}] ${clock(p.startSec)}\n${p.text}`)
  })
  return out.join('\n\n')
}

/** Вся запись с отметками времени у каждой реплики — когда она влезает целиком. */
export function timedTranscript(meta: ProjectMeta, anon: boolean): string {
  const overlay = anonOverlayFor(meta, anon)
  return (meta.turns ?? [])
    .filter((t) => t.words.length)
    .map((t) => `[${clock(t.startSec)}] ${turnLine(meta, t, overlay)}`)
    .join('\n')
}

// ---------- ссылки в ответе ----------
export type AnswerPart = { text: string } | { ref: number } | { sec: number; label: string }

/** «1:02:03» / «12:34» → секунды; не время — null. */
export function parseClock(s: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const sec = (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3]
  return +m[3] < 60 && (!m[1] || +m[2] < 60) ? sec : null
}

/**
 * Текст ответа → куски для показа: [3] — ссылка на найденный кусок (если
 * такой номер есть), [12:34] — переход ко времени записи. Модель иногда
 * пишет «[1, 3]» или «[1][3]» — разбираем и так.
 */
export function parseAnswer(answer: string, maxRef: number): AnswerPart[] {
  const out: AnswerPart[] = []
  const re = /\[([0-9:,\s]+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  const pushText = (t: string): void => {
    if (!t) return
    const prev = out[out.length - 1]
    if (prev && 'text' in prev) prev.text += t
    else out.push({ text: t })
  }
  while ((m = re.exec(answer))) {
    const items = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    const parts: AnswerPart[] = []
    for (const it of items) {
      if (/^\d+$/.test(it) && +it >= 1 && +it <= maxRef) parts.push({ ref: +it })
      else {
        const sec = parseClock(it)
        if (sec !== null) parts.push({ sec, label: it })
      }
    }
    if (parts.length !== items.length || !parts.length) continue // не ссылка — оставить текстом
    pushText(answer.slice(last, m.index))
    out.push(...parts)
    last = m.index + m[0].length
  }
  pushText(answer.slice(last))
  return out
}

/** Номера ссылок, которые модель реально упомянула (для списка источников). */
export function citedRefs(answer: string, maxRef: number): number[] {
  const set = new Set<number>()
  for (const p of parseAnswer(answer, maxRef)) if ('ref' in p) set.add(p.ref)
  return [...set].sort((a, b) => a - b)
}

/** Ключевые слова, которые предложила модель (JSON-массив или строки через запятую). */
export function parseKeywords(raw: string): string[] {
  let list: unknown = null
  const m = /\[[\s\S]*\]/.exec(raw)
  if (m) {
    try {
      list = JSON.parse(m[0])
    } catch {
      list = null
    }
  }
  const words = Array.isArray(list)
    ? list.filter((x): x is string => typeof x === 'string')
    : raw.split(/[,\n;]/)
  return [...new Set(words.map((w) => w.replace(/^[\s\-*•"'«]+|[\s"'»]+$/g, '').trim()).filter((w) => w && w.length <= 40))].slice(0, 24)
}

/** Простой хэш строки (FNV-1a) — понять, менялся ли текст с прошлой выжимки. */
export function textHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + s.length.toString(36)
}
