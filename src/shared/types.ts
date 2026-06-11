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

export interface ProjectMeta {
  version: 1
  id: string
  slug: string
  title: string
  createdAt: string
  updatedAt: string
  audio: ProjectAudio
}

export type ImportProgress =
  | { phase: 'repair'; message: string }
  | { phase: 'peaks'; message: string }
  | { phase: 'done'; message: string }
