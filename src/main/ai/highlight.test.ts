import { describe, it, expect } from 'vitest'
import { applyHighlights, clearHighlights } from './highlight'
import type { Turn, Word } from '../../shared/types'

const W = (id: number, t: string): Word => ({ id, t, s: id, e: id + 1, p: 0.9 })
const turn = (words: Word[]): Turn => ({ id: 'T0', spk: 'S0', startSec: 0, words })

describe('applyHighlights', () => {
  it('marks the words of a matching phrase (case/punctuation-insensitive)', () => {
    const ts = applyHighlights(
      [turn([W(0, 'Я'), W(1, 'выбираю'), W(2, 'себя.'), W(3, 'Точка')])],
      ['я выбираю себя']
    )
    expect(ts[0].words.filter((w) => w.hl).map((w) => w.t)).toEqual(['Я', 'выбираю', 'себя.'])
    expect(ts[0].words.find((w) => w.t === 'Точка')!.hl).toBeUndefined()
  })

  it('clears previous highlights not in the new phrase set', () => {
    const prev = turn([{ ...W(0, 'старое'), hl: true }, W(1, 'новое')])
    const ts = applyHighlights([prev], ['новое'])
    expect(ts[0].words.find((w) => w.t === 'старое')!.hl).toBeUndefined()
    expect(ts[0].words.find((w) => w.t === 'новое')!.hl).toBe(true)
  })

  it('ignores a phrase that is not present', () => {
    const ts = applyHighlights([turn([W(0, 'привет'), W(1, 'мир')])], ['чего нет'])
    expect(ts[0].words.some((w) => w.hl)).toBe(false)
  })

  it('clearHighlights removes all hl flags', () => {
    const ts = clearHighlights([turn([{ ...W(0, 'а'), hl: true }, { ...W(1, 'б'), hl: true }])])
    expect(ts[0].words.some((w) => w.hl)).toBe(false)
  })
})
