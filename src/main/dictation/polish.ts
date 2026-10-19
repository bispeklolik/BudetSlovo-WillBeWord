// ИИ-чистка надиктовки. Уроки из CHANGELOG OpenWhispr:
//  - модель норовит ОТВЕТИТЬ на продиктованный вопрос («какая погода?» → прогноз)
//    вместо чистки — нужна жёсткая роль, текст в тегах и повтор правила в конце;
//  - обрезанный по лимиту ответ нельзя вставлять как готовый;
//  - пустой/подозрительный ответ не должен съедать диктовку — тогда вставляем сырой.
// Живой прогон на qwen2.5:7b добавил ещё два урока: маленькая модель выкидывает
// слова просьбы («напиши мне…») и съезжает в чужую письменность (иероглифы).
// Промт короткий: инварианты + два примера-контекста (см. «промпты чинить вычитанием»).
// Промты всех режимов (чистка, письмо, сообщение, заметка, свои) — в shared/dictModes.ts.

import { buildPolishSystem } from '../../shared/dictModes'

/** «Обычная чистка» без словаря — тот же текст, что прошёл живой прогон. */
export const POLISH_SYSTEM = buildPolishSystem('clean', 'neutral', [], [])

export function wrapForPolish(raw: string, reformat = false): string {
  return `<transcript>\n${raw}\n</transcript>\n\n${reformat ? 'Выведи только готовый текст.' : 'Выведи только очищенный текст надиктовки.'}`
}

/** Метка, которую провайдеры дописывают к ответу, упёршемуся в лимит токенов. */
const TRUNCATED = '[ответ обрезан'

// Обычные слова писем и заметок — их режим добавляет законно, это не выдумка.
const BOILERPLATE = new Set([
  'здравствуйте', 'добрый', 'уважаемый', 'уважаемая', 'уважаемые', 'уважением', 'спасибо', 'благодарю',
  'пожалуйста', 'хорошего', 'всего', 'доброго', 'привет', 'клиент', 'клиентка', 'клиента', 'клиенту', 'сессии', 'сессия'
])

// Паразиты не считаем «значимыми словами»: их чистка и должна убрать.
const FILLERS = new Set([
  'короче', 'типа', 'значит', 'вообще', 'вообщем', 'кстати', 'просто', 'собственно', 'блин', 'вот',
  'like', 'basically', 'actually', 'literally'
])

const norm = (w: string): string => w.toLowerCase().replace(/ё/g, 'е')

function contentWords(text: string): string[] {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).map(norm).filter((w) => w.length >= 4 && !FILLERS.has(w))
}

/** Письменности, которых не было в надиктовке (иероглифы, арабская вязь…). */
function foreignScript(raw: string, out: string): boolean {
  const scripts = [/\p{Script=Han}/u, /\p{Script=Hiragana}/u, /\p{Script=Katakana}/u, /\p{Script=Hangul}/u, /\p{Script=Arabic}/u, /\p{Script=Hebrew}/u, /\p{Script=Thai}/u, /\p{Script=Devanagari}/u]
  return scripts.some((re) => re.test(out) && !re.test(raw))
}

/**
 * Принять ли ответ модели. null → вставляем сырой текст (лучше сырой, чем
 * испорченный или потерянный). reformat — режим переписывает текст (письмо,
 * заметка): длина может заметно меняться, слова — перефразироваться.
 */
export function acceptPolished(
  raw: string,
  polished: string | null | undefined,
  opts: { reformat?: boolean } = {}
): string | null {
  let p = (polished ?? '').trim().replace(/^<\/?transcript>|<\/?transcript>$/g, '').trim()
  // Заготовки «[Ваше имя]» отдельной строкой — убрать, а не вставлять человеку.
  if (opts.reformat) p = p.split('\n').filter((l) => !/^\s*\[[^\]]{1,40}\]\s*$/.test(l)).join('\n').trim()
  if (!p) return null
  if (p.includes(TRUNCATED)) return null
  if (foreignScript(raw, p)) return null
  const r = raw.trim()
  // Чистка убирает паразиты, но не половину смысла: сильно короче — модель
  // что-то выкинула; сильно длиннее — модель отвечала или сочиняла.
  const [minK, maxK, maxAdd, keep] = opts.reformat ? [0.25, 3, 300, 0.5] : [0.4, 1.6, 60, 0.75]
  if (p.length < r.length * minK) return null
  if (p.length > r.length * maxK + maxAdd) return null
  // Большинство значимых слов надиктовки должно остаться (с поправкой на
  // самоисправления, которые законно убирают слово-другое).
  const want = contentWords(r)
  if (want.length >= 3) {
    const have = new Set(contentWords(p))
    const kept = want.filter((w) => have.has(w) || [...have].some((h) => h.startsWith(w.slice(0, 5)))).length
    if (kept / want.length < keep) return null
  }
  // Режим переписывает текст, но не сочиняет: если больше половины значимых слов
  // ответа — новые (не из надиктовки и не обычные слова писем), модель отвечала
  // на надиктовку («какая погода?» → прогноз), а не оформляла её.
  if (opts.reformat) {
    const src = contentWords(r)
    const out = contentWords(p).filter((w) => !BOILERPLATE.has(w))
    const novel = out.filter((w) => !src.some((s) => s.startsWith(w.slice(0, 5)) || w.startsWith(s.slice(0, 5))))
    if (novel.length > Math.max(5, out.length * 0.5)) return null
  }
  return p
}
