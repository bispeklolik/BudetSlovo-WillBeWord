import type { ProjectMeta, Word } from './types'

export interface ProjectHit {
  slug: string
  title: string
  count: number
  snippet: string
  sec: number // время первого совпадения, для перехода
}

// Фрагмент текста вокруг найденного слова (для превью в результатах).
function snippetAround(words: Word[], idx: number): string {
  const from = Math.max(0, idx - 3)
  const to = Math.min(words.length, idx + 4)
  const pre = from > 0 ? '…' : ''
  const post = to < words.length ? '…' : ''
  return (
    pre +
    words
      .slice(from, to)
      .map((w) => w.t)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() +
    post
  )
}

// Поиск подстроки по всем записям. Один результат на запись:
// число совпадений + превью первого. Без учёта регистра.
export function searchProjects(projects: ProjectMeta[], query: string): ProjectHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: ProjectHit[] = []
  for (const p of projects) {
    let count = 0
    let snippet = ''
    let sec = 0
    for (const t of p.turns ?? []) {
      t.words.forEach((w, i) => {
        if (w.t.toLowerCase().includes(q)) {
          if (!count) {
            snippet = snippetAround(t.words, i)
            sec = w.s ?? t.startSec
          }
          count++
        }
      })
    }
    if (count) out.push({ slug: p.slug, title: p.title, count, snippet, sec })
  }
  // Сначала записи с большим числом совпадений.
  out.sort((a, b) => b.count - a.count)
  return out
}
