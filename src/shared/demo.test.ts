import { describe, it, expect } from 'vitest'
import { demoTurns } from './demo'
import { listUncertain } from './wordVariants'

describe('пример записи: неуверенные слова', () => {
  it('в примере 3 слова с низкой уверенностью, текст без служебных пометок', () => {
    const { turns } = demoTurns()
    const unsure = listUncertain(turns)
    expect(unsure).toHaveLength(3)
    const all = turns.flatMap((t) => t.words)
    for (const u of unsure) {
      const w = all.find((x) => x.id === u.wordId)!
      expect(w.p).toBeGreaterThan(0.25)
      expect(w.p).toBeLessThan(0.65)
    }
    expect(all.some((w) => w.t.includes('~'))).toBe(false)
    expect(all.find((w) => w.id === unsure[0].wordId)!.t).toBe('увалят.')
  })
})
