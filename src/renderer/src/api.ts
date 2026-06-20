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
  getPathForFile: () => '',
  importPath: async () => null,
  renameProject: async () => null,
  setFolder: async () => null,
  renameFolder: async () => false,
  listProjects: async () => [],
  getProject: async () => null,
  getPeaks: async () => null,
  saveTranscript: async () => null,
  exportTranscript: async () => null,
  exportAudio: async () => null,
  exportTextDocx: async () => null,
  listNotes: async () => [],
  saveNote: async () => {
    throw new Error('Конспекты доступны только в приложении (Electron)')
  },
  deleteNote: async () => {},
  aiAvailable: async () => false,
  aiHasBackup: async () => false,
  cleanupAi: async () => null,
  revertAi: async () => null,
  summarizeAi: async () => null,
  highlightAi: async () => null,
  clearHighlightsAi: async () => null,
  onAiProgress: () => () => {},
  onImportProgress: () => () => {},
  startTranscribe: async () => {
    throw new Error('Расшифровка доступна только в приложении (Electron)')
  },
  cancelJob: async () => null,
  listJobs: async () => [],
  onJobUpdate: () => () => {}
}

export const api: RendererApi = window.api ?? stub
