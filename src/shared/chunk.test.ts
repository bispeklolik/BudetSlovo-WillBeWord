import { describe, it, expect } from 'vitest'
import { chunkByLines } from './chunk'

describe('chunkByLines', () => {
  it('короткий текст — один чанк', () => {
    expect(chunkByLines('привет\nмир', 100)).toEqual(['привет\nмир'])
  })

  it('режет по границам строк, ничего не теряя', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `реплика номер ${i} с текстом`)
    const text = lines.join('\n')
    const chunks = chunkByLines(text, 60)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(60)
    expect(chunks.join('\n')).toBe(text) // без потерь
  })

  it('строка длиннее лимита режется жёстко, без зацикливания', () => {
    const long = 'а'.repeat(250)
    const chunks = chunkByLines(long, 100)
    expect(chunks.length).toBe(3)
    expect(chunks.join('')).toBe(long)
  })
})
