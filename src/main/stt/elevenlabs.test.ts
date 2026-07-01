import { describe, it, expect } from 'vitest'
import { elevenToTurns } from './elevenlabs'

describe('elevenToTurns', () => {
  it('берёт только type=word, группирует по speaker_id', () => {
    const data = {
      words: [
        { text: 'Привет', start: 0.1, end: 0.5, type: 'word', speaker_id: 'speaker_0' },
        { text: ' ', start: 0.5, end: 0.55, type: 'spacing', speaker_id: 'speaker_0' },
        { text: 'как', start: 0.55, end: 0.8, type: 'word', speaker_id: 'speaker_0' },
        { text: 'дела', start: 1.9, end: 2.3, type: 'word', speaker_id: 'speaker_1' }
      ]
    }
    const { speakers, turns } = elevenToTurns(data)
    expect(turns).toHaveLength(2)
    expect(turns[0].words.map((w) => w.t)).toEqual(['Привет', 'как']) // пробел отброшен
    expect(turns[1].spk).toBe('S1')
    expect(speakers[0].name).toBe('Психолог')
    expect(speakers[1].name).toBe('Клиент')
  })

  it('пусто → пусто', () => {
    expect(elevenToTurns({}).turns).toEqual([])
  })
})
