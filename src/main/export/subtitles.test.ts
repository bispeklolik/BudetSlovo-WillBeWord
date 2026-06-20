import { describe, it, expect } from 'vitest'
import { toSubtitles } from './subtitles'
import type { Turn, Word } from '../../shared/types'

const W = (id: number, t: string, s: number, e: number): Word => ({ id, t, s, e, p: 0.9 })
const turns: Turn[] = [
  { id: 'T0', spk: 'S0', startSec: 0, words: [W(0, 'Привет,', 0, 0.5), W(1, 'мир.', 0.5, 1.0)] },
  { id: 'T1', spk: 'S1', startSec: 2, words: [W(2, 'Как', 2, 2.3), W(3, 'дела?', 2.3, 2.8)] }
]

describe('toSubtitles', () => {
  it('SRT: numbered cues with comma-millisecond timestamps', () => {
    const srt = toSubtitles(turns, 'srt')
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:01,000\nПривет, мир.')
    expect(srt).toContain('2\n00:00:02,000 --> 00:00:02,800\nКак дела?')
  })

  it('VTT: WEBVTT header and dot-millisecond timestamps', () => {
    const vtt = toSubtitles(turns, 'vtt')
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.000\nПривет, мир.')
  })

  it('splits a long turn into multiple cues', () => {
    const long: Turn[] = [
      {
        id: 'T0',
        spk: 'S0',
        startSec: 0,
        words: Array.from({ length: 20 }, (_, i) => W(i, 'слово', i, i + 0.9))
      }
    ]
    const cues = toSubtitles(long, 'srt').split('\n\n').filter(Boolean)
    expect(cues.length).toBeGreaterThan(1)
  })
})
