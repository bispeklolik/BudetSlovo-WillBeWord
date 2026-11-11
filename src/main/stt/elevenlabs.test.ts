import { describe, it, expect } from 'vitest'
import { elevenToTurns, probFromLogprob } from '../../shared/sttMappers'

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

  it('уверенность слова = exp(logprob); нет logprob — 1', () => {
    const { turns } = elevenToTurns({
      words: [
        { text: 'колит', start: 0, end: 0.4, type: 'word', logprob: Math.log(0.4) },
        { text: 'тут', start: 0.5, end: 0.8, type: 'word', logprob: 0 },
        { text: 'там', start: 0.9, end: 1.2, type: 'word' }
      ]
    })
    const p = turns[0].words.map((w) => w.p)
    expect(p[0]).toBeCloseTo(0.4, 5)
    expect(p[1]).toBe(1)
    expect(p[2]).toBe(1)
  })

  it('probFromLogprob: границы и нечисла', () => {
    expect(probFromLogprob(-0.1)).toBeCloseTo(0.905, 3)
    expect(probFromLogprob(-50)).toBeGreaterThanOrEqual(0)
    expect(probFromLogprob(0.5)).toBe(1) // не больше 1
    expect(probFromLogprob(NaN)).toBe(1)
    expect(probFromLogprob(undefined)).toBe(1)
  })
})
