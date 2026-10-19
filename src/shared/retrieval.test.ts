import { describe, it, expect } from 'vitest'
import {
  stem,
  terms,
  buildPassages,
  rankPassages,
  formatPassages,
  timedTranscript,
  parseAnswer,
  citedRefs,
  parseClock,
  parseKeywords,
  textHash,
  clock
} from './retrieval'
import type { ProjectMeta, Turn } from './types'

let wid = 0
function turn(spk: string, startSec: number, text: string): Turn {
  return { id: 't' + startSec, spk, startSec, words: text.split(' ').map((t) => ({ id: wid++, t, s: startSec })) }
}

function project(slug: string, turns: Turn[], extra: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    version: 1,
    id: slug,
    slug,
    title: 'Сессия ' + slug,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    audio: { file: 'audio.m4a', originalPath: '', durationSec: 100, repairedPrefixBytes: 0, peaks: { file: '', perSec: 1 } },
    speakers: [
      { id: 'S0', engineLabel: 'S0', name: 'Анна', colorKey: 'a' },
      { id: 'S1', engineLabel: 'S1', name: 'Клиент', colorKey: 'b' }
    ],
    turns,
    ...extra
  }
}

describe('stem / terms', () => {
  it('сводит падежные формы к общей основе', () => {
    expect(stem('матери')).toBe('матер')
    expect(stem('матерью')).toBe('матер')
    expect(stem('мамой')).toBe(stem('маме'))
    expect(stem('говорила')).toBe(stem('говорил'))
  })
  it('не режет короткие слова', () => {
    expect(stem('дом')).toBe('дом')
  })
  it('выбрасывает служебные слова', () => {
    expect(terms('Что клиент говорил о матери?')).toEqual(['матер'])
  })
})

describe('buildPassages', () => {
  it('режет запись на куски из целых реплик с перекрытием', () => {
    const p = project('a', [
      turn('S0', 0, 'раз два три четыре пять'),
      turn('S1', 10, 'шесть семь восемь девять десять'),
      turn('S0', 20, 'одиннадцать двенадцать тринадцать')
    ])
    const ps = buildPassages(p, { maxChars: 70 })
    expect(ps.length).toBeGreaterThan(1)
    expect(ps[0].text.startsWith('Анна: раз')).toBe(true)
    expect(ps[0].startSec).toBe(0)
    // Каждая реплика попала хотя бы в один кусок.
    for (const t of ['раз', 'шесть', 'тринадцать']) expect(ps.some((x) => x.text.includes(t))).toBe(true)
  })
  it('одна очень длинная реплика не зацикливает', () => {
    const long = Array.from({ length: 400 }, () => 'слово').join(' ')
    const ps = buildPassages(project('a', [turn('S0', 0, long), turn('S1', 50, 'ответ')]), { maxChars: 100 })
    expect(ps.length).toBe(2)
  })
  it('обезличивает по правилам записи', () => {
    const p = project('a', [turn('S1', 0, 'Мама Ева звонила')], {
      anon: [{ find: 'Ева', replace: '[Имя]', kind: 'name' }]
    })
    expect(buildPassages(p, { anon: true })[0].text).toBe('Клиент: Мама [Имя] звонила')
    expect(buildPassages(p, { anon: true })[0].plain).toBe('Клиент: Мама Ева звонила')
    expect(buildPassages(p, { anon: false })[0].text).toBe('Клиент: Мама Ева звонила')
  })
})

describe('rankPassages', () => {
  const a = project('a', [turn('S1', 0, 'Мы с мамой опять поругались из-за денег'), turn('S0', 60, 'Как прошла неделя на работе')])
  const b = project('b', [turn('S1', 5, 'Матерью я всегда была недовольна'), turn('S1', 90, 'Работа отнимает все силы')])
  const all = [...buildPassages(a, { maxChars: 50 }), ...buildPassages(b, { maxChars: 50 })]

  it('находит формы слова в разных записях', () => {
    const got = rankPassages(all, terms('мать мама матерью'))
    expect(got.map((p) => p.slug).sort()).toEqual(['a', 'b'])
    expect(got.every((p) => /мам|матер/i.test(p.text))).toBe(true)
  })
  it('ограничивает число кусков с одной записи', () => {
    const many = project('c', Array.from({ length: 10 }, (_, i) => turn('S1', i * 10, 'работа работа ' + i)))
    const got = rankPassages(buildPassages(many, { maxChars: 30 }), terms('работа'), { perDoc: 3 })
    expect(got.length).toBe(3)
  })
  it('пустой вопрос — пусто', () => {
    expect(rankPassages(all, [])).toEqual([])
  })
  it('держит бюджет символов', () => {
    const got = rankPassages(all, terms('мама работа матерью'), { budgetChars: 60 })
    expect(got.reduce((s, p) => s + p.text.length, 0)).toBeLessThanOrEqual(60)
  })
})

describe('formatPassages / timedTranscript', () => {
  it('нумерует куски и пишет время', () => {
    const p = project('a', [turn('S1', 75, 'привет')])
    expect(formatPassages(buildPassages(p))).toBe('### Запись «Сессия a» (01.10.2026)\n\n[1] 1:15\nКлиент: привет')
    expect(timedTranscript(p, false)).toBe('[1:15] Клиент: привет')
  })
  it('clock с часами', () => {
    expect(clock(3723)).toBe('1:02:03')
  })
})

describe('parseAnswer', () => {
  it('разбирает номера и время', () => {
    expect(parseAnswer('Мама [1], работа [2, 3] и [12:34].', 3)).toEqual([
      { text: 'Мама ' },
      { ref: 1 },
      { text: ', работа ' },
      { ref: 2 },
      { ref: 3 },
      { text: ' и ' },
      { sec: 754, label: '12:34' },
      { text: '.' }
    ])
  })
  it('несуществующий номер оставляет текстом', () => {
    expect(parseAnswer('см. [7]', 3)).toEqual([{ text: 'см. [7]' }])
  })
  it('citedRefs — только упомянутые', () => {
    expect(citedRefs('а [2] б [2][1]', 5)).toEqual([1, 2])
  })
  it('parseClock', () => {
    expect(parseClock('1:02:03')).toBe(3723)
    expect(parseClock('12:34')).toBe(754)
    expect(parseClock('12:74')).toBeNull()
    expect(parseClock('abc')).toBeNull()
  })
})

describe('parseKeywords / textHash', () => {
  it('JSON-массив внутри текста', () => {
    expect(parseKeywords('Вот: ["мама", "матерью", "мама"]')).toEqual(['мама', 'матерью'])
  })
  it('строки через запятую', () => {
    expect(parseKeywords('- мама, «отец»\n- родители')).toEqual(['мама', 'отец', 'родители'])
  })
  it('хэш меняется вместе с текстом', () => {
    expect(textHash('абв')).toBe(textHash('абв'))
    expect(textHash('абв')).not.toBe(textHash('абг'))
  })
})
