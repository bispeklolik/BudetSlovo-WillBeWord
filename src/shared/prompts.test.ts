import { describe, it, expect } from 'vitest'
import { BUILTIN_PROMPTS, CATEGORY_LABELS } from './prompts'

describe('BUILTIN_PROMPTS', () => {
  it('id уникальны', () => {
    const ids = BUILTIN_PROMPTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('у каждого пресета есть имя, непустой system и известная категория', () => {
    for (const p of BUILTIN_PROMPTS) {
      expect(p.name.trim()).not.toBe('')
      expect(p.system.trim().length).toBeGreaterThan(20)
      expect(CATEGORY_LABELS[p.category]).toBeDefined()
    }
  })

  it('покрыты все названные применения (универсальные + профессии)', () => {
    const cats = new Set(BUILTIN_PROMPTS.map((p) => p.category))
    for (const c of [
      'universal',
      'psychology',
      'meeting',
      'legal',
      'medical',
      'teaching',
      'journalism',
      'sales'
    ] as const) {
      expect(cats.has(c)).toBe(true)
    }
  })
})
