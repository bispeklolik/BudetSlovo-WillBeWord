import { buildTurns, type FlatWord, type MergeResult } from './turns'

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
