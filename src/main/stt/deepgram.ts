import { readFileSync } from 'fs'
import type { MergeResult } from '../project/merge'
import { deepgramToTurns, type DgResponse } from '../../shared/sttMappers'
import { netSignal } from './net'
import { cleanWords } from '../../shared/vocab'

// Расшифровка через Deepgram (облако). Ключ хранится локально в настройках.
// Аудио уходит на серверы Deepgram — в отличие от локального Whisper.
// Маппер ответа — в shared/sttMappers.ts (общий с веб-версией).

const DG_URL = 'https://api.deepgram.com/v1/listen'

export async function transcribeWithDeepgram(
  audioPath: string,
  key: string,
  signal?: AbortSignal,
  opts?: { verbatim?: boolean; terms?: string[]; speakers?: number }
): Promise<MergeResult> {
  const body = readFileSync(audioPath)
  // ponytail: синхронный endpoint — тянет и многочасовые pre-recorded в одном
  // запросе. Если файлы станут огромными / запрос будет отваливаться по таймауту
  // — перейти на async callback API.
  const params = new URLSearchParams({
    model: 'nova-2',
    language: 'ru',
    // diarize=true устарел и ведёт на старый разделитель v1; diarize_model=v2 —
    // новый (документация Deepgram «Diarization», совместим с Nova-2; оба
    // параметра сразу Deepgram отклоняет). Числа говорящих Deepgram не принимает.
    diarize_model: 'v2',
    punctuate: 'true',
    smart_format: 'true'
  })
  // filler_words официально только для английского — для русского «как получится».
  if (opts?.verbatim) params.set('filler_words', 'true')
  // Словарь: nova-2 понимает keywords (термины и имена пишет как в словаре).
  for (const t of cleanWords(opts?.terms).slice(0, 100)) params.append('keywords', t)
  const res = await fetch(`${DG_URL}?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/mp4' },
    body,
    signal: netSignal(600_000, signal)
  })
  if (res.status === 401) throw new Error('Deepgram: неверный ключ API (проверьте в Настройках).')
  if (!res.ok) throw new Error(`Deepgram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const dg = (await res.json()) as DgResponse
  const result = deepgramToTurns(dg)
  if (result.turns.length === 0) throw new Error('Deepgram вернул пустую расшифровку.')
  return result
}
