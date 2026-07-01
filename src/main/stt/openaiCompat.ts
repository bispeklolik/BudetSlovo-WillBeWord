import { spawnSync } from 'child_process'
import { readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { FFMPEG, STT_TEMP } from '../paths'
import type { MergeResult } from '../project/merge'
import type { SpeakerInfo, Turn } from '../../shared/types'

// OpenAI и Groq: один и тот же контракт (multipart /audio/transcriptions,
// verbose_json + word-таймкоды). Groq — тот же код, другой baseUrl+model.
// У Whisper НЕТ диаризации → один говорящий; реплики бьём по сегментам Whisper
// (естественные предложения), иначе была бы одна гигантская стена текста.

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

// verbose_json → нормализованный {speakers, turns}. Один говорящий, границы
// реплик — по сегментам Whisper (слово относим к сегменту по времени начала).
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

export async function transcribeOpenAICompat(
  audioPath: string,
  key: string,
  baseUrl: string,
  model: string
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
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` }, // Content-Type ставит fetch (boundary)
      body: form
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
