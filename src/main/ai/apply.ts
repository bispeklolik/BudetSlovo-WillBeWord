import type { Word } from '../../shared/types'
import { diffWords } from './diff'

// Накладывает причёсанный моделью текст реплики на её слова, сохраняя таймкоды
// неизменённых слов и помечая правки ИИ (src:'ai', оригинал в t0).
// - keep с тем же словом: слово без изменений (id, таймкоды, уверенность целы);
// - keep с другой поверхностью (пунктуация/регистр): тихо обновляем текст, без пометки;
// - replace: новый текст, t0 = прежний оригинал (или текущий), помечаем 'ai';
// - delete: слово выкидываем (паразит);
// - insert: новое слово без таймкода, новый id, помечаем 'ai'.
export function applyCleanup(words: Word[], cleanedText: string, nextId: () => number): Word[] {
  const tokens = cleanedText.split(/\s+/).filter(Boolean)
  const ops = diffWords(
    words.map((w) => w.t),
    tokens
  )
  const out: Word[] = []
  for (const op of ops) {
    if (op.kind === 'keep') {
      const w = words[op.origIndex]
      out.push(op.text === w.t ? w : { ...w, t: op.text })
    } else if (op.kind === 'replace') {
      const w = words[op.origIndex]
      out.push({ ...w, t: op.text, t0: w.t0 ?? w.t, src: 'ai' })
    } else if (op.kind === 'insert') {
      out.push({ id: nextId(), t: op.text, src: 'ai' })
    }
    // delete: пропускаем слово
  }
  return out
}
