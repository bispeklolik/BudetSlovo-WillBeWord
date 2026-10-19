import { describe, it, expect } from 'vitest'
import { computePauses, fmtPause, pauseMarker } from './pauses'
import type { Turn, Word } from './types'

const W = (id: number, t: string, s?: number, e?: number): Word => ({ id, t, s, e, p: 0.9 })

function turn(id: string, spk: string, words: Word[]): Turn {
  return { id, spk, startSec: words[0]?.s ?? 0, words }
}

describe('computePauses', () => {
  it('находит паузу внутри реплики: ключ — слово после паузы', () => {
    const turns = [turn('T0', 'S0', [W(0, 'а', 0, 1), W(1, 'б', 5, 6), W(2, 'в', 6, 7)])]
    const m = computePauses(turns, 3)
    expect([...m.entries()]).toEqual([[1, 4]])
  })

  it('находит паузу между репликами: маркер на первом слове следующей', () => {
    const turns = [
      turn('T0', 'S0', [W(0, 'а', 0, 1)]),
      turn('T1', 'S1', [W(1, 'б', 11, 12), W(2, 'в', 12, 13)])
    ]
    const m = computePauses(turns, 5)
    expect([...m.entries()]).toEqual([[1, 10]])
  })

  it('слово без таймкодов в середине паузы не сбрасывает предыдущее', () => {
    const turns = [turn('T0', 'S0', [W(0, 'а', 0, 1), { id: 1, t: 'вставка' }, W(2, 'б', 9, 10)])]
    const m = computePauses(turns, 3)
    expect([...m.entries()]).toEqual([[2, 8]])
  })

  it('точно minSec — уже пауза; чуть меньше — нет', () => {
    const turns = [turn('T0', 'S0', [W(0, 'а', 0, 1), W(1, 'б', 4, 5), W(2, 'в', 7.9, 8)])]
    const m = computePauses(turns, 3)
    expect(m.has(1)).toBe(true)
    expect(m.has(2)).toBe(false) // 2.9 < 3
  })

  it('до первого слова файла маркера нет', () => {
    const turns = [turn('T0', 'S0', [{ id: 0, t: 'вставка' }, W(1, 'а', 30, 31)])]
    expect(computePauses(turns, 3).size).toBe(0)
  })

  it('minSec <= 0 или NaN — пустая карта', () => {
    const turns = [turn('T0', 'S0', [W(0, 'а', 0, 1), W(1, 'б', 9, 10)])]
    expect(computePauses(turns, 0).size).toBe(0)
    expect(computePauses(turns, -1).size).toBe(0)
    expect(computePauses(turns, NaN).size).toBe(0)
  })

  it('округляет до 0.1 с', () => {
    const turns = [turn('T0', 'S0', [W(0, 'а', 0, 1), W(1, 'б', 5.26, 6)])]
    expect(computePauses(turns, 3).get(1)).toBe(4.3)
  })

  it('слово с пустым текстом сохраняет тайминг', () => {
    const turns = [turn('T0', 'S0', [W(0, 'а', 0, 1), W(1, '', 1, 8), W(2, 'б', 9, 10)])]
    expect(computePauses(turns, 3).size).toBe(0) // пауза 1 с после пустого слова
  })

  it('пустые реплики пропускаются', () => {
    const turns = [turn('T0', 'S0', [W(0, 'а', 0, 1)]), turn('T1', 'S1', []), turn('T2', 'S0', [W(1, 'б', 6, 7)])]
    expect([...computePauses(turns, 3).entries()]).toEqual([[1, 5]])
  })
})

describe('fmtPause / pauseMarker', () => {
  it('секунды округляются до целых, минимум 1', () => {
    expect(fmtPause(4)).toBe('пауза 4 с')
    expect(fmtPause(3.6)).toBe('пауза 4 с')
    expect(fmtPause(0.2)).toBe('пауза 1 с')
  })

  it('минуты и секунды', () => {
    expect(fmtPause(65)).toBe('пауза 1 мин 5 с')
    expect(fmtPause(120)).toBe('пауза 2 мин')
    expect(fmtPause(60)).toBe('пауза 1 мин')
  })

  it('маркер в скобках', () => {
    expect(pauseMarker(4)).toBe('(пауза 4 с)')
  })
})
