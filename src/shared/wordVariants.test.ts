import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  splitToken,
  shapeLike,
  shapeCore,
  confLevel,
  isUncertain,
  listUncertain,
  stepUncertain,
  buildIndex,
  soundCandidates,
  vocabCandidates,
  historyCandidates,
  engineVariant,
  mergeVariants,
  sameWordCount,
  looksLikeTypo,
  MIN_SOUND_FREQ
} from './wordVariants'
import { applyPatch } from './patches'
import type { ProjectMeta, Word, Turn } from './types'

const W = (id: number, t: string, p = 0.95, extra: Partial<Word> = {}): Word => ({ id, t, s: id, e: id + 0.5, p, ...extra })
const meta = (turns: Turn[]): ProjectMeta => ({ turns }) as unknown as ProjectMeta
const turn = (id: string, words: Word[]): Turn => ({ id, spk: 'S0', startSec: 0, words })

// Настоящий список слов: тесты порядка идут по нему.
const index = buildIndex(readFileSync(join(__dirname, '../main/words/data/ru_50k.txt'), 'utf8'))

describe('splitToken / shapeLike: пунктуация и заглавная буква', () => {
  it('отделяет знаки по краям', () => {
    expect(splitToken('Говорит,')).toEqual({ lead: '', core: 'Говорит', trail: ',' })
    expect(splitToken('«Слово».')).toEqual({ lead: '«', core: 'Слово', trail: '».' })
    expect(splitToken('кто-то')).toEqual({ lead: '', core: 'кто-то', trail: '' })
    expect(splitToken('...')).toEqual({ lead: '...', core: '', trail: '' })
  })
  it('сохраняет знаки и заглавную букву исходного слова', () => {
    expect(shapeLike('говорю', 'Говорит,')).toBe('Говорю,')
    expect(shapeLike('колит', '«коблит»')).toBe('«колит»')
    expect(shapeLike('колит', 'КОБЛИТ')).toBe('КОЛИТ')
  })
  it('слово словаря со своей заглавной остаётся как в словаре', () => {
    expect(shapeLike('Шварцман', 'шварцамана')).toBe('Шварцман')
    expect(shapeCore('КПТ', 'кпт')).toBe('КПТ')
  })
})

describe('уверенность и «неуверенные» слова', () => {
  it('low / mid по порогам; правленые и проверенные не подсвечиваются', () => {
    expect(confLevel(W(1, 'а', 0.3))).toBe('low')
    expect(confLevel(W(1, 'а', 0.6))).toBe('mid')
    expect(confLevel(W(1, 'а', 0.9))).toBe('')
    expect(confLevel(W(1, 'а', 0.3, { t0: 'б' }))).toBe('')
    expect(confLevel(W(1, 'а', 0.3, { ok: true }))).toBe('')
  })
  it('suspect от ИИ — тоже неуверенное, если слово не проверено', () => {
    expect(isUncertain(W(1, 'слово', 0.95, { src: 'suspect' }))).toBe(true)
    expect(isUncertain(W(1, 'слово', 0.95, { src: 'suspect', ok: true }))).toBe(false)
    expect(isUncertain(W(1, 'слово', 0.2, { t0: 'иное' }))).toBe(false)
  })
  it('Tab идёт по неуверенным и пропускает ok и правленые', () => {
    const turns = [
      turn('T0', [W(0, 'а'), W(1, 'б', 0.3), W(2, 'в', 0.3, { ok: true })]),
      turn('T1', [W(3, 'г', 0.4, { t0: 'ггг' }), W(4, 'д', 0.5), W(5, 'е')])
    ]
    expect(listUncertain(turns).map((u) => u.wordId)).toEqual([1, 4])
    expect(stepUncertain(turns, null, 1)?.wordId).toBe(1)
    expect(stepUncertain(turns, 1, 1)?.wordId).toBe(4)
    expect(stepUncertain(turns, 4, 1)).toBeNull()
    expect(stepUncertain(turns, 4, -1)?.wordId).toBe(1)
    expect(stepUncertain(turns, 2, 1)?.wordId).toBe(4) // от проверенного слова — к следующему
    expect(stepUncertain(turns, 1, -1)).toBeNull()
  })
})

describe('слой «по звучанию»', () => {
  it('«тревоха» → «тревога» среди вариантов; само слово не вариант', () => {
    const v = soundCandidates('тревоха', index).map((x) => x.text)
    expect(v[0]).toBe('тревога')
    expect(v).not.toContain('тревоха')
  })
  it('слово с тем же звуковым ключом идёт первым', () => {
    const tiny = buildIndex('рад 100\nрот 100\nрат 100')
    // «рат» звучит как «рад» (тот же ключ); «рот» отличается гласной
    const v = soundCandidates('ррад', tiny).map((x) => x.text)
    expect(v[0]).toBe('рад')
  })
  it('беречь форму окончания: вариант с тем же окончанием выше', () => {
    // «кошка» и «мошки» одинаково далеки от «кошки», но у «мошки» то же окончание
    const tiny = buildIndex('кошка 100\nмошки 100')
    const v = soundCandidates('кошки', tiny).map((x) => x.text)
    expect(v).toEqual(['мошки', 'кошка'])
  })
  it('при равной близости частое слово выше редкого', () => {
    const tiny = buildIndex('колет 5\nкалит 5000')
    expect(soundCandidates('колит', tiny).map((x) => x.text)[0]).toBe('калит')
  })
  it('регистр и знаки не мешают поиску; короткие слова не ищем', () => {
    expect(soundCandidates('Тревоха,', index).map((x) => x.text)).toContain('тревога')
    expect(soundCandidates('я', index)).toEqual([])
    expect(soundCandidates('abc', index)).toEqual([])
  })
  it('быстро на 50 тысячах слов', () => {
    const t0 = performance.now()
    for (let i = 0; i < 5; i++) soundCandidates('тревожность', index)
    expect((performance.now() - t0) / 5).toBeLessThan(150)
  })
})

describe('словарь пользователя и прошлые правки', () => {
  it('слова словаря, близкие по звучанию, и цель точной замены', () => {
    const vocab = { words: ['Шварцман', 'Анна Ивановна', 'гештальт'], replacements: [{ from: 'кпт', to: 'КПТ' }] }
    expect(vocabCandidates('шварцамана', vocab).map((v) => v.text)).toContain('Шварцман')
    expect(vocabCandidates('кпт', vocab).map((v) => v.text)).toEqual(['КПТ'])
    expect(vocabCandidates('совсем-другое', vocab)).toEqual([])
    // фразы не показываем
    expect(vocabCandidates('анна', vocab).map((v) => v.text)).not.toContain('Анна Ивановна')
  })
  it('прошлая правка записи: движок писал «коблит», человек поправил на «колит»', () => {
    const turns = [turn('T0', [W(0, 'колит', 0.9, { t0: 'коблит' })])]
    expect(historyCandidates('коблит,', turns)).toEqual([{ text: 'колит', basis: 'history' }])
    expect(historyCandidates('совсем', turns)).toEqual([])
  })
  it('слово, которое уже правили, предлагает «как распознал движок»', () => {
    expect(engineVariant(W(0, 'колит', 0.9, { t0: 'коблит,' }))).toEqual([{ text: 'коблит', basis: 'engine' }])
    expect(engineVariant(W(0, 'колит'))).toEqual([])
  })
})

describe('слияние слоёв', () => {
  it('порядок слоёв, без повторов, без самого слова, не больше 5', () => {
    const out = mergeVariants(
      [
        [{ text: 'Колит', basis: 'vocab' }],
        [
          { text: 'колит', basis: 'meaning' },
          { text: 'колик', basis: 'meaning' }
        ],
        [
          { text: 'коблит', basis: 'sound' },
          { text: 'калит', basis: 'sound' },
          { text: 'клит', basis: 'sound' },
          { text: 'кулит', basis: 'sound' },
          { text: 'килит', basis: 'sound' }
        ]
      ],
      'коблит,'
    )
    expect(out.map((v) => v.text)).toEqual(['Колит', 'колик', 'калит', 'клит', 'кулит'])
    expect(out[0].basis).toBe('vocab')
  })
})

describe('сколько таких слов ещё в записи', () => {
  it('считает без знаков и регистра, без самого слова и без правленых', () => {
    const turns = [turn('T0', [W(0, 'коблит'), W(1, 'Коблит,'), W(2, 'коблит.', 0.9, { t0: 'x' }), W(3, 'иное')])]
    expect(sameWordCount(turns, 'коблит', 0)).toBe(1)
  })
})

describe('патч replaceWordAll: слово целиком', () => {
  const base = (): ProjectMeta =>
    meta([turn('T0', [W(0, 'Коблит,'), W(1, 'коблит'), W(2, 'коблитный'), W(3, 'КОБЛИТ!'), W(4, '«коблит»')])])

  it('меняет слово целиком, не подстроку; знаки и заглавная у каждого свои', () => {
    const m = base()
    applyPatch(m, { op: 'replaceWordAll', from: 'коблит', to: 'колит' })
    expect(m.turns![0].words.map((w) => w.t)).toEqual(['Колит,', 'колит', 'коблитный', 'КОЛИТ!', '«колит»'])
  })
  it('запоминает исходный текст движка в t0', () => {
    const m = base()
    applyPatch(m, { op: 'replaceWordAll', from: 'Коблит,', to: 'колит' })
    expect(m.turns![0].words[0].t0).toBe('Коблит,')
    expect(m.turns![0].words[2].t0).toBeUndefined()
  })
  it('уже правленые слова не трогает, но слово alsoWordId меняет всегда', () => {
    const m = meta([turn('T0', [W(0, 'коблит', 0.9, { t0: 'коплит' }), W(1, 'коблит')])])
    applyPatch(m, { op: 'replaceWordAll', from: 'коблит', to: 'колит' })
    expect(m.turns![0].words.map((w) => w.t)).toEqual(['коблит', 'колит'])
    applyPatch(m, { op: 'replaceWordAll', from: 'коблит', to: 'колит', alsoWordId: 0 })
    expect(m.turns![0].words[0].t).toBe('колит')
    expect(m.turns![0].words[0].t0).toBe('коплит') // исходный текст движка остался первым
  })
  it('снимает пометку «верное» с изменённого слова', () => {
    const m = meta([turn('T0', [W(0, 'коблит', 0.3, { ok: true })])])
    applyPatch(m, { op: 'replaceWordAll', from: 'коблит', to: 'колит', alsoWordId: 0 })
    expect(m.turns![0].words[0].ok).toBeUndefined()
  })
})

describe('патч setWordOk: «Слово верное»', () => {
  it('ставит и снимает пометку, подсветка пропадает и возвращается', () => {
    const m = meta([turn('T0', [W(0, 'слово', 0.3)])])
    applyPatch(m, { op: 'setWordOk', turnId: 'T0', wordId: 0, ok: true })
    expect(m.turns![0].words[0].ok).toBe(true)
    expect(isUncertain(m.turns![0].words[0])).toBe(false)
    applyPatch(m, { op: 'setWordOk', turnId: 'T0', wordId: 0, ok: false })
    expect(m.turns![0].words[0].ok).toBeUndefined()
    expect(isUncertain(m.turns![0].words[0])).toBe(true)
  })
  it('неизвестное слово ничего не ломает', () => {
    const m = meta([turn('T0', [W(0, 'а')])])
    applyPatch(m, { op: 'setWordOk', turnId: 'нет', wordId: 0, ok: true })
    applyPatch(m, { op: 'setWordOk', turnId: 'T0', wordId: 99, ok: true })
    expect(m.turns![0].words[0].ok).toBeUndefined()
  })
})

describe('исправления после проверки', () => {
  it('слой «по звучанию» не предлагает опечатки субтитров (перепроверка)', () => {
    const idx = buildIndex('здравствуйте 28754\nздраствуйте 318\nдравствуйте 191\nздравствуй 9000')
    const all = soundCandidates('здраствуйте', idx).map((x) => x.text)
    expect(all).toContain('дравствуйте') // без порога — как есть
    const shown = soundCandidates('здраствуйте', idx, 8, MIN_SOUND_FREQ).map((x) => x.text)
    expect(shown).toContain('здравствуйте')
    expect(shown).not.toContain('дравствуйте')
    expect(looksLikeTypo('здраствуйте', 318, idx)).toBe(true)
  })
  it('редкие настоящие слова психологии проходят порог, формы слова — не опечатки', () => {
    const idx = buildIndex('проекция 143\nпроекции 900\nагрессия 249\nагрессии 6000\nагресия 12')
    const shown = soundCandidates('проэкция', idx, 8, MIN_SOUND_FREQ).map((x) => x.text)
    expect(shown).toContain('проекция')
    expect(looksLikeTypo('агрессия', 249, idx)).toBe(false) // отличается от «агрессии» окончанием
    expect(looksLikeTypo('плот', 100, buildIndex('пот 99999\nплот 100'))).toBe(false) // короткие не трогаем
  })
  it('«пришёл» и «пришел» в списке вариантов — один вариант', () => {
    const out = mergeVariants([[{ text: 'пришёл', basis: 'sound' }, { text: 'пришел', basis: 'sound' }]], 'пришол')
    expect(out.map((v) => v.text)).toEqual(['пришёл'])
  })
  it('слово с «Слово верное» не подсвечено', () => {
    expect(confLevel(W(1, 'тест', 0.3))).toBe('low')
    expect(confLevel(W(1, 'тест', 0.3, { ok: true }))).toBe('')
  })
})
