import type { MergeResult } from '../project/merge'
import type { JobInfo } from '../../shared/types'
import { transcribeWithDeepgram } from './deepgram'
import { transcribeWithAssemblyAI } from './assemblyai'
import { transcribeWithElevenLabs } from './elevenlabs'
import { transcribeOpenAICompat } from './openaiCompat'

export type Emit = (patch: Partial<JobInfo>) => void
/** verbatim — «Дословно»: просим сервис не вычищать «э-э»/«ну» (для русского — как получится). */
export interface CloudOpts {
  verbatim?: boolean
}
type RunFn = (
  audioPath: string,
  key: string,
  emit: Emit,
  signal?: AbortSignal,
  opts?: CloudOpts
) => Promise<MergeResult>

// Облачные движки по id (метаданные — в shared/sttEngines.ts). OpenAI и Groq —
// один и тот же код, разный baseUrl+model.
export const CLOUD_RUN: Record<string, RunFn> = {
  deepgram: (a, k, _e, s, o) => transcribeWithDeepgram(a, k, s, o),
  assemblyai: (a, k, e, s, o) => transcribeWithAssemblyAI(a, k, e, s, o),
  elevenlabs: (a, k, _e, s) => transcribeWithElevenLabs(a, k, s), // Scribe и так пишет близко к дословному
  openai: (a, k, _e, s, o) => transcribeOpenAICompat(a, k, 'https://api.openai.com/v1', 'whisper-1', s, o),
  groq: (a, k, _e, s, o) =>
    transcribeOpenAICompat(a, k, 'https://api.groq.com/openai/v1', 'whisper-large-v3-turbo', s, o)
}
