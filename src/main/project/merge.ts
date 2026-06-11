import { readFileSync } from 'fs'
import { join } from 'path'
import { projectDir } from './store'
import type { SpeakerInfo, Turn, Word } from '../../shared/types'

interface EngineWord {
  start: number
  end: number
  word: string
  probability?: number
}

interface EngineSegment {
  start: number
  end: number
  text: string
  words?: EngineWord[]
}

interface SpeakerInterval {
  start: number
  end: number
  label: string
}

// Диаризация живёт только в TXT (json её не содержит — особенность движка).
// Формат строки: [00:00.440 --> 00:02.200]  [SPEAKER_00]: Так, прием.
const TXT_LINE = /^\[([0-9:.,]+)\s*-->\s*([0-9:.,]+)\]\s*\[(SPEAKER_\d+)\]:/

function tcToSec(tc: string): number {
  let sec = 0
  for (const p of tc.split(':')) sec = sec * 60 + parseFloat(p.replace(',', '.'))
  return sec
}

export function parseSpeakerIntervals(txt: string): SpeakerInterval[] {
  const out: SpeakerInterval[] = []
  for (const line of txt.split(/\r?\n/)) {
    const m = TXT_LINE.exec(line)
    if (m) out.push({ start: tcToSec(m[1]), end: tcToSec(m[2]), label: m[3] })
  }
  return out
}

function speakerForWord(ws: number, we: number, intervals: SpeakerInterval[]): string {
  let best = ''
  let bestOverlap = 0
  for (const iv of intervals) {
    const ov = Math.min(we, iv.end) - Math.max(ws, iv.start)
    if (ov > bestOverlap) {
      bestOverlap = ov
      best = iv.label
    }
  }
  if (best) return best
  // Перекрытий нет — берём интервал, в котором лежит середина слова,
  // иначе последний начавшийся до неё.
  const mid = (ws + we) / 2
  let last = intervals.length > 0 ? intervals[0].label : 'SPEAKER_00'
  for (const iv of intervals) {
    if (iv.start <= mid) last = iv.label
    else break
  }
  return last
}

export interface MergeResult {
  speakers: SpeakerInfo[]
  turns: Turn[]
}

const DEFAULT_NAMES = ['Психолог', 'Клиент']

export function mergeEngineOutputs(slug: string): MergeResult {
  const dir = join(projectDir(slug), 'engine')
  const data = JSON.parse(readFileSync(join(dir, 'audio.json'), 'utf8')) as {
    segments: EngineSegment[]
  }
  const txt = readFileSync(join(dir, 'audio.txt'), 'utf8')
  const intervals = parseSpeakerIntervals(txt)

  // Плоский список слов; сегменты без words[] превращаем в одно «слово»-блок.
  const flat: Array<{ s: number; e: number; p: number; t: string }> = []
  for (const seg of data.segments ?? []) {
    if (seg.words && seg.words.length > 0) {
      for (const w of seg.words) {
        const t = w.word.trim()
        if (t) flat.push({ s: w.start, e: w.end, p: w.probability ?? 1, t })
      }
    } else if (seg.text?.trim()) {
      flat.push({ s: seg.start, e: seg.end, p: 1, t: seg.text.trim() })
    }
  }

  const labels: string[] = []
  const speakerOf = (label: string): string => {
    let idx = labels.indexOf(label)
    if (idx === -1) {
      labels.push(label)
      idx = labels.length - 1
    }
    return 'S' + idx
  }

  const turns: Turn[] = []
  let wordId = 0
  let cur: Turn | null = null
  for (const w of flat) {
    const spk = speakerOf(speakerForWord(w.s, w.e, intervals))
    if (!cur || cur.spk !== spk) {
      cur = { id: 'T' + turns.length, spk, startSec: w.s, words: [] }
      turns.push(cur)
    }
    const word: Word = { id: wordId++, s: w.s, e: w.e, p: Math.round(w.p * 1000) / 1000, t: w.t }
    cur.words.push(word)
  }

  const speakers: SpeakerInfo[] = labels.map((label, i) => ({
    id: 'S' + i,
    engineLabel: label,
    name: DEFAULT_NAMES[i] ?? `Говорящий ${i + 1}`,
    colorKey: 'spk' + ((i % 2) + 1)
  }))

  return { speakers, turns }
}
