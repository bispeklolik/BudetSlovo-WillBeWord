import type { ProjectMeta, Word } from './types'

// Правки — семантические патчи. Применяются одинаково в renderer
// (оптимистично) и в main (единственный «писатель» на диск).
export type Patch =
  | { op: 'setWordText'; turnId: string; wordId: number; t: string; t0: string | null }
  | { op: 'deleteWords'; turnId: string; wordIds: number[] }
  | { op: 'insertWords'; turnId: string; atIndex: number; words: Word[] }
  | { op: 'setTurnWords'; turnId: string; words: Word[] }
  | { op: 'renameSpeaker'; speakerId: string; name: string }
  | { op: 'setTurnSpeaker'; turnId: string; spk: string }
  | { op: 'mergeTurnIntoPrev'; turnId: string }
  | {
      op: 'splitTurn'
      turnId: string
      atWordId: number
      newTurnId: string
      spk: string
      startSec: number
    }
  | { op: 'replaceAll'; find: string; replace: string }

// Замена всех вхождений подстроки в одном слове, без учёта регистра.
// Регистр незатронутых частей сохраняется; replace вставляется как есть.
export function replaceCI(text: string, find: string, replace: string): string {
  if (!find) return text
  const lower = text.toLowerCase()
  const f = find.toLowerCase()
  let out = ''
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(f, i)
    if (idx === -1) {
      out += text.slice(i)
      break
    }
    out += text.slice(i, idx) + replace
    i = idx + f.length
  }
  return out
}

export function applyPatch(meta: ProjectMeta, p: Patch): void {
  const turns = meta.turns ?? []
  const turnIdx = (id: string): number => turns.findIndex((t) => t.id === id)

  switch (p.op) {
    case 'setWordText': {
      const t = turns[turnIdx(p.turnId)]
      const w = t?.words.find((w) => w.id === p.wordId)
      if (!w) return
      w.t = p.t
      if (p.t0 === null) delete w.t0
      else w.t0 = p.t0
      return
    }
    case 'deleteWords': {
      const t = turns[turnIdx(p.turnId)]
      if (!t) return
      const ids = new Set(p.wordIds)
      t.words = t.words.filter((w) => !ids.has(w.id))
      return
    }
    case 'insertWords': {
      const t = turns[turnIdx(p.turnId)]
      if (!t) return
      const at = Math.max(0, Math.min(t.words.length, p.atIndex))
      t.words.splice(at, 0, ...p.words)
      return
    }
    // Полная замена слов реплики (надиктовка заново): слова без таймкодов —
    // караоке их пропускает, как и вставленные вручную.
    case 'setTurnWords': {
      const t = turns[turnIdx(p.turnId)]
      if (!t) return
      t.words = p.words
      return
    }
    case 'renameSpeaker': {
      const s = meta.speakers?.find((s) => s.id === p.speakerId)
      if (s) s.name = p.name
      return
    }
    case 'setTurnSpeaker': {
      const t = turns[turnIdx(p.turnId)]
      if (t) t.spk = p.spk
      return
    }
    case 'mergeTurnIntoPrev': {
      const i = turnIdx(p.turnId)
      if (i <= 0) return
      const prev = turns[i - 1]
      prev.words.push(...turns[i].words)
      turns.splice(i, 1)
      return
    }
    case 'splitTurn': {
      const i = turnIdx(p.turnId)
      if (i === -1) return
      const t = turns[i]
      const wi = t.words.findIndex((w) => w.id === p.atWordId)
      if (wi === -1) return
      const moved = t.words.splice(wi)
      turns.splice(i + 1, 0, {
        id: p.newTurnId,
        spk: p.spk,
        startSec: p.startSec,
        words: moved
      })
      return
    }
    case 'replaceAll': {
      if (!p.find) return
      for (const t of turns) {
        for (const w of t.words) {
          if (!w.t) continue
          const next = replaceCI(w.t, p.find, p.replace)
          if (next === w.t) continue
          if (w.t0 === undefined) w.t0 = w.t // запоминаем оригинал движка для отката/тултипа
          w.t = next
        }
      }
      return
    }
  }
}

export function applyPatches(meta: ProjectMeta, patches: Patch[]): void {
  for (const p of patches) applyPatch(meta, p)
}

export function nextWordId(meta: ProjectMeta): number {
  let max = -1
  for (const t of meta.turns ?? []) {
    for (const w of t.words) if (w.id > max) max = w.id
  }
  return max + 1
}
