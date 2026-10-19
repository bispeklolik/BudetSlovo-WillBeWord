import { contextBridge, ipcRenderer, webUtils } from 'electron'
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
  DictationEntry
} from '../shared/types'

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', patch),

  importAudio: (): Promise<ProjectMeta[] | null> => ipcRenderer.invoke('project:import'),
  // Путь к перетащенному файлу (в новых Electron — только через webUtils).
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  importPath: (path: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('project:importPath', path),
  renameProject: (slug: string, title: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('project:rename', slug, title),
  setFolder: (slug: string, folder: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('project:setFolder', slug, folder),
  renameFolder: (oldPath: string, newPath: string): Promise<boolean> =>
    ipcRenderer.invoke('project:renameFolder', oldPath, newPath),
  listProjects: (): Promise<ProjectMeta[]> => ipcRenderer.invoke('project:list'),
  deleteProject: (slug: string): Promise<boolean> => ipcRenderer.invoke('project:delete', slug),
  openDataDir: (): Promise<string> => ipcRenderer.invoke('app:openDataDir'),
  getProject: (slug: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('project:get', slug),
  getPeaks: (slug: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('project:peaks', slug),
  saveTranscript: (
    slug: string,
    turns: Turn[],
    speakers: SpeakerInfo[]
  ): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('project:saveTranscript', slug, turns, speakers),

  onImportProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const handler = (_e: unknown, p: ImportProgress): void => cb(p)
    ipcRenderer.on('import:progress', handler)
    return () => {
      ipcRenderer.off('import:progress', handler)
    }
  },

  exportTranscript: (
    slug: string,
    format: 'docx' | 'md' | 'txt' | 'srt' | 'vtt',
    highlight: boolean,
    anon?: boolean
  ): Promise<string | null> => ipcRenderer.invoke('export:run', slug, format, highlight, anon),
  exportAudio: (slug: string): Promise<string | null> =>
    ipcRenderer.invoke('export:audio', slug),
  exportTextDocx: (title: string, text: string): Promise<string | null> =>
    ipcRenderer.invoke('export:textDocx', title, text),

  listNotes: (): Promise<Note[]> => ipcRenderer.invoke('notes:list'),
  saveNote: (input: NoteInput): Promise<Note> => ipcRenderer.invoke('notes:save', input),
  deleteNote: (id: string): Promise<void> => ipcRenderer.invoke('notes:delete', id),

  aiAvailable: (): Promise<boolean> => ipcRenderer.invoke('ai:available'),
  aiHasBackup: (slug: string): Promise<boolean> => ipcRenderer.invoke('ai:hasBackup', slug),
  cleanupAi: (slug: string): Promise<ProjectMeta | null> => ipcRenderer.invoke('ai:cleanup', slug),
  revertAi: (slug: string): Promise<ProjectMeta | null> => ipcRenderer.invoke('ai:revert', slug),
  summarizeAi: (
    slug: string,
    level: 'note' | 'medium' | 'detailed',
    domain: 'therapy' | 'business' | 'general'
  ): Promise<string | null> => ipcRenderer.invoke('ai:summarize', slug, level, domain),
  runPromptAi: (slug: string, system: string): Promise<string | null> =>
    ipcRenderer.invoke('ai:runPrompt', slug, system),
  transcribeClip: (data: ArrayBuffer): Promise<string> => ipcRenderer.invoke('stt:clip', data),

  // Системная диктовка: main командует записью, renderer шлёт аудио обратно.
  sendDictAudio: (data: ArrayBuffer, meta?: { silent?: boolean; error?: string }): Promise<void> =>
    ipcRenderer.invoke('dict:audio', data, meta),
  dictHistory: (): Promise<DictationEntry[]> => ipcRenderer.invoke('dict:history'),
  retryDict: (audio: string): Promise<string> => ipcRenderer.invoke('dict:retry', audio),
  onDictRecord: (
    cb: (cmd: 'start' | 'stop' | 'cancel', opts?: { sounds?: boolean; tailMs?: number; micId?: string }) => void
  ): (() => void) => {
    const hs = (
      ['dict:record-start', 'dict:record-stop', 'dict:record-cancel'] as const
    ).map((ch) => {
      const cmd = ch.split('-')[1] as 'start' | 'stop' | 'cancel'
      const h = (_e: unknown, opts?: { sounds?: boolean; tailMs?: number; micId?: string }): void => cb(cmd, opts)
      ipcRenderer.on(ch, h)
      return [ch, h] as const
    })
    return () => hs.forEach(([ch, h]) => ipcRenderer.off(ch, h))
  },
  onDictState: (cb: (state: string) => void): (() => void) => {
    const h = (_e: unknown, s: string): void => cb(s)
    ipcRenderer.on('dict:state', h)
    return () => ipcRenderer.off('dict:state', h)
  },
  highlightAi: (slug: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('ai:highlights', slug),
  clearHighlightsAi: (slug: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('ai:clearHighlights', slug),
  anonymizeAi: (slug: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('ai:anonymize', slug),
  setAnonRules: (slug: string, rules: AnonRule[]): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('ai:setAnon', slug, rules),
  onAiProgress: (cb: (p: { done: number; total: number; phase: string }) => void): (() => void) => {
    const handler = (_e: unknown, p: { done: number; total: number; phase: string }): void => cb(p)
    ipcRenderer.on('ai:progress', handler)
    return () => {
      ipcRenderer.off('ai:progress', handler)
    }
  },

  startTranscribe: (slug: string, opts: TranscribeOptions): Promise<JobInfo> =>
    ipcRenderer.invoke('job:start', slug, opts),
  cancelJob: (id: string): Promise<JobInfo | null> => ipcRenderer.invoke('job:cancel', id),
  listJobs: (): Promise<JobInfo[]> => ipcRenderer.invoke('job:list'),
  onJobUpdate: (cb: (j: JobInfo) => void): (() => void) => {
    const handler = (_e: unknown, j: JobInfo): void => cb(j)
    ipcRenderer.on('job:update', handler)
    return () => {
      ipcRenderer.off('job:update', handler)
    }
  },

  // Первый запуск («три двери»), локальный движок, бэкап.
  setupInfo: (): Promise<SetupInfo> => ipcRenderer.invoke('setup:info'),
  startSetup: (modelId: string): Promise<void> => ipcRenderer.invoke('setup:start', modelId),
  stopSetup: (): Promise<void> => ipcRenderer.invoke('setup:stop'),
  onSetupProgress: (cb: (p: SetupProgress) => void): (() => void) => {
    const h = (_e: unknown, p: SetupProgress): void => cb(p)
    ipcRenderer.on('setup:progress', h)
    return () => ipcRenderer.off('setup:progress', h)
  },
  ollamaStatus: (): Promise<OllamaStatus> => ipcRenderer.invoke('setup:ollama'),
  pullOllama: (name: string): Promise<void> => ipcRenderer.invoke('setup:pullOllama', name),
  stopOllamaPull: (): Promise<void> => ipcRenderer.invoke('setup:stopOllama'),
  onOllamaProgress: (cb: (p: { status: string; done: number; total: number }) => void): (() => void) => {
    const h = (_e: unknown, p: { status: string; done: number; total: number }): void => cb(p)
    ipcRenderer.on('setup:ollamaProgress', h)
    return () => ipcRenderer.off('setup:ollamaProgress', h)
  },
  checkKey: (service: string, key: string): Promise<KeyVerdict> =>
    ipcRenderer.invoke('setup:checkKey', service, key),
  createDemo: (): Promise<ProjectMeta> => ipcRenderer.invoke('setup:demo'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  createBackup: (): Promise<{ path: string; items: number; bytes: number } | null> =>
    ipcRenderer.invoke('backup:create'),
  restoreBackup: (): Promise<{ restored: string[]; savedTo: string } | null> =>
    ipcRenderer.invoke('backup:restore')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
