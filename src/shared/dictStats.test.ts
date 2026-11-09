import { describe, it, expect } from 'vitest'
import { parseHistory, computeStats, pageEntries, isDictation } from './dictStats'
import type { DictationEntry } from './types'

const e = (at: string, text: string, extra: Partial<DictationEntry> = {}): DictationEntry => ({
  at: new Date(at).toISOString(),
  raw: text,
  polished: null,
  text,
  ...extra
})

describe('parseHistory', () => {
  it('пропускает битые и пустые строки', () => {
    const src = [
      JSON.stringify(e('2026-11-09T10:00:00', 'раз два')),
      '{битая строка',
      '',
      JSON.stringify({ at: '2026-11-09T11:00:00', raw: '', polished: null }),
      JSON.stringify({ at: '2026-11-09T12:00:00', raw: '', polished: null, error: 'Микрофон молчал' })
    ].join('\n')
    const r = parseHistory(src)
    expect(r).toHaveLength(2)
    expect(r[1].error).toBe('Микрофон молчал')
  })
  it('пустой журнал', () => {
    expect(parseHistory('')).toEqual([])
  })
})

describe('computeStats', () => {
  const now = new Date('2026-11-09T12:00:00')
  it('пустой журнал', () => {
    expect(computeStats([], now)).toEqual({ wordsWeek: 0, streak: 0, total: 0, wpm: null })
  })
  it('слова за 7 дней: старые не считаются', () => {
    const s = computeStats([e('2026-10-20T10:00:00', 'очень давно сказал'), e('2026-11-08T10:00:00', 'один два три')], now)
    expect(s.wordsWeek).toBe(3)
    expect(s.total).toBe(2)
  })
  it('ошибки и правки голосом не считаются', () => {
    const list = [
      e('2026-11-09T10:00:00', 'привет мир'),
      e('2026-11-09T10:01:00', 'сделай мягче', { mode: 'edit' }),
      { at: new Date('2026-11-09T10:02:00').toISOString(), raw: '', polished: null, error: 'сбой' }
    ]
    expect(computeStats(list, now).total).toBe(1)
    expect(isDictation(list[1])).toBe(false)
  })
  it('серия дней идёт через полночь и месяц', () => {
    const list = [
      e('2026-10-31T23:50:00', 'а'),
      e('2026-11-01T00:10:00', 'б'),
      e('2026-11-02T09:00:00', 'в'),
      e('2026-11-03T09:00:00', 'г')
    ]
    expect(computeStats(list, new Date('2026-11-03T12:00:00')).streak).toBe(4)
  })
  it('23:59 и 00:01 — два разных дня', () => {
    const list = [e('2026-11-08T23:59:00', 'а'), e('2026-11-09T00:01:00', 'б')]
    expect(computeStats(list, new Date('2026-11-09T00:30:00')).streak).toBe(2)
  })
  it('серия живёт, если сегодня ещё не диктовали, а вчера да', () => {
    expect(computeStats([e('2026-11-08T10:00:00', 'а')], now).streak).toBe(1)
  })
  it('пропущенный день обрывает серию', () => {
    expect(computeStats([e('2026-11-07T10:00:00', 'а')], now).streak).toBe(0)
    const list = [e('2026-11-06T10:00:00', 'а'), e('2026-11-08T10:00:00', 'б'), e('2026-11-09T10:00:00', 'в')]
    expect(computeStats(list, now).streak).toBe(2)
  })
  it('слов в минуту — только по записям с длительностью', () => {
    const list = [
      e('2026-11-09T10:00:00', Array(60).fill('слово').join(' '), { ms: 30_000 }),
      e('2026-11-09T10:05:00', 'без длительности')
    ]
    expect(computeStats(list, now).wpm).toBe(120)
    expect(computeStats([e('2026-11-09T10:00:00', 'раз два', { ms: 2000 })], now).wpm).toBeNull()
  })
})

describe('pageEntries', () => {
  const all = Array.from({ length: 5 }, (_, i) => e('2026-11-09T10:0' + i + ':00', 'т' + i))
  it('новые сверху, страницами', () => {
    const p1 = pageEntries(all, 2, 0)
    expect(p1.items.map((x) => x.raw)).toEqual(['т4', 'т3'])
    expect(p1.hasMore).toBe(true)
    const p3 = pageEntries(all, 2, 4)
    expect(p3.items.map((x) => x.raw)).toEqual(['т0'])
    expect(p3.hasMore).toBe(false)
    expect(pageEntries(all, 2, 10).items).toEqual([])
  })
})
