import { describe, it, expect } from 'vitest'
import {
  wordsFromTurns,
  parseWhisperJsonWords,
  dropEcho,
  mergeChannels,
  offsetTurns,
  applySpeakerNames,
  type ChannelWord
} from './channels'
import type { SpeakerInfo, Turn, Word } from './types'

const C = (t: string, s: number, e = s + 0.3, p = 0.9): ChannelWord => ({ s, e, t, p })

describe('wordsFromTurns', () => {
  it('берёт только слова со временем и непустым текстом, сортирует по s', () => {
    const w = (id: number, t: string, s?: number, e?: number): Word => ({ id, t, s, e, p: 0.8 })
    const turns: Turn[] = [
      { id: 'T0', spk: 'S0', startSec: 5, words: [w(0, 'мир', 5, 6), w(1, '  ', 6, 7), w(2, 'вставка')] },
      { id: 'T1', spk: 'S1', startSec: 1, words: [w(3, 'привет', 1, 2)] }
    ]
    expect(wordsFromTurns(turns)).toEqual([
      { s: 1, e: 2, t: 'привет', p: 0.8 },
      { s: 5, e: 6, t: 'мир', p: 0.8 }
    ])
  })
})

describe('parseWhisperJsonWords', () => {
  it('читает слова с таймингами и обрезает пробелы', () => {
    const json = {
      segments: [
        {
          start: 0,
          end: 2,
          text: ' Привет мир',
          words: [
            { start: 0, end: 0.5, word: ' Привет', probability: 0.97 },
            { start: 0.6, end: 1, word: 'мир ', probability: 0.5 }
          ]
        }
      ]
    }
    expect(parseWhisperJsonWords(json)).toEqual([
      { s: 0, e: 0.5, t: 'Привет', p: 0.97 },
      { s: 0.6, e: 1, t: 'мир', p: 0.5 }
    ])
  })

  it('без слов в сегменте делит текст поровну по времени', () => {
    const json = { segments: [{ start: 10, end: 14, text: ' один  два три четыре ' }] }
    const r = parseWhisperJsonWords(json)
    expect(r.map((w) => w.t)).toEqual(['один', 'два', 'три', 'четыре'])
    expect(r[0].s).toBeCloseTo(10)
    expect(r[0].e).toBeCloseTo(11)
    expect(r[3].s).toBeCloseTo(13)
    expect(r[3].e).toBeCloseTo(14)
  })

  it('пустой массив words тоже уходит в запасной разбор текста', () => {
    const r = parseWhisperJsonWords({ segments: [{ start: 0, end: 2, text: 'а б', words: [] }] })
    expect(r.map((w) => w.t)).toEqual(['а', 'б'])
  })

  it('безопасно игнорирует мусор', () => {
    expect(parseWhisperJsonWords(null)).toEqual([])
    expect(parseWhisperJsonWords('x')).toEqual([])
    expect(parseWhisperJsonWords({})).toEqual([])
    expect(parseWhisperJsonWords({ segments: 5 })).toEqual([])
    const json = {
      segments: [
        null,
        { start: 'a', end: 1, text: 'плохо' },
        { start: 0, end: 1, text: 5 },
        {
          start: 0,
          end: 3,
          text: 'x',
          words: [null, { start: 0, end: 1 }, { start: 1, end: 2, word: '  ' }, { start: 2, end: 3, word: 'ок' }]
        }
      ]
    }
    expect(parseWhisperJsonWords(json)).toEqual([{ s: 2, e: 3, t: 'ок' }])
  })

  it('сортирует результат по s', () => {
    const json = {
      segments: [
        { start: 5, end: 6, text: 'поздно' },
        { start: 1, end: 2, text: 'рано' }
      ]
    }
    expect(parseWhisperJsonWords(json).map((w) => w.t)).toEqual(['рано', 'поздно'])
  })
})

describe('dropEcho', () => {
  it('убирает серию слов микрофона, повторяющую системный звук в пределах 0.7 с', () => {
    const mic = [C('Привет', 10), C('как', 10.4), C('сам', 11.5)]
    const sys = [C('привет', 10.5), C('как', 10.9)]
    expect(dropEcho(mic, sys).map((w) => w.t)).toEqual(['сам'])
  })

  it('одиночное совпадение («да» у обеих сторон) — настоящая реплика, не эхо', () => {
    const mic = [C('Да', 10), C('конечно', 10.4)]
    const sys = [C('да', 10.2), C('хорошо', 10.6)]
    expect(dropEcho(mic, sys).map((w) => w.t)).toEqual(['Да', 'конечно'])
  })

  it('нормализует ё, регистр, пунктуацию и кавычки', () => {
    const mic = [C('Всё,', 1), C('«Ёлка»', 1.5)]
    const sys = [C('все', 1.1), C('елка.', 1.7)]
    expect(dropEcho(mic, sys)).toEqual([])
  })

  it('учитывает окно по времени (граница 0.7 включительно)', () => {
    const sys = [C('слово', 10), C('второе', 11)]
    const pair = (t: number): ChannelWord[] => [C('слово', t), C('второе', 11)]
    expect(dropEcho(pair(10.7), sys)).toEqual([])
    expect(dropEcho(pair(9.3), sys)).toEqual([])
    expect(dropEcho(pair(10.8), sys).map((w) => w.t)).toEqual(['слово', 'второе'])
    expect(dropEcho(pair(9.2), sys).map((w) => w.t)).toEqual(['слово', 'второе'])
  })

  it('оставляет другие слова и короткие (меньше 2 символов)', () => {
    const mic = [C('я', 5), C('да', 5), C('и.', 6)]
    const sys = [C('я', 5), C('нет', 5), C('и', 6)]
    expect(dropEcho(mic, sys).map((w) => w.t)).toEqual(['я', 'да', 'и.'])
  })

  it('не меняет входные массивы и хранит порядок', () => {
    const mic = [C('раз', 1), C('эхо', 2), C('эха', 2.3), C('два', 3)]
    const sys = [C('эхо', 2), C('эха', 2.3)]
    const r = dropEcho(mic, sys)
    expect(r.map((w) => w.t)).toEqual(['раз', 'два'])
    expect(mic).toHaveLength(4)
  })

  it('быстро работает на 30 000 словах', () => {
    const mic: ChannelWord[] = []
    const sys: ChannelWord[] = []
    for (let i = 0; i < 30000; i++) {
      mic.push(C('слово', i * 0.5))
      sys.push(C('слово', i * 0.5 + 100000))
    }
    const t0 = Date.now()
    expect(dropEcho(mic, sys)).toHaveLength(30000)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})

describe('mergeChannels', () => {
  const NAMES: [string, string] = ['Я', 'Собеседник']

  it('чередует реплики по времени и создаёт обоих говорящих', () => {
    const mic = [C('привет', 0), C('мир', 0.5), C('пока', 10)]
    const sys = [C('здравствуй', 2), C('друг', 2.5)]
    const { speakers, turns } = mergeChannels(mic, sys, NAMES)
    expect(speakers).toEqual([
      { id: 'S0', engineLabel: 'mic', name: 'Я', colorKey: 'spk1' },
      { id: 'S1', engineLabel: 'sys', name: 'Собеседник', colorKey: 'spk2' }
    ])
    expect(turns.map((t) => t.spk)).toEqual(['S0', 'S1', 'S0'])
    expect(turns.map((t) => t.id)).toEqual(['T0', 'T1', 'T2'])
    expect(turns.map((t) => t.startSec)).toEqual([0, 2, 10])
    expect(turns[0].words.map((w) => w.t)).toEqual(['привет', 'мир'])
  })

  it('при равном s микрофон идёт первым', () => {
    const { turns } = mergeChannels([C('раз', 1)], [C('два', 1)], NAMES)
    expect(turns.map((t) => t.spk)).toEqual(['S0', 'S1'])
  })

  it('делит реплику одного канала после паузы 8 с и больше', () => {
    const a = mergeChannels([C('раз', 0, 1), C('два', 8.9, 9)], [], NAMES)
    expect(a.turns).toHaveLength(1) // пауза 7.9 с
    const b = mergeChannels([C('раз', 0, 1), C('два', 9, 9.5)], [], NAMES)
    expect(b.turns).toHaveLength(2) // пауза ровно 8 с
    expect(b.turns[1].startSec).toBe(9)
  })

  it('пустой канал: реплики только другого, но оба говорящих в списке', () => {
    const { speakers, turns } = mergeChannels([], [C('алло', 1)], NAMES)
    expect(speakers).toHaveLength(2)
    expect(turns).toHaveLength(1)
    expect(turns[0].spk).toBe('S1')
    expect(mergeChannels([], [], NAMES).turns).toEqual([])
  })

  it('id слов идут подряд с 0 по всему результату, поля s/e/p/t сохраняются', () => {
    const { turns } = mergeChannels([C('раз', 0), C('два', 5)], [C('три', 1, 1.4, 0.7)], NAMES)
    const all = turns.flatMap((t) => t.words)
    expect(all.map((w) => w.id)).toEqual([0, 1, 2])
    expect(all[1]).toEqual({ id: 1, s: 1, e: 1.4, p: 0.7, t: 'три' })
  })
})

describe('offsetTurns', () => {
  it('сдвигает startSec и s/e, не трогает слова без времени и исходник', () => {
    const turns: Turn[] = [
      { id: 'T0', spk: 'S0', startSec: 1, words: [{ id: 0, t: 'a', s: 1, e: 2, p: 0.5 }, { id: 1, t: 'b' }] }
    ]
    const r = offsetTurns(turns, 60)
    expect(r[0].startSec).toBe(61)
    expect(r[0].words[0]).toEqual({ id: 0, t: 'a', s: 61, e: 62, p: 0.5 })
    expect(r[0].words[1]).toEqual({ id: 1, t: 'b' })
    expect(turns[0].startSec).toBe(1)
    expect(turns[0].words[0].s).toBe(1)
  })
})

describe('applySpeakerNames', () => {
  const SPK: SpeakerInfo[] = [
    { id: 'S0', engineLabel: 'a', name: 'Говорящий 1', colorKey: 'spk1' },
    { id: 'S1', engineLabel: 'b', name: 'Говорящий 2', colorKey: 'spk2' },
    { id: 'S2', engineLabel: 'c', name: 'Тихий', colorKey: 'spk1' }
  ]
  const turn = (id: string, spk: string): Turn => ({ id, spk, startSec: 0, words: [] })

  it('имена по порядку первого появления в репликах', () => {
    const turns = [turn('T0', 'S1'), turn('T1', 'S0'), turn('T2', 'S1')]
    const r = applySpeakerNames(SPK, turns, ['Анна', 'Борис'])
    expect(r.map((s) => s.name)).toEqual(['Борис', 'Анна', 'Тихий'])
    expect(SPK[0].name).toBe('Говорящий 1')
  })

  it('пустые и отсутствующие имена оставляют прежнее', () => {
    const turns = [turn('T0', 'S0'), turn('T1', 'S1')]
    const r = applySpeakerNames(SPK, turns, ['  ', 'Борис'])
    expect(r.map((s) => s.name)).toEqual(['Говорящий 1', 'Борис', 'Тихий'])
    expect(applySpeakerNames(SPK, turns, ['Анна'])[1].name).toBe('Говорящий 2')
  })
})
