/// <reference types="vite/client" />
import type {
  Settings,
  ProjectMeta,
  ImportProgress,
  JobInfo,
  TranscribeOptions,
  Turn,
  SpeakerInfo
} from '../../shared/types'

export interface RendererApi {
  getSettings: () => Promise<Settings>
  setSettings: (patch: Partial<Settings>) => Promise<Settings>
  importAudio: () => Promise<ProjectMeta | null>
  getPathForFile: (file: File) => string
  importPath: (path: string) => Promise<ProjectMeta | null>
  renameProject: (slug: string, title: string) => Promise<ProjectMeta | null>
  listProjects: () => Promise<ProjectMeta[]>
  getProject: (slug: string) => Promise<ProjectMeta | null>
  getPeaks: (slug: string) => Promise<Uint8Array | null>
  saveTranscript: (
    slug: string,
    turns: Turn[],
    speakers: SpeakerInfo[]
  ) => Promise<ProjectMeta | null>
  exportTranscript: (
    slug: string,
    format: 'docx' | 'md' | 'txt',
    highlight: boolean
  ) => Promise<string | null>
  exportAudio: (slug: string) => Promise<string | null>
  aiAvailable: () => Promise<boolean>
  aiHasBackup: (slug: string) => Promise<boolean>
  cleanupAi: (slug: string) => Promise<ProjectMeta | null>
  revertAi: (slug: string) => Promise<ProjectMeta | null>
  summarizeAi: (
    slug: string,
    level: 'note' | 'medium' | 'detailed',
    domain: 'therapy' | 'business' | 'general'
  ) => Promise<string | null>
  highlightAi: (slug: string) => Promise<ProjectMeta | null>
  clearHighlightsAi: (slug: string) => Promise<ProjectMeta | null>
  onAiProgress: (cb: (p: { done: number; total: number; phase: string }) => void) => () => void
  onImportProgress: (cb: (p: ImportProgress) => void) => () => void
  startTranscribe: (slug: string, opts: TranscribeOptions) => Promise<JobInfo>
  cancelJob: (id: string) => Promise<JobInfo | null>
  listJobs: () => Promise<JobInfo[]>
  onJobUpdate: (cb: (j: JobInfo) => void) => () => void
}

declare global {
  interface Window {
    api?: RendererApi
  }
}

export {}
