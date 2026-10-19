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
  AnonRule,
  SetupInfo,
  SetupProgress,
  OllamaStatus,
  KeyVerdict,
  DictationEntry,
  AskAnswer,
  AskTurn
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
  sendDictAudio: (data: ArrayBuffer, meta?: { silent?: boolean; error?: string }) => Promise<void>
  dictHistory: () => Promise<DictationEntry[]>
  retryDict: (audio: string) => Promise<string>
  onDictRecord: (
    cb: (cmd: 'start' | 'stop' | 'cancel', opts?: { sounds?: boolean; tailMs?: number; micId?: string }) => void
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
  setupInfo: () => Promise<SetupInfo>
  startSetup: (modelId: string) => Promise<void>
  stopSetup: () => Promise<void>
  onSetupProgress: (cb: (p: SetupProgress) => void) => () => void
  ollamaStatus: () => Promise<OllamaStatus>
  pullOllama: (name: string) => Promise<void>
  stopOllamaPull: () => Promise<void>
  onOllamaProgress: (cb: (p: { status: string; done: number; total: number }) => void) => () => void
  checkKey: (service: string, key: string) => Promise<KeyVerdict>
  createDemo: () => Promise<ProjectMeta>
  openExternal: (url: string) => Promise<void>
  createBackup: () => Promise<{ path: string; items: number; bytes: number } | null>
  restoreBackup: () => Promise<{ restored: string[]; savedTo: string } | null>
  mcpConfig: () => Promise<{ ok: boolean; json: string; configDir: string }>
  openClaudeConfigDir: () => Promise<boolean>
  setMyNotes: (slug: string, text: string) => Promise<void>
  enhanceNotes: (slug: string) => Promise<Note>
  askRecording: (slug: string, question: string, history: AskTurn[], thorough?: boolean) => Promise<AskAnswer>
  askAll: (question: string, folder: string | null, history: AskTurn[], thorough?: boolean) => Promise<AskAnswer>
  clientDynamics: (folder: string) => Promise<Note>
  callMissed: (id: string, minutes: number) => Promise<string>
  callNotes: (id: string, text: string) => void
  callOpen: (id: string) => Promise<void>
  callChunk: (id: string, kind: 'mic' | 'sys', data: ArrayBuffer) => void
  callFinish: (
    id: string,
    opts: { title: string; names: [string, string]; app?: string; myNotes?: string }
  ) => Promise<ProjectMeta>
  callCancel: (id: string) => Promise<void>
  callMute: (appId: string) => Promise<void>
  callUnmute: (appId: string) => Promise<void>
  callSnooze: () => Promise<void>
  onCallPrompt: (cb: (p: { appId: string; name: string; open?: boolean }) => void) => () => void
  onCallWriteError: (cb: (message: string) => void) => () => void
  onCallPromptGone: (cb: () => void) => () => void
  onCallRecovered: (cb: (count: number) => void) => () => void
}

declare global {
  interface Window {
    api?: RendererApi
  }
}

export {}
