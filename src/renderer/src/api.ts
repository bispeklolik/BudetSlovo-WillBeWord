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
  deleteProject: async () => false,
  openDataDir: async () => '',
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
  runPromptAi: async () => null,
  transcribeClip: async () => {
    throw new Error('Голосовая правка доступна только в приложении (Electron)')
  },
  sendDictAudio: async () => {},
  dictHistory: async () => [],
  retryDict: async () => {
    throw new Error('Доступно только в приложении (Electron)')
  },
  onDictRecord: () => () => {},
  onDictState: () => () => {},
  highlightAi: async () => null,
  clearHighlightsAi: async () => null,
  anonymizeAi: async () => null,
  setAnonRules: async () => null,
  onAiProgress: () => () => {},
  onImportProgress: () => () => {},
  startTranscribe: async () => {
    throw new Error('Расшифровка доступна только в приложении (Electron)')
  },
  cancelJob: async () => null,
  listJobs: async () => [],
  onJobUpdate: () => () => {},
  setupInfo: async () => ({
    dataDir: '',
    engine: { installed: false, source: 'default', dir: '', modelsDir: '' },
    installedModels: [],
    localModel: 'large-v3',
    gpu: null,
    freeBytes: null,
    pending: null,
    progress: null
  }),
  startSetup: async () => {},
  stopSetup: async () => {},
  onSetupProgress: () => () => {},
  ollamaStatus: async () => ({ installed: false, running: false, models: [] }),
  pullOllama: async () => {},
  stopOllamaPull: async () => {},
  onOllamaProgress: () => () => {},
  checkKey: async () => ({ ok: false, message: 'Проверка доступна только в приложении' }),
  createDemo: async () => {
    throw new Error('Пример доступен только в приложении (Electron)')
  },
  openExternal: async () => {},
  createBackup: async () => null,
  restoreBackup: async () => null,
  phoneStart: async () => {
    throw new Error('Доступно только в приложении (Electron)')
  },
  phoneStop: async () => {},
  onPhoneReceived: () => () => {},
  watchPick: async () => null,
  watchSet: async () => {},
  linkStatus: async () => ({ ytDlp: false }),
  linkInstall: async () => {
    throw new Error('Доступно только в приложении (Electron)')
  },
  linkImport: async () => {
    throw new Error('Доступно только в приложении (Electron)')
  },
  linkCancel: async () => {},
  onLinkProgress: () => () => {},
  onProjectsChanged: () => () => {},
  onAppNotice: () => () => {},
  mcpConfig: async () => ({ ok: false, json: '', configDir: '' }),
  openClaudeConfigDir: async () => false,
  setMyNotes: async () => {},
  enhanceNotes: async () => {
    throw new Error('Доступно только в приложении (Electron)')
  },
  askRecording: async () => {
    throw new Error('Доступно только в приложении (Electron)')
  },
  askAll: async () => {
    throw new Error('Доступно только в приложении (Electron)')
  },
  clientDynamics: async () => {
    throw new Error('Доступно только в приложении (Electron)')
  },
  callMissed: async () => {
    throw new Error('Доступно только в приложении (Electron)')
  },
  callNotes: () => {},
  callOpen: async () => {
    throw new Error('Запись звонка доступна только в приложении (Electron)')
  },
  callChunk: () => {},
  callFinish: async () => {
    throw new Error('Запись звонка доступна только в приложении (Electron)')
  },
  callCancel: async () => {},
  callMute: async () => {},
  callUnmute: async () => {},
  callSnooze: async () => {},
  onCallPrompt: () => () => {},
  onCallWriteError: () => () => {},
  onCallPromptGone: () => () => {},
  onCallRecovered: () => () => {}
}

export const api: RendererApi = window.api ?? stub
