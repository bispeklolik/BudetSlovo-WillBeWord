import { describe, it, expect } from 'vitest'
import { openaiToTurns } from './openaiCompat'

describe('openaiToTurns', () => {
  it('один говорящий, реплики бьются по сегментам Whisper', () => {
    const data = {
      text: 'Привет как дела хорошо',
      segments: [
        { start: 0, end: 1.2, text: 'Привет как дела' },
        { start: 1.2, end: 2, text: 'хорошо' }
      ],
      words: [
        { word: 'Привет', start: 0, end: 0.4 },
        { word: 'как', start: 0.4, end: 0.7 },
        { word: 'дела', start: 0.7, end: 1.1 },
        { word: 'хорошо', start: 1.3, end: 1.9 }
      ]
    }
    const { speakers, turns } = openaiToTurns(data)
    expect(speakers).toHaveLength(1)
    expect(speakers[0].name).toBe('Говорящий')
    expect(turns).toHaveLength(2)
    expect(turns[0].words.map((w) => w.t)).toEqual(['Привет', 'как', 'дела'])
    expect(turns[1].words.map((w) => w.t)).toEqual(['хорошо'])
    expect(turns[0].words.map((w) => w.id)).toEqual([0, 1, 2]) // сквозная нумерация
    expect(turns[1].words[0].id).toBe(3)
  })

  it('нет сегментов → одна реплика', () => {
    const data = {
      words: [
        { word: 'а', start: 0, end: 0.2 },
        { word: 'б', start: 0.3, end: 0.5 }
      ]
    }
    const { turns } = openaiToTurns(data)
    expect(turns).toHaveLength(1)
    expect(turns[0].words.map((w) => w.t)).toEqual(['а', 'б'])
  })

  it('пусто → пусто', () => {
    expect(openaiToTurns({}).turns).toEqual([])
  })
})
