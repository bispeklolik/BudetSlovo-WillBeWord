import { readFileSync } from 'fs'
import type { MergeResult } from '../project/merge'
import { elevenToTurns, type ElResponse } from '../../shared/sttMappers'

// ElevenLabs Scribe: multipart, модель scribe_v2 (v1 снимают с обслуживания),
// язык 'rus' (ISO-639-3!), диаризация diarize=true. Таймкоды в секундах.
// Маппер ответа — в shared/sttMappers.ts (общий с веб-версией).

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
