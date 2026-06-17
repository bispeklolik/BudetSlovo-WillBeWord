import type { Word } from '../../shared/types'
import { diffWords } from './diff'

function norm(s: string): string {
  return s.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

// Накладывает причёсанный моделью текст реплики на её слова, сохраняя таймкоды
// неизменённых слов и помечая правки ИИ (src:'ai', оригинал в t0). Слова из
// списка suspect (вероятные ошибки распознавания/бессмыслица), которые ИИ НЕ
// менял, помечаются src:'suspect' — для гарантированной подсветки «проверь».
// - keep: слово остаётся (id, таймкоды целы), поверхность обновляется до причёсанной;
// - replace: новый текст, t0 = прежний оригинал, src:'ai';
// - delete: слово выкидываем (паразит);
// - insert: новое слово без таймкода, новый id, src:'ai'.
export function applyCleanup(
  words: Word[],
  cleanedText: string,
  nextId: () => number,
  suspect: string[] = []
): Word[] {
  const tokens = cleanedText.split(/\s+/).filter(Boolean)
  const ops = diffWords(
    words.map((w) => w.t),
    tokens
  )
  const out: Word[] = []
  for (const op of ops) {
    if (op.kind === 'keep') {
      const w = words[op.origIndex]
      out.push({ ...w, t: op.text })
    } else if (op.kind === 'replace') {
      const w = words[op.origIndex]
      out.push({ ...w, t: op.text, t0: w.t0 ?? w.t, src: 'ai' })
    } else if (op.kind === 'insert') {
      out.push({ id: nextId(), t: op.text, src: 'ai' })
    }
    // delete: пропускаем слово
  }

  if (suspect.length) {
    const set = new Set<string>()
    for (const s of suspect) {
      for (const tok of s.split(/\s+/)) {
        const n = norm(tok)
        if (n) set.add(n)
      }
    }
    for (const w of out) {
      if (!w.src && set.has(norm(w.t))) w.src = 'suspect'
    }
  }
  return out
}
