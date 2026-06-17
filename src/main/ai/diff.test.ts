import { describe, it, expect } from 'vitest'
import { diffWords } from './diff'

describe('diffWords', () => {
  it('marks all words kept when text is identical', () => {
    const ops = diffWords(['Меня', 'зовут', 'Матвей'], ['Меня', 'зовут', 'Матвей'])
    expect(ops).toHaveLength(3)
    expect(ops.every((o) => o.kind === 'keep')).toBe(true)
  })

  it('detects a single-word replacement', () => {
    const ops = diffWords(['Меня', 'завут', 'Матвей'], ['Меня', 'зовут', 'Матвей'])
    const rep = ops.find((o) => o.kind === 'replace')
    expect(rep).toMatchObject({ kind: 'replace', origIndex: 1, text: 'зовут' })
    // the surrounding words stay kept (timestamps preserved later)
    expect(ops.filter((o) => o.kind === 'keep').map((o) => (o as { origIndex: number }).origIndex))
      .toEqual([0, 2])
  })

  it('detects a deleted filler word', () => {
    const ops = diffWords(['ну', 'Меня', 'зовут'], ['Меня', 'зовут'])
    expect(ops.find((o) => o.kind === 'delete')).toMatchObject({ kind: 'delete', origIndex: 0 })
    expect(ops.filter((o) => o.kind === 'keep')).toHaveLength(2)
  })

  it('detects an inserted word with its anchor', () => {
    const ops = diffWords(['Меня', 'Матвей'], ['Меня', 'зовут', 'Матвей'])
    expect(ops.find((o) => o.kind === 'insert')).toMatchObject({
      kind: 'insert',
      text: 'зовут',
      afterOrigIndex: 0
    })
  })

  it('treats punctuation/case-only change as kept, carrying the new surface form', () => {
    const ops = diffWords(['зовут,'], ['Зовут.'])
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'keep', origIndex: 0, text: 'Зовут.' })
  })

  it('handles insertion at the very start (afterOrigIndex -1)', () => {
    const ops = diffWords(['мир'], ['привет', 'мир'])
    expect(ops.find((o) => o.kind === 'insert')).toMatchObject({
      kind: 'insert',
      text: 'привет',
      afterOrigIndex: -1
    })
  })
})
