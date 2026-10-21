import { describe, it, expect } from 'vitest'
import { parseDiarizeDump, assignWordSpeakers, type DiarTurn } from './diarize'

describe('parseDiarizeDump', () => {
  it('читает формат движка, сортирует по времени', () => {
    const txt = [
      '[ 00:00:03.000 -->  00:00:03.372] B SPEAKER_04',
      '[ 00:00:00.908 -->  00:00:06.055] A SPEAKER_03',
      '[ 01:00:00.000 -->  01:00:01.500] C SPEAKER_00',
      'мусор',
      ''
    ].join('\n')
    expect(parseDiarizeDump(txt)).toEqual([
      { start: 0.908, end: 6.055, label: 'SPEAKER_03' },
      { start: 3, end: 3.372, label: 'SPEAKER_04' },
      { start: 3600, end: 3601.5, label: 'SPEAKER_00' }
    ])
  })
})

const A = 'SPEAKER_00'
const B = 'SPEAKER_01'
const w = (s: number, e: number): { s: number; e: number } => ({ s, e })

describe('assignWordSpeakers', () => {
  it('каждое слово — тому, чей голос звучит; смена говорящего посреди предложения', () => {
    const turns: DiarTurn[] = [
      { start: 0, end: 2, label: A },
      { start: 2, end: 4, label: B }
    ]
    expect(assignWordSpeakers([w(0.1, 0.5), w(0.6, 1.9), w(2.1, 2.5), w(2.6, 3.9)], turns)).toEqual([A, A, B, B])
  })
  it('короткая вставка «угу» поверх чужой речи остаётся отдельной', () => {
    const turns: DiarTurn[] = [
      { start: 0, end: 6, label: A },
      { start: 3, end: 3.4, label: B }
    ]
    // Слово 3.0–3.4 звучит голосом B всю длину (и голосом A тоже) — равенство → по соседу A.
    // Но если A в этот момент молчал (разметка A прерывается), слово — B.
    const turns2: DiarTurn[] = [
      { start: 0, end: 2.9, label: A },
      { start: 3, end: 3.4, label: B },
      { start: 3.5, end: 6, label: A }
    ]
    expect(assignWordSpeakers([w(1, 2), w(3.02, 3.38), w(4, 5)], turns2)).toEqual([A, B, A])
    expect(assignWordSpeakers([w(1, 2), w(3.02, 3.38), w(4, 5)], turns)).toEqual([A, A, A])
  })
  it('слово, лишь задевшее чужой отрезок на границе, не скачет к другому', () => {
    const turns: DiarTurn[] = [
      { start: 0, end: 2.0, label: A },
      { start: 2.0, end: 2.3, label: B },
      { start: 2.3, end: 5, label: A }
    ]
    // Слово 1.9–2.6: A звучит 0.1+0.3=0.4, B 0.3 → A. Проверка сглаживания: B меньше половины.
    expect(assignWordSpeakers([w(1, 1.8), w(1.9, 2.6), w(3, 4)], turns)).toEqual([A, A, A])
  })
  it('слово в паузе разметки — ближайшему, далеко — как у соседа', () => {
    const turns: DiarTurn[] = [
      { start: 0, end: 1, label: A },
      { start: 5, end: 6, label: B }
    ]
    expect(assignWordSpeakers([w(0.2, 0.8), w(1.2, 1.5), w(3, 3.3), w(5.1, 5.5)], turns)).toEqual([A, A, A, B])
  })
  it('без разметки — запасная метка', () => {
    expect(assignWordSpeakers([w(0, 1)], [])).toEqual(['SPEAKER_00'])
  })
})
