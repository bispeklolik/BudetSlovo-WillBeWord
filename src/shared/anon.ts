import type { Turn, AnonRule } from './types'

export type { AnonRule }

// Нормализация для сопоставления: нижний регистр, без пунктуации по краям.
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:()«»"'`…—–\-\s]/g, '')
    .trim()
}

// Строит наложение замен: wordId → текст замены ('' = скрыть хвост многословного спана).
// Длинные правила применяются раньше коротких; слово, уже занятое правилом, не перезахватывается.
export function buildAnonOverlay(turns: Turn[], rules: AnonRule[]): Map<number, string> {
  const overlay = new Map<number, string>()
  const sorted = [...rules]
    .filter((r) => r.find.trim() && r.replace.trim())
    .sort((a, b) => b.find.length - a.find.length)

  for (const t of turns) {
    const words = t.words
    for (const rule of sorted) {
      const toks = rule.find.split(/\s+/).map(norm).filter(Boolean)
      if (!toks.length) continue
      for (let i = 0; i + toks.length <= words.length; i++) {
        let match = true
        for (let j = 0; j < toks.length; j++) {
          const w = words[i + j]
          if (overlay.has(w.id) || norm(w.t) !== toks[j]) {
            match = false
            break
          }
        }
        if (!match) continue
        overlay.set(words[i].id, rule.replace)
        for (let j = 1; j < toks.length; j++) overlay.set(words[i + j].id, '')
      }
    }

    // Морфология для имён: модель перечисляет не все падежные формы, поэтому
    // однословные правила kind='name' дополнительно ловят слова с той же
    // основой (основа = форма без последних 2 букв, хвост ≤ 4 букв — обычные
    // русские окончания; «Евангелие» под «Ева» не попадает: хвост длиннее).
    for (const rule of sorted) {
      if (rule.kind !== 'name' || /\s/.test(rule.find.trim())) continue
      const base = norm(rule.find)
      const stem = base.slice(0, Math.max(3, base.length - 2))
      if (stem.length < 3) continue
      for (const w of words) {
        if (overlay.has(w.id)) continue
        const n = norm(w.t)
        if (n !== base && n.startsWith(stem) && n.length - stem.length <= 4) {
          overlay.set(w.id, rule.replace)
        }
      }
    }
  }
  return overlay
}

// Текст реплики с применённым обезличиванием (для экспорта/копирования).
export function anonTurnText(turn: Turn, overlay: Map<number, string>): string {
  return turn.words
    .map((w) => (overlay.has(w.id) ? overlay.get(w.id)! : w.t))
    .filter((s) => s !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
