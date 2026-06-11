/// <reference types="vite/client" />
import type {
  Settings,
  ProjectMeta,
  ImportProgress,
  JobInfo,
  TranscribeOptions
} from '../../shared/types'

export interface RendererApi {
  getSettings: () => Promise<Settings>
  setSettings: (patch: Partial<Settings>) => Promise<Settings>
  importAudio: () => Promise<ProjectMeta | null>
  listProjects: () => Promise<ProjectMeta[]>
  getProject: (slug: string) => Promise<ProjectMeta | null>
  getPeaks: (slug: string) => Promise<Uint8Array | null>
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
