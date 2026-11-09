import type { ProjectMeta, DictationEntry } from './types'

// Лента «Главной»: записи и диктовки вперемешку, сгруппированные по дням.

export type FeedItem =
  | { kind: 'rec'; at: string; slug: string; title: string; durationSec: number; demo?: boolean }
  | { kind: 'dict'; at: string; text: string; failed: boolean }

export type DayGroup = 'today' | 'yesterday' | 'earlier'

export const DAY_LABEL: Record<DayGroup, string> = {
  today: 'СЕГОДНЯ',
  yesterday: 'ВЧЕРА',
  earlier: 'РАНЬШЕ'
}

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function dayGroup(iso: string, now: Date = new Date()): DayGroup {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return 'earlier'
  const diff = Math.round((dayStart(now) - dayStart(t)) / 86_400_000)
  if (diff <= 0) return 'today' // сегодня и «из будущего» (часы шли неверно)
  if (diff === 1) return 'yesterday'
  return 'earlier'
}

export function buildFeed(
  projects: ProjectMeta[],
  dicts: DictationEntry[],
  limit = 40
): FeedItem[] {
  const items: FeedItem[] = []
  for (const p of projects)
    items.push({
      kind: 'rec',
      at: p.createdAt,
      slug: p.slug,
      title: p.title,
      durationSec: p.audio.durationSec,
      demo: p.demo
    })
  for (const d of dicts) {
    const text = (d.text ?? d.polished ?? d.raw ?? '').trim()
    items.push({ kind: 'dict', at: d.at, text, failed: !text && !!d.error })
  }
  items.sort((a, b) => b.at.localeCompare(a.at))
  return items.slice(0, limit)
}

export function groupFeed(
  items: FeedItem[],
  now: Date = new Date()
): { group: DayGroup; label: string; items: FeedItem[] }[] {
  const out: { group: DayGroup; label: string; items: FeedItem[] }[] = []
  for (const it of items) {
    const g = dayGroup(it.at, now)
    let last = out[out.length - 1]
    if (!last || last.group !== g) {
      last = { group: g, label: DAY_LABEL[g], items: [] }
      out.push(last)
    }
    last.items.push(it)
  }
  return out
}
