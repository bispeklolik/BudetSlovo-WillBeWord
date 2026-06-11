import { contextBridge, ipcRenderer } from 'electron'
import type { Settings, ProjectMeta, ImportProgress } from '../shared/types'

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
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
