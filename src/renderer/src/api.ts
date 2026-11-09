import type { Settings, ProjectMeta, Note, DictationEntry } from '../../shared/types'
import { defaultSettings } from '../../shared/types'
import { DEMO_SLUG, DEMO_TITLE, DEMO_SPEAKERS, DEMO_RESULTS, demoTurns } from '../../shared/demo'
import type { RendererApi } from './env'

// В Electron window.api приходит из preload. В обычном браузере (превью UI)
// работаем на заглушке, чтобы интерфейс можно было открыть без Electron.
let memory: Settings = { ...defaultSettings }

// Пример записи и журнал диктовок живут в памяти вкладки: так гайд можно пройти и в
// браузере. window.__slovoStub.logDictation() имитирует новую диктовку.
let demoMeta: ProjectMeta | null = null
let demoNotes: Note[] = []
let dictLog: DictationEntry[] = []
const dictListeners = new Set<() => void>()
if (!window.api) {
  // ?stub=existing — как у человека, который уже пользуется: мастер пройден, одна диктовка в журнале.
  if (location.search.includes('stub=existing')) {
    memory = { ...memory, onboarded: true }
    dictLog = [{ at: new Date().toISOString(), raw: 'Старая диктовка', polished: null, text: 'Старая диктовка' }]
  }
  ;(window as unknown as { __slovoStub: unknown }).__slovoStub = {
    logDictation: (text = 'Проверка диктовки'): void => {
      dictLog = [{ at: new Date().toISOString(), raw: text, polished: null, text }, ...dictLog]
      dictListeners.forEach((f) => f())
    }
  }
}

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
  listProjects: async () => (demoMeta ? [demoMeta] : []),
  deleteProject: async () => false,
  openDataDir: async () => '',
  getProject: async (slug) => (demoMeta && slug === DEMO_SLUG ? demoMeta : null),
  getPeaks: async () => null,
  saveTranscript: async () => null,
  exportTranscript: async () => null,
  exportAudio: async () => null,
  exportTextDocx: async () => null,
  listNotes: async () => demoNotes,
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
  sendDictChunk: () => {},
  onDictLive: () => () => {},
  dictHistory: async () => dictLog,
  dictHistoryPage: async () => ({ items: dictLog, hasMore: false }),
  dictClip: async () => null,
  onDictLogged: (cb) => {
    dictListeners.add(cb)
    return () => void dictListeners.delete(cb)
  },
  dictStats: async () => ({ wordsWeek: 0, streak: 0, total: dictLog.length, wpm: null }),
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
    if (demoMeta) return demoMeta
    const { turns, durationSec } = demoTurns()
    const now = new Date().toISOString()
    demoMeta = {
      version: 1,
      id: 'demo-stub',
      slug: DEMO_SLUG,
      title: DEMO_TITLE,
      createdAt: now,
      updatedAt: now,
      audio: { file: 'audio.m4a', originalPath: '', durationSec, repairedPrefixBytes: 0, peaks: { file: 'peaks.bin', perSec: 50 } },
      transcription: { numSpeakers: 2, enhance: false },
      engine: { model: 'demo', completedAt: now },
      speakers: DEMO_SPEAKERS,
      turns,
      demo: true
    }
    demoNotes = DEMO_RESULTS.map((r, i) => ({
      id: 'demo-note-' + i,
      title: r.title,
      body: r.body,
      kind: 'summary' as const,
      sourceSlug: DEMO_SLUG,
      sourceTitle: DEMO_TITLE,
      createdAt: now,
      updatedAt: now
    }))
    return demoMeta
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
