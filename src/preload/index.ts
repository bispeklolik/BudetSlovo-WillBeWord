import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Settings,
  ProjectMeta,
  ImportProgress,
  JobInfo,
  TranscribeOptions,
  Turn,
  SpeakerInfo
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
    format: 'docx' | 'md' | 'txt',
    highlight: boolean
  ): Promise<string | null> => ipcRenderer.invoke('export:run', slug, format, highlight),
  exportAudio: (slug: string): Promise<string | null> =>
    ipcRenderer.invoke('export:audio', slug),

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
