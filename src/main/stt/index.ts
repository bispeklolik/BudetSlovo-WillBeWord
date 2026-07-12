import type { MergeResult } from '../project/merge'
import type { JobInfo } from '../../shared/types'
import { transcribeWithDeepgram } from './deepgram'
import { transcribeWithAssemblyAI } from './assemblyai'
import { transcribeWithElevenLabs } from './elevenlabs'
import { transcribeOpenAICompat } from './openaiCompat'

export type Emit = (patch: Partial<JobInfo>) => void
type RunFn = (
  audioPath: string,
  key: string,
  emit: Emit,
  signal?: AbortSignal
) => Promise<MergeResult>

// Облачные движки по id (метаданные — в shared/sttEngines.ts). OpenAI и Groq —
// один и тот же код, разный baseUrl+model.
export const CLOUD_RUN: Record<string, RunFn> = {
  deepgram: (a, k, _e, s) => transcribeWithDeepgram(a, k, s),
  assemblyai: (a, k, e, s) => transcribeWithAssemblyAI(a, k, e, s),
  elevenlabs: (a, k, _e, s) => transcribeWithElevenLabs(a, k, s),
  openai: (a, k, _e, s) => transcribeOpenAICompat(a, k, 'https://api.openai.com/v1', 'whisper-1', s),
  groq: (a, k, _e, s) =>
    transcribeOpenAICompat(a, k, 'https://api.groq.com/openai/v1', 'whisper-large-v3-turbo', s)
}
