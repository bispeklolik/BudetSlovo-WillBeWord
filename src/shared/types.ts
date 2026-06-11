export type Theme = 'light' | 'dark'

export interface Settings {
  theme: Theme
}

export const defaultSettings: Settings = { theme: 'light' }

export interface ProjectAudio {
  file: string
  originalPath: string
  durationSec: number
  repairedPrefixBytes: number
  peaks: { file: string; perSec: number }
}

export interface Word {
  id: number
  /** Секунды начала/конца и уверенность — отсутствуют у вставленных слов. */
  s?: number
  e?: number
  p?: number
  t: string
  /** Исходный текст движка, если слово правили. */
  t0?: string
}

export interface Turn {
  id: string
  spk: string
  startSec: number
  words: Word[]
}

export interface SpeakerInfo {
  id: string
  engineLabel: string
  name: string
  colorKey: string
}

export interface ProjectMeta {
  version: 1
  id: string
  slug: string
  title: string
  createdAt: string
  updatedAt: string
  audio: ProjectAudio
  transcription?: {
    numSpeakers: number
    enhance: boolean
  }
  engine?: {
    model: string
    completedAt: string
  }
  speakers?: SpeakerInfo[]
  turns?: Turn[]
}

export type ImportProgress =
  | { phase: 'repair'; message: string }
  | { phase: 'peaks'; message: string }
  | { phase: 'done'; message: string }

export interface TranscribeOptions {
  numSpeakers: number
  enhance: boolean
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'interrupted'

export interface JobInfo {
  id: string
  kind: 'transcribe'
  slug: string
  options?: TranscribeOptions
  status: JobStatus
  phase: string
  percent: number | null
  error?: string
  cancelRequested?: boolean
  createdAt: string
  startedAt?: string
  endedAt?: string
}
