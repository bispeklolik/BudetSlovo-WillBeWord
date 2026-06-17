import { describe, it, expect } from 'vitest'
import { applyCleanup } from './apply'
import type { Word } from '../../shared/types'

const W = (id: number, t: string, extra: Partial<Word> = {}): Word => ({
  id,
  t,
  s: id,
  e: id + 1,
  p: 0.9,
  ...extra
})

describe('applyCleanup', () => {
  it('drops a filler, keeps timestamps on kept words, marks a replacement', () => {
    let n = 100
    const words = [W(0, 'ну'), W(1, 'Меня'), W(2, 'завут', { p: 0.4 })]
    const out = applyCleanup(words, 'Меня зовут', () => n++)

    expect(out.map((w) => w.t)).toEqual(['Меня', 'зовут'])
    const kept = out.find((w) => w.t === 'Меня')!
    expect(kept).toMatchObject({ id: 1, s: 1, e: 2 })
    expect(kept.src).toBeUndefined()
    const rep = out.find((w) => w.t === 'зовут')!
    expect(rep).toMatchObject({ id: 2, s: 2, e: 3, t0: 'завут', src: 'ai' })
  })

  it('marks an inserted word with a fresh id and no timestamp', () => {
    let n = 500
    const out = applyCleanup([W(0, 'Меня'), W(1, 'Матвей')], 'Меня зовут Матвей', () => n++)
    const ins = out.find((w) => w.t === 'зовут')!
    expect(ins).toMatchObject({ id: 500, t: 'зовут', src: 'ai' })
    expect(ins.s).toBeUndefined()
    expect(ins.e).toBeUndefined()
  })

  it('applies a punctuation/case-only change silently (no src), keeping id+timestamp', () => {
    const out = applyCleanup([W(0, 'зовут')], 'Зовут,', () => 0)
    expect(out[0]).toMatchObject({ id: 0, t: 'Зовут,', s: 0, e: 1 })
    expect(out[0].src).toBeUndefined()
    expect(out[0].t0).toBeUndefined()
  })

  it('preserves an earlier human edit (t0) when AI replaces again', () => {
    let n = 0
    const words = [W(0, 'зовут', { t0: 'завут' })]
    const out = applyCleanup(words, 'звали', () => n++)
    expect(out[0]).toMatchObject({ t: 'звали', t0: 'завут', src: 'ai' })
  })

  it('flags a suspect word (kept, not AI-changed) for review', () => {
    const words = [W(0, 'Насилие'), W(1, 'это'), W(2, 'коблит')]
    const out = applyCleanup(words, 'Насилие это коблит', () => 0, ['коблит'])
    expect(out.find((w) => w.t === 'коблит')!.src).toBe('suspect')
    expect(out.find((w) => w.t === 'Насилие')!.src).toBeUndefined()
  })

  it('does not flag suspect when AI already changed that word (stays ai)', () => {
    const out = applyCleanup([W(0, 'коблит')], 'бьёт', () => 0, ['коблит'])
    expect(out[0]).toMatchObject({ t: 'бьёт', src: 'ai' })
  })
})
