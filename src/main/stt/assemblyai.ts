import { readFileSync } from 'fs'
import { buildTurns, type FlatWord, type MergeResult } from '../project/merge'
import type { JobInfo } from '../../shared/types'
import { netSignal } from './net'

// AssemblyAI: асинхронно (upload → create → poll). Диаризация (speaker_labels),
// русский (language_code 'ru'), модель 'best'. Таймкоды приходят в МИЛЛИСЕКУНДАХ.

interface AaWord {
  text: string
  start: number
  end: number
  confidence?: number
  speaker?: string | null
}
interface AaTranscript {
  status?: string
  error?: string
  words?: AaWord[]
}

export function assemblyToTurns(t: AaTranscript): MergeResult {
  const flat: FlatWord[] = (t.words ?? [])
    .filter((w) => (w.text ?? '').trim() !== '')
    .map((w) => ({
      s: w.start / 1000,
      e: w.end / 1000,
      p: w.confidence ?? 1,
      t: w.text.trim(),
      label: w.speaker ?? 'A'
    }))
  return buildTurns(flat)
}

const BASE = 'https://api.assemblyai.com/v2'

export async function transcribeWithAssemblyAI(
  audioPath: string,
  key: string,
  emit: (p: Partial<JobInfo>) => void,
  signal?: AbortSignal
): Promise<MergeResult> {
  const auth = { authorization: key }

  // 1. Загрузка файла (сырые байты, не multipart).
  const up = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/octet-stream' },
    body: readFileSync(audioPath),
    signal: netSignal(600_000, signal)
  })
  if (up.status === 401) throw new Error('AssemblyAI: неверный ключ API (проверьте в Настройках).')
  if (!up.ok) throw new Error(`AssemblyAI upload HTTP ${up.status}`)
  const { upload_url } = (await up.json()) as { upload_url: string }

  // 2. Постановка на распознавание.
  const cr = await fetch(`${BASE}/transcript`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: 'ru',
      speaker_labels: true,
      speech_model: 'best'
    }),
    signal: netSignal(60_000, signal)
  })
  if (!cr.ok) throw new Error(`AssemblyAI create HTTP ${cr.status}: ${(await cr.text()).slice(0, 200)}`)
  const { id } = (await cr.json()) as { id: string }

  // 3. Опрос до готовности. ponytail: облачную задачу нельзя прервать на середине,
  // потолок ~20 мин (400×3с) — на реальные сессии хватает с запасом.
  emit({ phase: 'Расшифровка в AssemblyAI', percent: null })
  for (let i = 0; i < 400; i++) {
    if (signal?.aborted) throw new Error('Задача отменена.')
    await new Promise((r) => setTimeout(r, 3000))
    const pr = await fetch(`${BASE}/transcript/${id}`, {
      headers: auth,
      signal: netSignal(30_000, signal)
    })
    if (!pr.ok) throw new Error(`AssemblyAI poll HTTP ${pr.status}`)
    const t = (await pr.json()) as AaTranscript
    if (t.status === 'completed') {
      const result = assemblyToTurns(t)
      if (result.turns.length === 0) throw new Error('AssemblyAI вернул пустую расшифровку.')
      return result
    }
    if (t.status === 'error') throw new Error('AssemblyAI: ' + (t.error ?? 'ошибка распознавания'))
  }
  throw new Error('AssemblyAI: превышено время ожидания результата.')
}
