import type { Settings } from '../../shared/types'
import { defaultSettings } from '../../shared/types'
import type { RendererApi } from './env'

// В Electron window.api приходит из preload. В обычном браузере (превью UI)
// работаем на заглушке, чтобы интерфейс можно было открыть без Electron.
let memory: Settings = { ...defaultSettings }

const stub: RendererApi = {
  getSettings: async () => memory,
  setSettings: async (patch) => {
    memory = { ...memory, ...patch }
    return memory
  },
  importAudio: async () => {
    alert('Импорт доступен только в приложении (Electron)')
    return null
  },
  listProjects: async () => [],
  getProject: async () => null,
  getPeaks: async () => null,
  saveTranscript: async () => null,
  exportTranscript: async () => null,
  onImportProgress: () => () => {},
  startTranscribe: async () => {
    throw new Error('Расшифровка доступна только в приложении (Electron)')
  },
  cancelJob: async () => null,
  listJobs: async () => [],
  onJobUpdate: () => () => {}
}

export const api: RendererApi = window.api ?? stub
