import { readFileSync } from 'fs'
import { buildTurns, type FlatWord, type MergeResult } from '../project/merge'

// Расшифровка через Deepgram (облако). Ключ хранится локально в настройках.
// Аудио уходит на серверы Deepgram — в отличие от локального Whisper.

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

// Ответ Deepgram → нормализованный {speakers, turns} (тот же формат, что merge).
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

const DG_URL = 'https://api.deepgram.com/v1/listen'

export async function transcribeWithDeepgram(
  audioPath: string,
  key: string,
  signal?: AbortSignal
): Promise<MergeResult> {
  const body = readFileSync(audioPath)
  // ponytail: синхронный endpoint — тянет и многочасовые pre-recorded в одном
  // запросе. Если файлы станут огромными / запрос будет отваливаться по таймауту
  // — перейти на async callback API.
  const params = new URLSearchParams({
    model: 'nova-2',
    language: 'ru',
    diarize: 'true',
    punctuate: 'true',
    smart_format: 'true'
  })
  const res = await fetch(`${DG_URL}?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/mp4' },
    body,
    signal
  })
  if (res.status === 401) throw new Error('Deepgram: неверный ключ API (проверьте в Настройках).')
  if (!res.ok) throw new Error(`Deepgram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const dg = (await res.json()) as DgResponse
  const result = deepgramToTurns(dg)
  if (result.turns.length === 0) throw new Error('Deepgram вернул пустую расшифровку.')
  return result
}
