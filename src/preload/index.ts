import { contextBridge, ipcRenderer } from 'electron'
import type { Settings } from '../shared/types'

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', patch)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
