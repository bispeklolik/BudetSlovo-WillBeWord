import { contextBridge, ipcRenderer } from 'electron'
import type {
  Settings,
  ProjectMeta,
  ImportProgress,
  JobInfo,
  TranscribeOptions
} from '../shared/types'

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', patch),

  importAudio: (): Promise<ProjectMeta | null> => ipcRenderer.invoke('project:import'),
  listProjects: (): Promise<ProjectMeta[]> => ipcRenderer.invoke('project:list'),
  getProject: (slug: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('project:get', slug),
  getPeaks: (slug: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('project:peaks', slug),

  onImportProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const handler = (_e: unknown, p: ImportProgress): void => cb(p)
    ipcRenderer.on('import:progress', handler)
    return () => {
      ipcRenderer.off('import:progress', handler)
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
