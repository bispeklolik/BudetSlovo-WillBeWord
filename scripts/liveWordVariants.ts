// Живой прогон подбора вариантов неуверенного слова (волна 7) на НАСТОЯЩЕМ ИИ.
// Данные только вымышленные: придуманные фразы из разговора психолога с клиентом, одно слово
// заменено правдоподобной ошибкой распознавания. Ключ читается из settings.json и нигде не печатается.
//
// Сборка и запуск (из корня проекта):
//   npx esbuild scripts/liveWordVariants.ts --bundle --platform=node --outfile=<tmp>/live.cjs
//   node <tmp>/live.cjs <путь к settings.json>
import { readFileSync } from 'fs'
import { join } from 'path'
import { claudeProvider, setClaudeConfig, onWordVariantsUsage } from '../src/main/ai/claude'
import { askAi } from '../src/main/ai/wordVariants'
import { buildIndex, mergeVariants, soundCandidates, normCore, type Variant } from '../src/shared/wordVariants'
import { keyLimit } from '../src/shared/wordVariantsAi'
import { phoneticKey } from '../src/shared/phonetic'
import type { AiProvider } from '../src/main/ai/provider'
import type { AiRawItem } from '../src/shared/wordVariantsAi'
import type { ProjectMeta, Turn } from '../src/shared/types'

// [слева, ошибка распознавания, справа, правильное слово]
const CASES: [string, string, string, string][] = [
  ['Последние две недели у меня сильная', 'тревога', 'по вечерам.', 'тревога'],
  ['Я начала замечать, что избегаю', 'обшения', 'с коллегами.', 'общения'],
  ['Когда он повышает голос, я сразу чувствую', 'страг', 'в животе.', 'страх'],
  ['Мы с мужем часто ссоримся из-за', 'дениг', 'и из-за уборки.', 'денег'],
  ['Врач сказал, что у меня хроническая', 'бесоница', 'и нужен режим.', 'бессонница'],
  ['Я боюсь, что меня', 'увалят', 'на следующей неделе.', 'уволят'],
  ['Мне трудно', 'даверять', 'людям после развода.', 'доверять'],
  ['Я чувствую постоянную', 'устолость', 'даже после отпуска.', 'усталость'],
  ['Давайте разберём, какая мысль вызывает такую', 'тревогу', 'в этот момент.', 'тревогу'], // без ошибки, но с низкой уверенностью
  ['На работе случился', 'кризес', 'и я не справилась.', 'кризис'],
  ['У меня были', 'паничиские', 'атаки в метро.', 'панические'],
  ['Мама всегда говорила, что я', 'сарвала', 'любой проект.', 'срываю'],
  ['После сессии я хожу с', 'хорошей', 'самоацэнкой совсем немного.', 'хорошей'], // без ошибки
  ['Он назначил мне', 'диагнос', 'и таблетки.', 'диагноз'],
  ['Мы работаем в подходе', 'гиштальт', 'терапии.', 'гештальт'],
  ['Моя', 'самоацэнка', 'падает после каждой критики.', 'самооценка'],
  ['Я хожу на', 'супервизею', 'раз в месяц.', 'супервизию'],
  ['Сын не хочет идти в', 'садик', 'и плачет по утрам.', 'садик'], // без ошибки
  ['Меня накрывает', 'обида', 'когда он молчит.', 'обида'], // без ошибки
  ['Я бы хотела научиться', 'расслаблятся', 'без таблеток.', 'расслабляться'],
  ['Вчера на встрече я', 'промолчала', 'хотя была не согласна.', 'промолчала'], // без ошибки
  ['Я записываю мысли в', 'дневнег', 'каждый вечер.', 'дневник'],
  ['Мне кажется, что я', 'недостойна', 'любви.', 'недостойна'], // без ошибки
  ['Расскажите подробнее про вашу', 'ситуацыю', 'с начальником.', 'ситуацию'],
  ['Мы договорились про', 'домошнее', 'задание на неделю.', 'домашнее'],
  ['Он постоянно меня', 'критекует', 'при детях.', 'критикует'],
  ['Я заметила, что стала более', 'раздражытельной', 'к близким.', 'раздражительной'],
  ['Перед сном я долго не могу', 'успакоиться', 'и думаю о работе.', 'успокоиться'],
  ['Мы разберём, как влияет', 'катостроффизация', 'на ваше состояние.', 'катастрофизация'],
  ['Лучше ходить на', 'прогулки', 'каждый день по сорок минут.', 'прогулки'] // без ошибки
]
const NO_ERROR_IDX = new Set(CASES.map((c, i) => (normCore(c[1]) === normCore(c[3]) ? i : -1)).filter((i) => i >= 0))

function sanitize(s: string, key: string): string {
  return key ? s.split(key).join('[ключ]') : s
}

function mkTurn(idStart: number, c: [string, string, string, string]): { turn: Turn; wordId: number; next: number } {
  let id = idStart
  const words = [...c[0].split(' '), c[1], ...c[2].split(' ')].map((t, i) => ({ id: id++, t, s: i, e: i + 0.5 }))
  const wi = c[0].split(' ').length
  words[wi] = { ...words[wi], p: 0.4 } as (typeof words)[number]
  return { turn: { id: 'T' + idStart, spk: 'S0', startSec: 0, words }, wordId: words[wi].id, next: id }
}

const pct = (n: number, d: number): string => (d ? Math.round((100 * n) / d) + ' %' : '-')

async function main(): Promise<void> {
  const settingsPath = process.argv[2]
  const key = String((JSON.parse(readFileSync(settingsPath, 'utf8')) as { anthropicKey?: string }).anthropicKey ?? '')
  if (!key) throw new Error('В settings.json нет ключа Anthropic')
  setClaudeConfig(key, undefined)
  const index = buildIndex(readFileSync(join(__dirname_root(), 'src/main/words/data/ru_50k.txt'), 'utf8'))

  // Обёртка записывает сырой ответ ИИ (до фильтра), чтобы видеть, что режет защита от выдумок.
  let lastRaw: AiRawItem[] = []
  const probe: AiProvider = {
    ...claudeProvider,
    wordVariants: async (items, opts) => {
      lastRaw = await claudeProvider.wordVariants!(items, opts)
      return lastRaw
    }
  }
  let usage = { input: 0, output: 0 }
  onWordVariantsUsage((u) => {
    usage = { input: usage.input + u.input, output: usage.output + u.output }
  })

  // ---- одиночные запросы: как по щелчку ----
  let top1 = 0
  let top5 = 0
  let aiTop1 = 0
  let aiTop5 = 0
  let falseFix = 0
  let noErrOk = 0
  let errCount = 0
  let rawHit = 0
  let filteredOut = 0
  const lat: number[] = []
  const rows: string[] = []
  usage = { input: 0, output: 0 }
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]
    const { turn, wordId } = mkTurn(0, c)
    const meta = { turns: [turn] } as unknown as ProjectMeta
    const t0 = Date.now()
    let entry
    try {
      entry = (await askAi(probe, meta, [wordId], undefined, { timeoutMs: 8000, index })).get(wordId)
    } catch (err) {
      rows.push(`${i + 1}. ОШИБКА ${sanitize(String(err instanceof Error ? err.message : err), key)}`)
      continue
    }
    lat.push(Date.now() - t0)
    const want = normCore(c[3])
    const ai = entry?.variants ?? []
    const sound: Variant[] = soundCandidates(c[1], index, 8)
    const shown = mergeVariants([ai, sound], c[1])
    const rawTexts = (lastRaw[0]?.variants ?? []).map((v) => normCore(v.text))
    if (NO_ERROR_IDX.has(i)) {
      // Слово верное: хорошо, если ИИ сказал ok:true; плохо — если предложил заменить.
      if (entry?.ok) noErrOk++
      if (!entry?.ok && ai.length) falseFix++
      rows.push(`${i + 1}. [верное] ${c[1]} -> ok=${entry?.ok} ai=[${ai.map((v) => v.text).join(', ')}]`)
      continue
    }
    errCount++
    const aiIdx = ai.findIndex((v) => normCore(v.text) === want)
    const shownIdx = shown.findIndex((v) => normCore(v.text) === want)
    if (aiIdx === 0) aiTop1++
    if (aiIdx >= 0) aiTop5++
    if (shownIdx === 0) top1++
    if (shownIdx >= 0) top5++
    if (rawTexts.includes(want)) rawHit++
    if (rawTexts.includes(want) && aiIdx < 0) filteredOut++
    rows.push(
      `${i + 1}. ${c[1]} -> ${c[3]} | ИИ: [${ai.map((v) => v.text).join(', ')}] ok=${entry?.ok} | показано: ${shownIdx >= 0 ? '#' + (shownIdx + 1) : 'нет'}` +
        (rawTexts.includes(want) && aiIdx < 0 ? ' | ОТСЕЯНО ФИЛЬТРОМ (ключи ' + phoneticKey(c[1]) + ' / ' + phoneticKey(c[3]) + ', порог ' + keyLimit(phoneticKey(c[1]).length) + ')' : '')
    )
  }
  const single = usage
  const nCalls = lat.length

  // ---- пачка из 12 слов одним запросом ----
  usage = { input: 0, output: 0 }
  const turns: Turn[] = []
  const ids: number[] = []
  let nid = 1000
  const errIdx = CASES.map((_, i) => i).filter((i) => !NO_ERROR_IDX.has(i)).slice(0, 12)
  for (const i of errIdx) {
    const m = mkTurn(nid, CASES[i])
    turns.push(m.turn)
    ids.push(m.wordId)
    nid = m.next
  }
  const bmeta = { turns } as unknown as ProjectMeta
  const tb = Date.now()
  const batch = await askAi(probe, bmeta, ids, undefined, { timeoutMs: 40_000, index })
  const batchMs = Date.now() - tb
  let bTop5 = 0
  let bTop1 = 0
  errIdx.forEach((ci, k) => {
    const v = batch.get(ids[k])?.variants ?? []
    const j = v.findIndex((x) => normCore(x.text) === normCore(CASES[ci][3]))
    if (j >= 0) bTop5++
    if (j === 0) bTop1++
  })
  const batchUsage = usage

  const price = (u: { input: number; output: number }): number => (u.input * 0.1 + u.output * 0.5) / 1e6
  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0)
  console.log(rows.join('\n'))
  console.log('\n===== ИТОГ (одиночные запросы) =====')
  console.log(`ошибочных слов: ${errCount}, верных слов: ${NO_ERROR_IDX.size}`)
  console.log(`только ИИ: топ-1 ${aiTop1}/${errCount} (${pct(aiTop1, errCount)}), топ-5 ${aiTop5}/${errCount} (${pct(aiTop5, errCount)})`)
  console.log(`как видит человек (ИИ + звучание): топ-1 ${top1}/${errCount} (${pct(top1, errCount)}), топ-5 ${top5}/${errCount} (${pct(top5, errCount)})`)
  console.log(`правильное слово было в сыром ответе: ${rawHit}/${errCount}; отсеяно фильтром: ${filteredOut}`)
  console.log(`верные слова: ok:true ${noErrOk}/${NO_ERROR_IDX.size}, ложных «исправлений» ${falseFix}/${NO_ERROR_IDX.size}`)
  console.log(`задержка: средняя ${Math.round(sum(lat) / (nCalls || 1))} мс, максимум ${Math.max(0, ...lat)} мс (запросов ${nCalls})`)
  console.log(`токены на 1 щелчок: вход ${Math.round(single.input / (nCalls || 1))}, выход ${Math.round(single.output / (nCalls || 1))}; цена 1 щелчка $${(price(single) / (nCalls || 1)).toFixed(6)}`)
  console.log('\n===== ПАЧКА 12 слов одним запросом =====')
  console.log(`топ-1 ${bTop1}/12, топ-5 ${bTop5}/12, время ${batchMs} мс, токены вход ${batchUsage.input}, выход ${batchUsage.output}, цена $${price(batchUsage).toFixed(6)} ($${(price(batchUsage) / 12).toFixed(6)} на слово)`)
}

function __dirname_root(): string {
  return process.cwd()
}

main().catch((err) => {
  console.error('СБОЙ:', String(err instanceof Error ? err.message : err).slice(0, 300))
  process.exit(1)
})
