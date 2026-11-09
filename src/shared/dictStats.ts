import type { DictationEntry } from './types'

// Журнал диктовок (dictation-history.jsonl): разбор строк и статистика.
// Чистые функции без доступа к диску — их проверяют тесты.

export interface DictationStats {
  /** Слов, продиктованных за последние 7 дней. */
  wordsWeek: number
  /** Дней подряд с диктовкой (по местной дате). Если сегодня ещё не диктовали, но вчера да — серия живёт. */
  streak: number
  /** Удачных диктовок за всё время. */
  total: number
  /** Слов в минуту по диктовкам, где записана длительность; null — данных ещё нет. */
  wpm: number | null
}

export const emptyStats: DictationStats = { wordsWeek: 0, streak: 0, total: 0, wpm: null }

/** Строки журнала → записи. Битые строки и пустые записи пропускаем. Порядок — как в файле. */
export function parseHistory(text: string): DictationEntry[] {
  const out: DictationEntry[] = []
  for (const line of text.split('\n')) {
    const l = line.trim()
    if (!l) continue
    try {
      const e = JSON.parse(l) as DictationEntry
      if (e && typeof e === 'object' && typeof e.at === 'string' && (e.raw || e.error)) out.push(e)
    } catch {
      /* битая строка — пропускаем */
    }
  }
  return out
}

/** Удачная диктовка: есть текст, это не ошибка и не голосовая правка. */
export function isDictation(e: DictationEntry): boolean {
  return !e.error && e.mode !== 'edit' && !!(e.text ?? e.polished ?? e.raw)?.trim()
}

export function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Страница журнала: новые сверху, limit записей после offset. */
export function pageEntries(
  all: DictationEntry[],
  limit: number,
  offset: number
): { items: DictationEntry[]; hasMore: boolean } {
  const rev = all.slice().reverse()
  const items = rev.slice(offset, offset + limit)
  return { items, hasMore: offset + limit < rev.length }
}

export function computeStats(all: DictationEntry[], now: Date = new Date()): DictationStats {
  const good = all.filter(isDictation)
  const weekStart = now.getTime() - 7 * 86400_000
  let wordsWeek = 0
  let wordsMs = 0
  let ms = 0
  const days = new Set<string>()
  for (const e of good) {
    const t = new Date(e.at)
    if (isNaN(t.getTime())) continue
    days.add(dayKey(t))
    const words = countWords(e.text ?? e.polished ?? e.raw)
    if (t.getTime() >= weekStart && t.getTime() <= now.getTime() + 60_000) wordsWeek += words
    if (typeof e.ms === 'number' && e.ms >= 1000) {
      wordsMs += words
      ms += e.ms
    }
  }
  // Серия: идём назад по датам через setDate — переход на летнее время не страшен.
  let streak = 0
  const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!days.has(dayKey(cur))) cur.setDate(cur.getDate() - 1)
  while (days.has(dayKey(cur))) {
    streak++
    cur.setDate(cur.getDate() - 1)
  }
  return {
    wordsWeek,
    streak,
    total: good.length,
    wpm: ms >= 10_000 ? Math.round(wordsMs / (ms / 60_000)) : null
  }
}
