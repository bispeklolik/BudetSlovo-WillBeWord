import { describe, it, expect } from 'vitest'
import { buildFeed, groupFeed, dayGroup } from './feed'
import type { ProjectMeta, DictationEntry } from './types'

const now = new Date(2026, 10, 9, 15, 0, 0) // 9 ноября, местное время
const at = (d: number, h: number): string => new Date(2026, 10, d, h, 0, 0).toISOString()

const proj = (slug: string, createdAt: string): ProjectMeta =>
  ({ slug, title: slug, createdAt, audio: { durationSec: 60 } }) as unknown as ProjectMeta

describe('feed', () => {
  it('делит дни на сегодня / вчера / раньше', () => {
    expect(dayGroup(at(9, 1), now)).toBe('today')
    expect(dayGroup(at(8, 23), now)).toBe('yesterday')
    expect(dayGroup(at(7, 12), now)).toBe('earlier')
    expect(dayGroup('не дата', now)).toBe('earlier')
  })

  it('смешивает записи и диктовки, свежие сверху, и группирует', () => {
    const dicts: DictationEntry[] = [
      { at: at(9, 12), raw: 'сырой', polished: 'чистый', text: 'вставлено' },
      { at: at(5, 9), raw: 'старая', polished: null }
    ]
    const feed = buildFeed([proj('a', at(9, 13)), proj('b', at(8, 10))], dicts)
    expect(feed.map((f) => f.kind)).toEqual(['rec', 'dict', 'rec', 'dict'])
    const groups = groupFeed(feed, now)
    expect(groups.map((g) => g.label)).toEqual(['СЕГОДНЯ', 'ВЧЕРА', 'РАНЬШЕ'])
    expect(groups[0].items).toHaveLength(2)
  })

  it('диктовка с ошибкой и без текста помечается failed', () => {
    const f = buildFeed([], [{ at: at(9, 9), raw: '', polished: null, error: 'x' }])
    expect(f[0]).toMatchObject({ kind: 'dict', failed: true })
  })

  it('обрезает по лимиту', () => {
    const many = Array.from({ length: 10 }, (_, i) => proj('p' + i, at(9, i)))
    expect(buildFeed(many, [], 3)).toHaveLength(3)
  })
})
