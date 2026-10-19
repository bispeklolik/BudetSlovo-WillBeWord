import type { Turn, AnonRule } from './types'

export type { AnonRule }

// Нормализация для сопоставления: нижний регистр, без пунктуации по краям.
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:()«»"'`…—–\-\s]/g, '')
    .trim()
}

// Падежные окончания русских имён и фамилий: «Ева → Евы, Еве, Евой»,
// «Мария → Марии», «Андрей → Андрея», «Игорь → Игорем», «Иван → Ивану»,
// «Иванов → Ивановой». Нужны для коротких имён: у «Евы» правило «основа без
// двух букв» (ниже) не работало — «Евой» меняет уже вторую букву с конца
// (ревью волны 4).
const FEM = ['а', 'я', 'ы', 'и', 'е', 'у', 'ю', 'ой', 'ей', 'ою', 'ею']
const SOFT = ['ь', 'я', 'ю', 'ем', 'е', 'и', 'ью', 'ей']
const HARD = ['', 'а', 'у', 'ом', 'е', 'ы', 'ым', 'ой', 'ых', 'ую', 'ов', 'ам', 'ами', 'ах']

function nameForms(base: string): Set<string> {
  const out = new Set<string>([base])
  const add = (stem: string, ends: string[]): void => ends.forEach((e) => out.add(stem + e))
  const last = base.slice(-1)
  if (last === 'а' || last === 'я') add(base.slice(0, -1), FEM)
  else if (last === 'й') add(base.slice(0, -1), ['й', 'я', 'ю', 'ем', 'е', 'и'])
  else if (last === 'ь') add(base.slice(0, -1), SOFT)
  else if (/[бвгджзклмнпрстфхцчшщ]/.test(last)) add(base, HARD)
  return out
}

/**
 * Совпадает ли слово (уже нормализованное) с именем из правила в любом падеже.
 * Точные окончания + прежнее правило «основа без двух последних букв, хвост
 * ≤ 4 букв» («Евангелие» под «Ева» не попадает: хвост длиннее).
 */
function nameMatcher(find: string): (n: string) => boolean {
  const base = norm(find)
  const forms = nameForms(base)
  const stem = base.slice(0, Math.max(3, base.length - 2))
  return (n) =>
    forms.has(n) || (stem.length >= 3 && n !== base && n.startsWith(stem) && n.length - stem.length <= 4)
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
      const same = nameMatcher(rule.find)
      for (const w of words) {
        if (overlay.has(w.id)) continue
        if (same(norm(w.t))) overlay.set(w.id, rule.replace)
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

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Правила обезличивания на свободный текст (мои заметки, вопрос к ИИ, название
 * записи, имя говорящего). Фразы — целиком; имена — и в падежах, как в
 * buildAnonOverlay («Марии», «Марией» под правилом «Мария»). Ревью волны 4:
 * без падежей имя клиента в заметках уходило в облако.
 */
export function anonPlain(text: string, rules: AnonRule[] | undefined): string {
  const list = [...(rules ?? [])].filter((r) => r.find.trim() && r.replace.trim()).sort((a, b) => b.find.length - a.find.length)
  let out = text
  for (const r of list) {
    const words = r.find.trim().split(/\s+/).map(escRe)
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[\\s,.!?;:—–-]+')}(?![\\p{L}\\p{N}])`, 'giu'), r.replace)
  }
  for (const r of list) {
    if (r.kind !== 'name' || /\s/.test(r.find.trim())) continue
    const same = nameMatcher(r.find)
    out = out.replace(/[\p{L}\p{N}]+/gu, (w) => (same(norm(w)) ? r.replace : w))
  }
  return out
}
