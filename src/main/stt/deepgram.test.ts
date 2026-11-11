import { describe, it, expect } from 'vitest'
import { deepgramToTurns, type DgWord, type DgResponse } from '../../shared/sttMappers'

const resp = (words: DgWord[]): DgResponse => ({
  results: { channels: [{ alternatives: [{ words }] }] }
})

describe('deepgramToTurns', () => {
  it('группирует подряд идущих говорящих в реплики, имена Психолог/Клиент', () => {
    const dg = resp([
      { word: 'привет', punctuated_word: 'Привет,', start: 0, end: 0.5, confidence: 0.9, speaker: 0 },
      { word: 'как', punctuated_word: 'как', start: 0.5, end: 1, confidence: 0.8, speaker: 0 },
      { word: 'нормально', punctuated_word: 'Нормально.', start: 1, end: 2, confidence: 0.95, speaker: 1 }
    ])
    const { speakers, turns } = deepgramToTurns(dg)
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ id: 'T0', spk: 'S0', startSec: 0 })
    expect(turns[0].words.map((w) => w.t)).toEqual(['Привет,', 'как']) // берёт punctuated_word
    expect(turns[0].words.map((w) => w.id)).toEqual([0, 1])
    expect(turns[1]).toMatchObject({ id: 'T1', spk: 'S1', startSec: 1 })
    expect(turns[1].words[0].p).toBe(0.95) // confidence → p
    expect(speakers).toEqual([
      { id: 'S0', engineLabel: 'DG0', name: 'Психолог', colorKey: 'spk1' },
      { id: 'S1', engineLabel: 'DG1', name: 'Клиент', colorKey: 'spk2' }
    ])
  })

  it('пустые слова отбрасываются, без speaker → говорящий 0', () => {
    const dg = resp([
      { word: '', start: 0, end: 0.1, confidence: 1 },
      { word: 'да', start: 0.1, end: 0.4, confidence: 0.7 }
    ])
    const { turns } = deepgramToTurns(dg)
    expect(turns).toHaveLength(1)
    expect(turns[0].spk).toBe('S0')
    expect(turns[0].words.map((w) => w.t)).toEqual(['да'])
  })

  it('пустой ответ → пусто, без падения', () => {
    expect(deepgramToTurns({}).turns).toEqual([])
    expect(deepgramToTurns({}).speakers).toEqual([])
  })
})

describe('параметры запроса Deepgram (Nova-3, 11.11.2026)', () => {
  it('Nova-3, русский, новая диаризация; словарь — через keyterm, а не keywords', async () => {
    const { deepgramParams } = await import('./deepgram')
    const p = deepgramParams({ terms: ['психотерапия', 'тревожность'] })
    expect(p.get('model')).toBe('nova-3')
    expect(p.get('language')).toBe('ru')
    expect(p.get('diarize_model')).toBe('v2')
    expect(p.has('diarize')).toBe(false) // оба параметра сразу Deepgram отклоняет
    expect(p.getAll('keyterm')).toEqual(['психотерапия', 'тревожность'])
    expect(p.has('keywords')).toBe(false) // с Nova-3 не работает
    expect(deepgramParams({ terms: ['психотерапия'] }, false).has('keyterm')).toBe(false)
  })
  it('словарь укладывается в пределы Deepgram: не больше 50 терминов и ~600 знаков', async () => {
    const { keyterms } = await import('./deepgram')
    const many = Array.from({ length: 120 }, (_, i) => 'термин' + i)
    expect(keyterms(many).length).toBeLessThanOrEqual(50)
    const long = Array.from({ length: 40 }, (_, i) => 'оченьдлинныйтерминдляпроверки' + i)
    expect(keyterms(long).join('').length).toBeLessThanOrEqual(600)
    expect(keyterms(undefined)).toEqual([])
  })
})
