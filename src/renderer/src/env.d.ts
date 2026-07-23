/// <reference types="vite/client" />
import type {
  Settings,
  ProjectMeta,
  ImportProgress,
  JobInfo,
  TranscribeOptions,
  Turn,
  SpeakerInfo,
  Note,
  NoteInput,
  AnonRule
} from '../../shared/types'

export interface RendererApi {
  getSettings: () => Promise<Settings>
  setSettings: (patch: Partial<Settings>) => Promise<Settings>
  importAudio: () => Promise<ProjectMeta[] | null>
  getPathForFile: (file: File) => string
  importPath: (path: string) => Promise<ProjectMeta | null>
  renameProject: (slug: string, title: string) => Promise<ProjectMeta | null>
  setFolder: (slug: string, folder: string) => Promise<ProjectMeta | null>
  renameFolder: (oldPath: string, newPath: string) => Promise<boolean>
  listProjects: () => Promise<ProjectMeta[]>
  deleteProject: (slug: string) => Promise<boolean>
  openDataDir: () => Promise<string>
  getProject: (slug: string) => Promise<ProjectMeta | null>
  getPeaks: (slug: string) => Promise<Uint8Array | null>
  saveTranscript: (
    slug: string,
    turns: Turn[],
    speakers: SpeakerInfo[]
  ) => Promise<ProjectMeta | null>
  exportTranscript: (
    slug: string,
    format: 'docx' | 'md' | 'txt' | 'srt' | 'vtt',
    highlight: boolean,
    anon?: boolean
  ) => Promise<string | null>
  exportAudio: (slug: string) => Promise<string | null>
  exportTextDocx: (title: string, text: string) => Promise<string | null>
  listNotes: () => Promise<Note[]>
  saveNote: (input: NoteInput) => Promise<Note>
  deleteNote: (id: string) => Promise<void>
  aiAvailable: () => Promise<boolean>
  aiHasBackup: (slug: string) => Promise<boolean>
  cleanupAi: (slug: string) => Promise<ProjectMeta | null>
  revertAi: (slug: string) => Promise<ProjectMeta | null>
  summarizeAi: (
    slug: string,
    level: 'note' | 'medium' | 'detailed',
    domain: 'therapy' | 'business' | 'general'
  ) => Promise<string | null>
  runPromptAi: (slug: string, system: string) => Promise<string | null>
  transcribeClip: (data: ArrayBuffer) => Promise<string>
  sendDictAudio: (data: ArrayBuffer) => Promise<void>
  onDictRecord: (
    cb: (cmd: 'start' | 'stop' | 'cancel', opts?: { sounds?: boolean }) => void
  ) => () => void
  onDictState: (cb: (state: string) => void) => () => void
  highlightAi: (slug: string) => Promise<ProjectMeta | null>
  clearHighlightsAi: (slug: string) => Promise<ProjectMeta | null>
  anonymizeAi: (slug: string) => Promise<ProjectMeta | null>
  setAnonRules: (slug: string, rules: AnonRule[]) => Promise<ProjectMeta | null>
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
