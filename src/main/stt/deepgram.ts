import { readFileSync } from 'fs'
import type { MergeResult } from '../project/merge'
import { deepgramToTurns, type DgResponse } from '../../shared/sttMappers'

// Расшифровка через Deepgram (облако). Ключ хранится локально в настройках.
// Аудио уходит на серверы Deepgram — в отличие от локального Whisper.
// Маппер ответа — в shared/sttMappers.ts (общий с веб-версией).

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
