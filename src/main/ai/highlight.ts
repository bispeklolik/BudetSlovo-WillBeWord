import type { Turn, Word } from '../../shared/types'

// Слово → один нормализованный токен (нижний регистр, без пунктуации/дефисов).
function normTok(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}
function phraseToks(p: string): string[] {
  return p.split(/\s+/).map(normTok).filter(Boolean)
}

// Размечает «лучшие мысли»: для каждой цитаты ищет подряд идущие слова реплики,
// совпадающие по нормализованным токенам, и ставит им hl. Прошлые выделения
// сбрасываются (highlights — производное, не разрушает текст).
export function applyHighlights(turns: Turn[], phrases: string[]): Turn[] {
  const ptoks = phrases.map(phraseToks).filter((t) => t.length > 0)
  return turns.map((t) => {
    const words: Word[] = t.words.map((w) => ({ ...w, hl: undefined }))
    const wnorm = words.map((w) => normTok(w.t))
    for (const toks of ptoks) {
      for (let i = 0; i + toks.length <= wnorm.length; i++) {
        let ok = true
        for (let j = 0; j < toks.length; j++) {
          if (wnorm[i + j] !== toks[j]) {
            ok = false
            break
          }
        }
        if (ok) for (let j = 0; j < toks.length; j++) words[i + j].hl = true
      }
    }
    return { ...t, words }
  })
}

export function clearHighlights(turns: Turn[]): Turn[] {
  return turns.map((t) => ({ ...t, words: t.words.map((w) => ({ ...w, hl: undefined })) }))
}
