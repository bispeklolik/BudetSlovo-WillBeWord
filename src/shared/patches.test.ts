import { describe, it, expect } from 'vitest'
import { replaceCI, applyPatch } from './patches'
import type { ProjectMeta, Word } from './types'

const W = (id: number, t: string): Word => ({ id, t, s: id, e: id + 0.5, p: 0.9 })

function meta(words: Word[]): ProjectMeta {
  return { turns: [{ id: 'T0', spk: 'S0', startSec: 0, words }] } as unknown as ProjectMeta
}

describe('replaceCI', () => {
  it('заменяет все вхождения без учёта регистра', () => {
    expect(replaceCI('Ева', 'ева', 'Эва')).toBe('Эва')
    expect(replaceCI('ЕВА', 'ева', 'Эва')).toBe('Эва')
    expect(replaceCI('Семён,', 'семён', 'Семен')).toBe('Семен,')
  })
  it('без совпадений — текст не меняется', () => {
    expect(replaceCI('привет', 'мир', 'X')).toBe('привет')
  })
  it('пустой поиск — no-op', () => {
    expect(replaceCI('abc', '', 'X')).toBe('abc')
  })
})

describe('applyPatch setTurnWords', () => {
  it('заменяет все слова реплики новыми (надиктовка), не трогая spk/startSec', () => {
    const m = meta([W(0, 'старый'), W(1, 'текст')])
    applyPatch(m, {
      op: 'setTurnWords',
      turnId: 'T0',
      words: [
        { id: 10, t: 'новый', src: 'ai' },
        { id: 11, t: 'текст', src: 'ai' }
      ]
    })
    const t = m.turns![0]
    expect(t.words.map((w) => w.t)).toEqual(['новый', 'текст'])
    expect(t.words[0].s).toBeUndefined() // надиктованные слова без таймкодов
    expect(t.spk).toBe('S0')
    expect(t.startSec).toBe(0)
  })
  it('несуществующая реплика — no-op', () => {
    const m = meta([W(0, 'а')])
    applyPatch(m, { op: 'setTurnWords', turnId: 'T9', words: [{ id: 5, t: 'б' }] })
    expect(m.turns![0].words[0].t).toBe('а')
  })
})

describe('applyPatch replaceAll', () => {
  it('меняет в нескольких словах и запоминает оригинал в t0', () => {
    const m = meta([W(0, 'Ева'), W(1, 'и'), W(2, 'ева?')])
    applyPatch(m, { op: 'replaceAll', find: 'ева', replace: 'Эва' })
    const ws = m.turns![0].words
    expect(ws[0].t).toBe('Эва')
    expect(ws[0].t0).toBe('Ева')
    expect(ws[2].t).toBe('Эва?')
    expect(ws[2].t0).toBe('ева?')
    expect(ws[1].t).toBe('и')
    expect(ws[1].t0).toBeUndefined()
  })
  it('не перезатирает уже существующий t0 (движковый оригинал)', () => {
    const m = meta([{ id: 0, t: 'Эвай', t0: 'Евай', s: 0, e: 1, p: 0.9 }])
    applyPatch(m, { op: 'replaceAll', find: 'эвай', replace: 'Эва' })
    expect(m.turns![0].words[0].t).toBe('Эва')
    expect(m.turns![0].words[0].t0).toBe('Евай')
  })
})
