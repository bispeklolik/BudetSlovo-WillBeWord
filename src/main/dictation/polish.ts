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

// Ответ — между <result> и </result>: всё, что модель пишет вокруг (пояснения,
// «нет, исправлю: …» — живой прогон Haiku 5.5, 09.11.2026), в поле не попадает.
export function wrapForPolish(raw: string, reformat = false): string {
  return `<transcript>\n${raw}\n</transcript>\n\n${
    reformat ? 'Выведи только готовый текст' : 'Выведи только очищенный текст надиктовки'
  }, один раз, между <result> и </result>.`
}

/** Текст из последнего блока <result>…</result>; нет блока — весь ответ. */
function resultText(s: string): string {
  const all = [...s.matchAll(/<result>([\s\S]*?)<\/result>/gi)]
  return all.length ? all[all.length - 1][1] : s.replace(/<\/?result>/gi, '')
}

// Модель «правит себя» вслух — признак сбоя, такой ответ не вставляем.
const SELF_TALK = /(исправлю|исправляю|исправленн\p{L}* вариант|вот (очищенный|исправленный|готовый) текст|вот текст)/iu

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

// Числительные: «пятнадцатое» законно становится «15» (числа цифрами) — не считаем их потерей.
const NUMERAL =
  /^(ноль|нол[яюе]|один|одн|дв[аеу]|двух|три|тр[её]х|четыр|пят[иь]?|шест|сем[ьи]$|восем|девят|десят|\p{L}+надцат|двадцат|тридцат|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяност|сто$|сотн|двест|трист|четырест|тысяч|миллион|миллиард|перв|втор|трет|четв[её]рт|половин|полтор)/u

/** Есть ли в тексте число — цифрами или словом («восемь», «девятьсот», «пятого»). */
function hasNumber(text: string): boolean {
  if (/\d/.test(text)) return true
  // «вторник», «четверг», «пятница» начинаются как числительные — это не числа.
  return (text.match(/[\p{L}]+/gu) ?? []).some((w) => NUMERAL.test(norm(w)) && !/^(вторник|четверг|пятниц)/.test(norm(w)))
}

function contentWords(text: string): string[] {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(norm)
    .filter((w) => w.length >= 4 && !FILLERS.has(w) && !NUMERAL.test(w) && !/^\d+$/.test(w))
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
  let p = resultText((polished ?? '').trim()).trim().replace(/^<\/?transcript>|<\/?transcript>$/g, '').trim()
  // Заготовки «[Ваше имя]» отдельной строкой — убрать, а не вставлять человеку.
  if (opts.reformat) p = p.split('\n').filter((l) => !/^\s*\[[^\]]{1,40}\]\s*$/.test(l)).join('\n').trim()
  if (!p) return null
  // Заготовка посреди текста («С уважением, [Ваше имя]») — режим не справился.
  if (opts.reformat && /\[[^\]\n]{1,40}\]/.test(p) && !/\[/.test(raw)) return null
  if (p.includes(TRUNCATED)) return null
  if (SELF_TALK.test(p) && !SELF_TALK.test(raw)) return null
  if (foreignScript(raw, p)) return null
  const r = raw.trim()
  // Чистка убирает паразиты, но не половину смысла: сильно короче — модель
  // что-то выкинула; сильно длиннее — модель отвечала или сочиняла.
  const [minK, maxK, maxAdd, keep] = opts.reformat ? [0.25, 3, 300, 0.5] : [0.4, 1.6, 60, 0.75]
  const want = contentWords(r)
  // Проверка «сильно короче» — только для коротких надиктовок, где не по чему
  // сверить смысл. Иначе смысл сверяем по значимым словам ниже: самоисправление
  // («нет, не во вторник, а в среду, в среду в пять») законно сокращает фразу
  // втрое, и облачная модель делает это правильно (живой прогон Haiku 5.5, 09.11.2026).
  if ((opts.reformat || want.length < 3) && p.length < r.length * minK) return null
  // Числа (телефон, дата, сумма) из сверки слов выпадают — проверяем отдельно:
  // в надиктовке число было, а в ответе пропало — ответ не годится (ревью волны 7).
  if (hasNumber(r) && !hasNumber(p)) return null
  if (p.length > r.length * maxK + maxAdd) return null
  // Большинство значимых слов надиктовки должно остаться (с поправкой на
  // самоисправления, которые законно убирают слово-другое).
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

/**
 * Ответ модели на правку выделенного: не пустой, не обрезанный, без чужой
 * письменности, без тегов. null — текст в окне не трогаем.
 */
export function acceptEdit(original: string, edited: string | null | undefined): string | null {
  const p = (edited ?? '').trim().replace(/^<\/?text>|<\/?text>$/g, '').trim()
  if (!p) return null
  if (p.includes(TRUNCATED)) return null
  if (foreignScript(original, p)) return null
  if (p.length > original.length * 4 + 600) return null
  return p
}
