import type { AiProvider } from './provider'
import { generateSmart } from './smart'
import {
  buildPassages,
  rankPassages,
  formatPassages,
  chronological,
  timedTranscript,
  terms,
  parseKeywords,
  citedRefs,
  textHash,
  parseClock,
  type Passage
} from '../../shared/retrieval'
import {
  ASK_SYSTEM_MANY,
  ASK_SYSTEM_ONE,
  extractSystem,
  KEYWORDS_SYSTEM,
  BRIEF_SYSTEM,
  DYNAMICS_SYSTEM,
  buildAskInput,
  dynamicsInput,
  enhanceSystem
} from '../../shared/aiTasks'
import { buildAnonOverlay, anonTurnText, anonPlain } from '../../shared/anon'
import type { AnonRule, AskAnswer, AskSource, AskTurn, ProjectMeta } from '../../shared/types'

// Волна 4: вопросы к записям, конспект из моих заметок, динамика клиента.
// Облачной модели — текст с обезличиванием (если у записи есть правила):
// имена клиентов не уходят наружу. Локальной — как есть.

const anonFor = (p: AiProvider): boolean => !p.isLocal

// Живой прогон: qwen 7b раз съехал на китайский и английский посреди ответа.
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/

/** Ответ не по-русски: есть иероглифы или латиницы больше, чем кириллицы. */
export function looksForeign(s: string): boolean {
  if (CJK.test(s)) return true
  const lat = (s.match(/[a-z]/gi) ?? []).length
  const cyr = (s.match(/[а-яё]/gi) ?? []).length
  return lat + cyr > 40 && lat > cyr
}

/**
 * Провайдер с проверкой языка: ответ не по-русски — один повтор с напоминанием;
 * снова не по-русски — выкидываем строки с иероглифами, а если ничего не
 * осталось — честная ошибка вместо мусора.
 */
export function russianOnly(p: AiProvider): AiProvider {
  return {
    ...p,
    generate: async (system: string, text: string): Promise<string> => {
      const first = await p.generate(system, text)
      if (!looksForeign(first)) return first
      const second = await p.generate(system + ' Пиши только на русском языке.', text)
      if (!looksForeign(second)) return second
      const kept = second
        .split('\n')
        .filter((l) => !CJK.test(l))
        .join('\n')
        .trim()
      if (!kept || looksForeign(kept)) throw new Error('ИИ ответил не по-русски. Попробуйте ещё раз.')
      return kept
    }
  }
}

/** Модель ответила «нет ответа». */
const NONE_RE = /^[\s*_«"]*нет[\s.!»"]*$/i

/** Расшифровка «Имя: реплика» — с обезличиванием, если просят и есть правила. */
export function plainTranscript(meta: ProjectMeta, anon: boolean): string {
  const turns = meta.turns ?? []
  const overlay = anon && meta.anon?.length ? buildAnonOverlay(turns, meta.anon) : null
  const name = (spk: string): string => {
    const n = meta.speakers?.find((s) => s.id === spk)?.name ?? spk
    return overlay ? anonPlain(n, meta.anon) : n
  }
  return turns
    .filter((t) => t.words.length)
    .map((t) => name(t.spk) + ': ' + (overlay ? anonTurnText(t, overlay) : t.words.map((w) => w.t).join(' ')))
    .join('\n')
}

export { anonPlain }

/** Сколько текста отдаём модели за раз: локальная — 16k токенов, облачная — много больше. */
const budget = (p: AiProvider): { whole: number; ctx: number; limit: number; perDoc: number } =>
  p.isLocal
    ? { whole: 30_000, ctx: 16_000, limit: 10, perDoc: 3 }
    : { whole: 150_000, ctx: 70_000, limit: 24, perDoc: 6 }

/** Для облака: правила обезличивания на вопрос и прошлые вопросы-ответы (ревью волны 4). */
function scrubAsk(
  rules: AnonRule[] | undefined,
  question: string,
  history: AskTurn[]
): { question: string; history: AskTurn[] } {
  if (!rules?.length) return { question, history }
  return { question: anonPlain(question, rules), history: history.map((h) => ({ q: anonPlain(h.q, rules), a: anonPlain(h.a, rules) })) }
}

async function expandQuery(provider: AiProvider, question: string): Promise<string[]> {
  try {
    return parseKeywords(await provider.generate(KEYWORDS_SYSTEM, question))
  } catch {
    return [] // без подсказки модели ищем по словам вопроса
  }
}

function toSources(ps: Passage[], answer: string): AskSource[] {
  const all = ps.map((p, i) => ({
    n: i + 1,
    slug: p.slug,
    title: p.title,
    startSec: p.startSec,
    snippet: p.plain.length > 260 ? p.plain.slice(0, 260) + '…' : p.plain
  }))
  const cited = new Set(citedRefs(answer, ps.length))
  return cited.size ? all.filter((s) => cited.has(s.n)) : all
}

async function askPassages(
  provider: AiProvider,
  passages: Passage[],
  question: string,
  history: AskTurn[]
): Promise<AskAnswer> {
  const b = budget(provider)
  // Все записи влезают в модель — искать незачем, отдаём целиком.
  const total = passages.reduce((s, p) => s + p.text.length, 0)
  let found: Passage[]
  if (total <= b.ctx) found = chronological(passages)
  else {
    const extra = await expandQuery(provider, question)
    const q = terms([question, ...extra, ...history.slice(-1).map((h) => h.q)].join(' '))
    // Одна запись — лимит «кусков с записи» не нужен: он для разнообразия между
    // записями, а тут съедал почти весь бюджет (ревью волны 4: 3 куска из 16k).
    const single = new Set(passages.map((p) => p.slug)).size === 1
    found = chronological(
      rankPassages(passages, q, {
        limit: single ? 60 : b.limit,
        perDoc: single ? 60 : b.perDoc,
        budgetChars: b.ctx
      })
    )
  }
  if (!found.length) {
    return {
      answer:
        'По словам вопроса ничего не нашлось. Попробуйте спросить другими словами или нажмите «Искать внимательно» — ИИ прочитает каждую запись целиком (дольше).',
      sources: [],
      notFound: true
    }
  }
  const answer = (await provider.generate(ASK_SYSTEM_MANY, buildAskInput(question, history, formatPassages(found)))).trim()
  return { answer, sources: toSources(found, answer) }
}

/** Вопрос к одной записи: влезает целиком — отдаём всю (с временем реплик), иначе — найденные куски. */
export async function askRecording(
  rawProvider: AiProvider,
  meta: ProjectMeta,
  question: string,
  history: AskTurn[],
  thorough = false
): Promise<AskAnswer> {
  const provider = russianOnly(rawProvider)
  if (!meta.turns?.length) throw new Error('Сначала расшифруйте запись.')
  const anon = anonFor(provider)
  ;({ question, history } = anon ? scrubAsk(meta.anon, question, history) : { question, history })
  const timed = timedTranscript(meta, anon)
  // «Искать внимательно»: всю запись по частям, ответ — со временем реплик.
  if (thorough) {
    // Вопрос — в system: длинную запись модель читает частями, и вопрос нужен каждой части.
    const raw = (await generateSmart(provider, extractSystem(question, history), timed)).trim()
    return { answer: NONE_RE.test(raw) ? 'Прочитал всю запись — ответа на этот вопрос в ней нет.' : raw, sources: [] }
  }
  if (timed.length <= budget(provider).whole) {
    const answer = (await provider.generate(ASK_SYSTEM_ONE, buildAskInput(question, history, timed))).trim()
    return { answer, sources: [] }
  }
  return askPassages(provider, buildPassages(meta, { anon }), question, history)
}

/** Записи папки (вместе с подпапками); пустая папка — все. Пример из первого запуска не считается. */
export function projectsIn(projects: ProjectMeta[], folder: string | null): ProjectMeta[] {
  const f = (folder ?? '').trim()
  return projects.filter(
    (p) => !p.demo && p.turns?.length && (!f || p.folder === f || (p.folder ?? '').startsWith(f + '/'))
  )
}

export async function askAll(
  rawProvider: AiProvider,
  projects: ProjectMeta[],
  question: string,
  history: AskTurn[]
): Promise<AskAnswer> {
  const provider = russianOnly(rawProvider)
  if (!projects.length) throw new Error('Здесь нет расшифрованных записей.')
  const anon = anonFor(provider)
  const asked = anon ? scrubAsk(projects.flatMap((p) => p.anon ?? []), question, history) : { question, history }
  return askPassages(provider, projects.flatMap((p) => buildPassages(p, { anon })), asked.question, asked.history)
}

/** Реплика записи на этом времени (для превью источника). */
function snippetAt(meta: ProjectMeta, sec: number): string {
  const turns = (meta.turns ?? []).filter((t) => t.words.length)
  let best = turns[0]
  for (const t of turns) if (t.startSec <= sec + 0.5) best = t
  if (!best) return ''
  const name = meta.speakers?.find((s) => s.id === best.spk)?.name ?? best.spk
  const text = best.words.map((w) => w.t).join(' ')
  return `${name}: ${text.length > 240 ? text.slice(0, 240) + '…' : text}`
}

/**
 * «Искать внимательно»: ИИ читает каждую запись целиком (по порядку дат) и
 * выписывает, что относится к вопросу. Время [мм:сс] из выписки превращается в
 * ссылку-источник [n] на эту запись. Дольше, зато не зависит от слов вопроса.
 */
export async function askAllThorough(
  rawProvider: AiProvider,
  projects: ProjectMeta[],
  question: string,
  history: AskTurn[],
  progress: (done: number, total: number) => void
): Promise<AskAnswer> {
  const provider = russianOnly(rawProvider)
  if (!projects.length) throw new Error('Здесь нет расшифрованных записей.')
  const anon = anonFor(provider)
  ;({ question, history } = anon ? scrubAsk(projects.flatMap((p) => p.anon ?? []), question, history) : { question, history })
  const system = extractSystem(question, history)
  const list = [...projects].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const sources: AskSource[] = []
  const sections: string[] = []
  for (let i = 0; i < list.length; i++) {
    progress(i, list.length)
    const p = list[i]
    const raw = (await generateSmart(provider, system, timedTranscript(p, anon))).trim()
    // Длинную запись модель читает частями — части без ответа отвечают «НЕТ».
    const lines = raw.split('\n').filter((l) => l.trim() && !NONE_RE.test(l.replace(/^[-–•]\s*/, '')))
    if (!lines.length || NONE_RE.test(raw)) continue
    const text = lines.join('\n').replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (m, t: string) => {
      const sec = parseClock(t)
      if (sec === null) return m
      sources.push({ n: sources.length + 1, slug: p.slug, title: p.title, startSec: sec, snippet: snippetAt(p, sec) })
      return `[${sources.length}]`
    })
    sections.push(`${p.title}:\n${text}`)
  }
  progress(list.length, list.length)
  return {
    answer: sections.length ? sections.join('\n\n') : 'Прочитал все записи — ответа на этот вопрос в них нет.',
    sources
  }
}

/** Конспект «как Granola»: мои заметки — каркас, расшифровка — подробности. */
export async function enhanceNotes(rawProvider: AiProvider, meta: ProjectMeta): Promise<string> {
  const provider = russianOnly(rawProvider)
  const notes = (meta.myNotes ?? '').trim()
  if (!notes) throw new Error('Сначала напишите свои заметки к этой записи.')
  if (!meta.turns?.length) throw new Error('Сначала расшифруйте запись.')
  const anon = anonFor(provider)
  const system = enhanceSystem(anon ? anonPlain(notes, meta.anon) : notes)
  return (await generateSmart(provider, system, plainTranscript(meta, anon))).trim()
}

/**
 * Выжимка одной сессии для динамики. Готовую берём из записи, если текст с тех
 * пор не менялся (хэш), — повторная «Динамика» не гоняет модель заново.
 * Возвращает выжимку и признак «сделана заново» (её надо сохранить в запись).
 */
export async function sessionBrief(
  provider: AiProvider,
  meta: ProjectMeta
): Promise<{ text: string; hash: string; fresh: boolean }> {
  const input = plainTranscript(meta, anonFor(provider))
  const hash = textHash(input)
  if (meta.brief?.hash === hash && meta.brief.text.trim()) return { ...meta.brief, fresh: false }
  const text = (await generateSmart(provider, BRIEF_SYSTEM, input)).trim()
  return { text, hash, fresh: true }
}

export const DYNAMICS_MAX_SESSIONS = 12

/** Порядок сессий — по дате записи в проекте (от ранней к поздней), последние 12. */
export function dynamicsSessions(projects: ProjectMeta[], folder: string): ProjectMeta[] {
  return projectsIn(projects, folder)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-DYNAMICS_MAX_SESSIONS)
}

export async function clientDynamics(
  rawProvider: AiProvider,
  sessions: ProjectMeta[],
  hooks: {
    progress: (done: number, total: number) => void
    /** Новая выжимка — сохранить в запись, чтобы в следующий раз не считать заново. */
    saveBrief: (meta: ProjectMeta, brief: { text: string; hash: string }) => void
  }
): Promise<string> {
  const provider = russianOnly(rawProvider)
  if (sessions.length < 2) throw new Error('Для динамики нужны хотя бы две расшифрованные записи в папке.')
  const briefs: { title: string; date: string; brief: string }[] = []
  for (let i = 0; i < sessions.length; i++) {
    const m = sessions[i]
    hooks.progress(i, sessions.length + 1)
    const b = await sessionBrief(provider, m)
    if (b.fresh) hooks.saveBrief(m, { text: b.text, hash: b.hash })
    const title = anonFor(provider) ? anonPlain(m.title, m.anon) : m.title
    briefs.push({ title, date: new Date(m.createdAt).toLocaleDateString('ru-RU'), brief: b.text })
  }
  hooks.progress(sessions.length, sessions.length + 1)
  return (await generateSmart(provider, DYNAMICS_SYSTEM, dynamicsInput(briefs))).trim()
}
