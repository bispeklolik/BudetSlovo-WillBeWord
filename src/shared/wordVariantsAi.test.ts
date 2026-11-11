import { describe, it, expect } from 'vitest'
import {
  parseAiReply,
  filterAiVariants,
  buildFragment,
  aiItemsText,
  closeDict,
  AI_SCHEMA,
  AI_SYSTEM,
  CONTEXT_WORDS,
  keyLimit
} from './wordVariantsAi'
import { buildAnonOverlay } from './anon'
import type { Turn, Word } from './types'

const words = (texts: string[]): Word[] => texts.map((t, i) => ({ id: i, t, s: i, e: i + 0.5, p: 0.9 }))
const turn = (texts: string[]): Turn => ({ id: 'T0', spk: 'S0', startSec: 0, words: words(texts) })

describe('разбор ответа ИИ', () => {
  it('JSON по схеме', () => {
    const raw = JSON.stringify({ items: [{ id: 3, ok: false, variants: [{ text: 'колит', basis: 'sound' }] }] })
    expect(parseAiReply(raw)).toEqual([{ id: 3, ok: false, variants: [{ text: 'колит', basis: 'sound' }] }])
  })
  it('JSON в ```-блоке и варианты-строки', () => {
    const raw = '```json\n[{"id":1,"ok":true,"variants":["раз","два"]}]\n```'
    const r = parseAiReply(raw)
    expect(r[0].ok).toBe(true)
    expect(r[0].variants.map((v) => v.text)).toEqual(['раз', 'два'])
  })
  it('мусор вместо JSON — пустой список, без исключения', () => {
    expect(parseAiReply('не json')).toEqual([])
    expect(parseAiReply('{"items": 5}')).toEqual([])
    expect(parseAiReply('{"items":[null, {"id":"x"}, {"id":2}]}')).toEqual([{ id: 2, ok: false, variants: [] }])
  })
})

describe('защита от выдумок', () => {
  it('обрезает до 5 вариантов', () => {
    const raw = ['колит', 'колик', 'колет', 'калит', 'кулит', 'килит', 'клит'].map((text) => ({ text }))
    expect(filterAiVariants('коблит', raw)).toHaveLength(5)
  })
  it('выбрасывает далёкие по звучанию варианты, оставляет близкие', () => {
    const out = filterAiVariants('коблит', [{ text: 'колит' }, { text: 'желудок' }, { text: 'болезнь' }]).map((v) => v.text)
    expect(out).toEqual(['колит'])
  })
  it('слова словаря не выбрасывает, даже если далеки', () => {
    const out = filterAiVariants('коблит', [{ text: 'Шварцман' }], ['Шварцман']).map((v) => v.text)
    expect(out).toEqual(['Шварцман'])
  })
  it('не пропускает: само слово, повторы, несколько слов, латиницу и цифры', () => {
    const raw = [{ text: 'коблит' }, { text: 'Коблит,' }, { text: 'колит' }, { text: 'колит' }, { text: 'ко лит' }, { text: 'kolit' }, { text: 'кол1т' }, { text: '' }]
    expect(filterAiVariants('коблит', raw).map((v) => v.text)).toEqual(['колит'])
  })
  it('порог растёт с длиной слова', () => {
    expect(keyLimit(3)).toBe(1)
    expect(keyLimit(10)).toBe(4)
  })
})

describe('фрагмент фразы', () => {
  it('по 12 слов с каждой стороны', () => {
    const t = turn(Array.from({ length: 40 }, (_, i) => 'с' + i))
    const f = buildFragment(t, 20)!
    expect(f.left.split(' ')).toHaveLength(CONTEXT_WORDS)
    expect(f.right.split(' ')).toHaveLength(CONTEXT_WORDS)
    expect(f.word).toBe('с20')
    expect(f.left.endsWith('с19')).toBe(true)
    expect(f.right.startsWith('с21')).toBe(true)
  })
  it('на краю реплики берёт сколько есть; знаки у слова отбрасывает', () => {
    const f = buildFragment(turn(['Привет,', 'коблит,', 'мир']), 1)!
    expect(f).toEqual({ left: 'Привет,', word: 'коблит', right: 'мир' })
  })
  it('для облака слова вокруг обезличены, а закрытое обезличиванием слово не спрашиваем', () => {
    const t = turn(['Я', 'говорила', 'с', 'Марией', 'про', 'коблит', 'вчера'])
    const overlay = buildAnonOverlay([t], [{ find: 'Марией', replace: 'Клиент-1', kind: 'name' } as never])
    const f = buildFragment(t, 5, overlay)!
    expect(f.left).toBe('Я говорила с Клиент-1 про')
    expect(f.left).not.toContain('Мари')
    expect(buildFragment(t, 3, overlay)).toBeNull()
  })
  it('нет такого слова — null', () => {
    expect(buildFragment(turn(['а']), 99)).toBeNull()
  })
})

describe('запрос', () => {
  it('слово в рамке, уверенность, словарь, подсказки; схема строгая', () => {
    const text = aiItemsText([{ id: 7, left: 'у меня', word: 'коблит', right: 'в боку', conf: 41, dict: ['Шварцман'], hints: ['колет'] }])
    expect(text).toContain('#7: у меня ⟦коблит⟧ в боку')
    expect(text).toContain('уверенность движка: 41%')
    expect(text).toContain('словарь: Шварцман')
    expect(text).toContain('по звучанию: колет')
    expect(AI_SCHEMA.additionalProperties).toBe(false)
    expect(AI_SCHEMA.properties.items.items.additionalProperties).toBe(false)
    expect(JSON.stringify(AI_SCHEMA)).not.toContain('maxItems')
  })
  it('в инструкции обязательное требование похожести по звучанию и правило «верное слово»', () => {
    expect(AI_SYSTEM).toContain('ЗВУЧАТ похоже')
    expect(AI_SYSTEM).toContain('ok: true')
  })
  it('слова словаря, близкие по звучанию, — не больше 20', () => {
    const many = Array.from({ length: 50 }, () => 'колит')
    expect(closeDict('коблит', many)).toHaveLength(20)
    expect(closeDict('коблит', ['Шварцман'])).toEqual([])
  })
})
