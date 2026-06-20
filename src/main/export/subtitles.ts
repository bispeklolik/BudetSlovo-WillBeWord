import type { Turn, Word } from '../../shared/types'

export type SubtitleFormat = 'srt' | 'vtt'

interface Cue {
  start: number
  end: number
  text: string
}

// Группируем слова реплики в реплики-субтитры (cue) разумной длины: по концу
// предложения или ~42 символам. Таймкоды берём из слов (вставленные без
// таймкода используют соседей / начало реплики).
function buildCues(turns: Turn[]): Cue[] {
  const cues: Cue[] = []
  for (const turn of turns) {
    let buf: Word[] = []
    let chars = 0
    const flush = (): void => {
      if (!buf.length) return
      const start = buf.find((w) => w.s !== undefined)?.s ?? turn.startSec
      const ends = buf.filter((w) => w.e !== undefined).map((w) => w.e as number)
      const end = ends.length ? ends[ends.length - 1] : start + 2
      const text = buf
        .map((w) => w.t)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) cues.push({ start, end: Math.max(end, start + 0.3), text })
      buf = []
      chars = 0
    }
    for (const w of turn.words) {
      buf.push(w)
      chars += w.t.length + 1
      if (chars >= 42 || /[.!?…]$/.test(w.t.trim())) flush()
    }
    flush()
  }
  return cues
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0')
}

function fmtTime(sec: number, msSep: string): string {
  const total = Math.max(0, Math.round(sec * 1000))
  const ms = total % 1000
  const s = Math.floor(total / 1000) % 60
  const m = Math.floor(total / 60000) % 60
  const h = Math.floor(total / 3600000)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${msSep}${pad(ms, 3)}`
}

export function toSubtitles(turns: Turn[], format: SubtitleFormat): string {
  const cues = buildCues(turns)
  if (format === 'vtt') {
    const body = cues
      .map((c) => `${fmtTime(c.start, '.')} --> ${fmtTime(c.end, '.')}\n${c.text}`)
      .join('\n\n')
    return `WEBVTT\n\n${body}\n`
  }
  const body = cues
    .map((c, i) => `${i + 1}\n${fmtTime(c.start, ',')} --> ${fmtTime(c.end, ',')}\n${c.text}`)
    .join('\n\n')
  return `${body}\n`
}
