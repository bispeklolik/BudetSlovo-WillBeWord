import { readFileSync } from 'fs'
import { buildTurns, type FlatWord, type MergeResult } from '../project/merge'

// ElevenLabs Scribe: multipart, модель scribe_v2 (v1 снимают с обслуживания),
// язык 'rus' (ISO-639-3!), диаризация diarize=true. words[] содержит и слова, и
// пробелы, и аудио-события — берём только type==='word'. Таймкоды в секундах.

interface ElWord {
  text: string
  start: number
  end: number
  type?: string
  speaker_id?: string | null
}
interface ElResponse {
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

export async function transcribeWithElevenLabs(audioPath: string, key: string): Promise<MergeResult> {
  const form = new FormData()
  form.append('file', new Blob([readFileSync(audioPath)], { type: 'audio/mp4' }), 'audio.m4a')
  form.append('model_id', 'scribe_v2')
  form.append('diarize', 'true')
  form.append('language_code', 'rus')
  form.append('timestamps_granularity', 'word')
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key }, // Content-Type ставит fetch (boundary)
    body: form
  })
  if (res.status === 401) throw new Error('ElevenLabs: неверный ключ API (проверьте в Настройках).')
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as ElResponse
  const result = elevenToTurns(data)
  if (result.turns.length === 0) throw new Error('ElevenLabs вернул пустую расшифровку.')
  return result
}
