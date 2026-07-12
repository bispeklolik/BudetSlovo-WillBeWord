import { buildTurns, type FlatWord, type MergeResult } from './turns'
import type { SpeakerInfo, Turn } from './types'

// Чистые мапперы ответов облачных STT → {speakers, turns}. Без fs/сети —
// общие для main (Node) и веб-версии (браузер).

// ---- Deepgram ----
export interface DgWord {
  word: string
  start: number
  end: number
  confidence?: number
  speaker?: number
  punctuated_word?: string
}

export interface DgResponse {
  results?: { channels?: { alternatives?: { words?: DgWord[] }[] }[] }
}

export function deepgramToTurns(dg: DgResponse): MergeResult {
  const words = dg.results?.channels?.[0]?.alternatives?.[0]?.words ?? []
  const flat: FlatWord[] = words
    .map((w) => ({
      s: w.start,
      e: w.end,
      p: w.confidence ?? 1,
      t: (w.punctuated_word ?? w.word ?? '').trim(),
      label: 'DG' + (w.speaker ?? 0)
    }))
    .filter((w) => w.t !== '')
  return buildTurns(flat)
}

// ---- ElevenLabs Scribe ----
export interface ElWord {
  text: string
  start: number
  end: number
  type?: string
  speaker_id?: string | null
}

export interface ElResponse {
  words?: ElWord[]
}

export function elevenToTurns(data: ElResponse): MergeResult {
  const flat: FlatWord[] = (data.words ?? [])
    .filter((w) => w.type === 'word' && (w.text ?? '').trim() !== '')
    .map((w) => ({
      s: w.start,
      e: w.end,
      p: 1,
      t: w.text.trim(),
      label: w.speaker_id ?? 'speaker_0'
    }))
  return buildTurns(flat)
}

// ---- OpenAI / Groq (Whisper, verbose_json) ----
interface OaWord {
  word: string
  start: number
  end: number
}
interface OaSegment {
  start: number
  end: number
  text: string
}
export interface OaResponse {
  text?: string
  words?: OaWord[]
  segments?: OaSegment[]
}

// У Whisper нет диаризации → один говорящий; реплики бьём по сегментам Whisper
// (естественные предложения), слово относим к сегменту по времени начала.
export function openaiToTurns(data: OaResponse): MergeResult {
  const words = (data.words ?? []).filter((w) => (w.word ?? '').trim() !== '')
  const segments = data.segments ?? []
  if (words.length === 0) return { speakers: [], turns: [] }

  const turns: Turn[] = []
  let wordId = 0
  let si = -1 // индекс текущего сегмента
  let segForCur = -2
  let cur: Turn | null = null
  for (const w of words) {
    while (si + 1 < segments.length && w.start >= segments[si + 1].start) si++
    if (!cur || si !== segForCur) {
      cur = { id: 'T' + turns.length, spk: 'S0', startSec: w.start, words: [] }
      turns.push(cur)
      segForCur = si
    }
    cur.words.push({ id: wordId++, s: w.start, e: w.end, p: 1, t: w.word.trim() })
  }

  const speakers: SpeakerInfo[] = [
    { id: 'S0', engineLabel: 'whisper', name: 'Говорящий', colorKey: 'spk1' }
  ]
  return { speakers, turns }
}
