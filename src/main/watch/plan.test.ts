import { describe, it, expect } from 'vitest'
import { planPoll, seenKey, type Pending } from './plan'

const f = (name: string, size: number, mtimeMs = 1000): { name: string; size: number; mtimeMs: number } => ({ name, size, mtimeMs })

describe('planPoll', () => {
  it('новый файл берётся после двух опросов без изменений', () => {
    let pending = new Map<string, Pending>()
    const files = [f('a.m4a', 100)]
    for (let i = 0; i < 2; i++) {
      const r = planPoll(files, new Set(), pending)
      expect(r.ready).toEqual([])
      pending = r.pending
    }
    expect(planPoll(files, new Set(), pending).ready.map((x) => x.name)).toEqual(['a.m4a'])
  })
  it('растущий файл ждёт', () => {
    let r = planPoll([f('a.mp3', 100)], new Set(), new Map())
    r = planPoll([f('a.mp3', 200)], new Set(), r.pending)
    r = planPoll([f('a.mp3', 300)], new Set(), r.pending)
    expect(r.ready).toEqual([])
    expect(r.pending.get('a.mp3')!.stable).toBe(0)
  })
  it('уже виденные, пустые, не медиа и временные — пропускает', () => {
    const seen = new Set([seenKey(f('old.wav', 5))])
    const r = planPoll([f('old.wav', 5), f('zero.m4a', 0), f('doc.txt', 9), f('~$tmp.mp3', 9), f('.hidden.m4a', 9)], seen, new Map(), 0)
    expect(r.ready).toEqual([])
    expect(r.pending.size).toBe(0)
  })
  it('файл с тем же именем, но другим размером — новый', () => {
    const seen = new Set([seenKey(f('rec.m4a', 5))])
    expect(planPoll([f('rec.m4a', 6)], seen, new Map(), 0).ready).toHaveLength(1)
  })
})
