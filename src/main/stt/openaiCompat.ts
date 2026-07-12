import { spawnSync } from 'child_process'
import { readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { FFMPEG, STT_TEMP } from '../paths'
import type { MergeResult } from '../project/merge'
import { openaiToTurns, type OaResponse } from '../../shared/sttMappers'
import { netSignal } from './net'

// OpenAI и Groq: один и тот же контракт (multipart /audio/transcriptions,
// verbose_json + word-таймкоды). Groq — тот же код, другой baseUrl+model.
// Маппер ответа — в shared/sttMappers.ts (общий с веб-версией).

export async function transcribeOpenAICompat(
  audioPath: string,
  key: string,
  baseUrl: string,
  model: string,
  signal?: AbortSignal
): Promise<MergeResult> {
  // ponytail: лимит 25 МБ на файл → перекодируем в моно 16 kbps m4a. Речь так
  // распознаётся без потерь, а многочасовая сессия влезает одним файлом.
  // Потолок ~3 ч; если понадобится длиннее — нарезка с офсетом таймкодов.
  const small = join(STT_TEMP, `oa-${Date.now()}.m4a`)
  const ff = spawnSync(FFMPEG, ['-y', '-i', audioPath, '-ac', '1', '-b:a', '16k', '-vn', small], {
    windowsHide: true
  })
  if (ff.status !== 0) throw new Error('Не удалось подготовить аудио для облака (ffmpeg).')
  try {
    const buf = readFileSync(small)
    const form = new FormData()
    form.append('file', new Blob([buf], { type: 'audio/m4a' }), 'audio.m4a')
    form.append('model', model)
    form.append('language', 'ru')
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')
    form.append('timestamp_granularities[]', 'segment') // сегменты = границы реплик
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` }, // Content-Type ставит fetch (boundary)
      body: form,
      signal: netSignal(600_000, signal)
    })
    if (res.status === 401) throw new Error('Неверный ключ API (проверьте в Настройках).')
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()) as OaResponse
    const result = openaiToTurns(data)
    if (result.turns.length === 0) throw new Error('Пустая расшифровка.')
    return result
  } finally {
    rmSync(small, { force: true })
  }
}
