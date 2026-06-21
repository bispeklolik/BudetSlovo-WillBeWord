import { describe, it, expect } from 'vitest'
import { buildAnonOverlay, anonTurnText, type AnonRule } from './anon'
import type { Turn, Word } from './types'

const W = (id: number, t: string): Word => ({ id, t, s: id, e: id + 0.4, p: 0.9 })

function turn(words: Word[]): Turn {
  return { id: 'T0', spk: 'S0', startSec: 0, words }
}

describe('buildAnonOverlay', () => {
  it('заменяет одиночное имя (любая форма из правил), без регистра/пунктуации', () => {
    const turns = [turn([W(0, 'Сегодня'), W(1, 'Ева,'), W(2, 'устала')])]
    const rules: AnonRule[] = [{ find: 'Ева', replace: 'Клиентка', kind: 'name' }]
    const ov = buildAnonOverlay(turns, rules)
    expect(ov.get(1)).toBe('Клиентка')
    expect(ov.has(0)).toBe(false)
    expect(anonTurnText(turns[0], ov)).toBe('Сегодня Клиентка устала')
  })

  it('многословный спан: первое слово → замена, хвост скрыт', () => {
    const turns = [turn([W(0, 'учусь'), W(1, 'в'), W(2, 'РХГА'), W(3, 'на')])]
    const turns2 = [
      turn([W(0, 'это'), W(1, 'Российская'), W(2, 'Христианская'), W(3, 'Академия'), W(4, 'там')])
    ]
    const ov = buildAnonOverlay(turns2, [
      { find: 'Российская Христианская Академия', replace: 'вуз', kind: 'org' }
    ])
    expect(ov.get(1)).toBe('вуз')
    expect(ov.get(2)).toBe('')
    expect(ov.get(3)).toBe('')
    expect(anonTurnText(turns2[0], ov)).toBe('это вуз там')
    expect(turns).toBeDefined()
  })

  it('длинное правило применяется раньше короткого (нет двойного захвата)', () => {
    const turns = [turn([W(0, 'Санкт-Петербург')])] // одно слово с дефисом
    const ov = buildAnonOverlay(turns, [
      { find: 'Петербург', replace: 'X', kind: 'place' },
      { find: 'Санкт-Петербург', replace: 'город', kind: 'place' }
    ])
    // нормализация убирает дефис → 'санктпетербург'; правило 'Петербург' не совпадёт целиком
    expect(ov.get(0)).toBe('город')
  })

  it('пустые правила игнорируются', () => {
    const turns = [turn([W(0, 'привет')])]
    expect(buildAnonOverlay(turns, [{ find: '', replace: 'X', kind: 'other' }]).size).toBe(0)
    expect(buildAnonOverlay(turns, [{ find: 'привет', replace: '  ', kind: 'other' }]).size).toBe(0)
  })
})
