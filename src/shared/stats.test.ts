import { describe, it, expect } from 'vitest'
import { computeStats } from './stats'
import type { Turn, Word, SpeakerInfo } from './types'

const W = (id: number, t: string, s?: number, e?: number): Word => ({ id, t, s, e, p: 0.9 })

function turn(id: string, spk: string, words: Word[]): Turn {
  return { id, spk, startSec: words[0]?.s ?? 0, words }
}

const SPK: SpeakerInfo[] = [
  { id: 'S0', engineLabel: 'SPEAKER_00', name: 'Психолог', colorKey: 'a' },
  { id: 'S1', engineLabel: 'SPEAKER_01', name: 'Клиент', colorKey: 'b' }
]

describe('computeStats', () => {
  it('считает время речи, слова и реплики по каждому говорящему', () => {
    const turns = [
      turn('T0', 'S0', [W(0, 'Здравствуйте', 0, 1), W(1, 'как', 1, 3)]), // 3 c, 2 слова
      turn('T1', 'S1', [W(2, 'нормально', 3, 4)]), // 1 c, 1 слово
      turn('T2', 'S0', [W(3, 'хорошо', 4, 6)]) // 2 c, 1 слово
    ]
    const st = computeStats(turns, SPK, 10)
    expect(st.totalWords).toBe(4)
    expect(st.totalTurns).toBe(3)
    expect(st.totalTalkSec).toBe(6)
    // отсортировано по времени речи убыв.: S0 (5 c) впереди S1 (1 c)
    expect(st.speakers[0].spk).toBe('S0')
    expect(st.speakers[0].name).toBe('Психолог')
    expect(st.speakers[0].talkSec).toBe(5)
    expect(st.speakers[0].words).toBe(3)
    expect(st.speakers[0].turns).toBe(2)
    expect(st.speakers[0].talkPct).toBe(83) // 5/6 → 83 %
    expect(st.speakers[1].spk).toBe('S1')
    expect(st.speakers[1].talkSec).toBe(1)
    expect(st.speakers[1].talkPct).toBe(17)
  })

  it('вставленные слова (без таймкодов) считаются в словах, но не во времени речи', () => {
    const turns = [turn('T0', 'S0', [W(0, 'текст', 0, 2), { id: 1, t: 'вставка' }])]
    const st = computeStats(turns, SPK, 5)
    expect(st.speakers[0].words).toBe(2)
    expect(st.speakers[0].talkSec).toBe(2)
    expect(st.totalTalkSec).toBe(2)
  })

  it('пустая запись — нули, без NaN', () => {
    const st = computeStats([], [], 0)
    expect(st.totalWords).toBe(0)
    expect(st.totalTurns).toBe(0)
    expect(st.totalTalkSec).toBe(0)
    expect(st.speakers).toEqual([])
  })

  it('нет таймкодов вообще → проценты 0, не NaN', () => {
    const turns = [turn('T0', 'S0', [{ id: 0, t: 'а' }, { id: 1, t: 'б' }])]
    const st = computeStats(turns, SPK, 0)
    expect(st.totalTalkSec).toBe(0)
    expect(st.speakers[0].talkPct).toBe(0)
    expect(Number.isNaN(st.speakers[0].talkPct)).toBe(false)
  })

  it('неизвестный говорящий — имя берётся из id', () => {
    const turns = [turn('T0', 'S9', [W(0, 'x', 0, 1)])]
    const st = computeStats(turns, SPK, 2)
    expect(st.speakers[0].name).toBe('S9')
  })
})
