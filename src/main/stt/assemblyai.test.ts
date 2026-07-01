import { describe, it, expect } from 'vitest'
import { assemblyToTurns } from './assemblyai'

describe('assemblyToTurns', () => {
  it('группирует по говорящему, мс → сек, имена Психолог/Клиент', () => {
    const t = {
      status: 'completed',
      words: [
        { text: 'Здравствуйте', start: 240, end: 780, confidence: 0.98, speaker: 'A' },
        { text: 'как', start: 1000, end: 1200, confidence: 0.9, speaker: 'A' },
        { text: 'нормально', start: 1500, end: 2000, confidence: 0.95, speaker: 'B' }
      ]
    }
    const { speakers, turns } = assemblyToTurns(t)
    expect(turns).toHaveLength(2)
    expect(turns[0].spk).toBe('S0')
    expect(turns[0].startSec).toBeCloseTo(0.24)
    expect(turns[0].words[0].s).toBeCloseTo(0.24)
    expect(turns[0].words[0].e).toBeCloseTo(0.78)
    expect(turns[1].spk).toBe('S1')
    expect(speakers[0]).toMatchObject({ id: 'S0', name: 'Психолог' })
    expect(speakers[1]).toMatchObject({ id: 'S1', name: 'Клиент' })
  })

  it('без слов → пусто', () => {
    expect(assemblyToTurns({ status: 'completed' }).turns).toEqual([])
  })
})
