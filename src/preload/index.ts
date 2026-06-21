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
  AnonRule
} from '../shared/types'

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', patch),

  importAudio: (): Promise<ProjectMeta | null> => ipcRenderer.invoke('project:import'),
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
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
