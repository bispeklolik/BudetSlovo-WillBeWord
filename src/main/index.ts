import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { existsSync, copyFileSync } from 'fs'
import { autoUpdater } from 'electron-updater'
import { DATA_DIR, loadSettings, saveSettings } from './settings'
import { registerMediaScheme, installMediaProtocol } from './protocol'
import {
  createProjectFromFile,
  listProjects,
  getProject,
  saveProject,
  saveTranscript,
  readPeaks,
  projectDir
} from './project/store'
import { mergeEngineOutputs } from './project/merge'
import { exportTranscript, type ExportFormat } from './export'
import { registerProvider, getProvider, type SummaryLevel, type SummaryDomain } from './ai/provider'
import { localLlamaProvider } from './ai/localLlama'
import { runCleanup, revertCleanup, hasAiBackup } from './ai/cleanupJob'
import { stopOllama, ensureOllama } from './ai/ollamaServer'
import {
  initQueue,
  setJobNotifier,
  enqueueTranscribe,
  cancelJob,
  listJobs
} from './jobs/queue'
import type { Settings, TranscribeOptions, Turn, SpeakerInfo } from '../shared/types'

// Все данные Chromium-профиля строго на D: — C: почти полон.
app.setPath('userData', join(DATA_DIR, 'electron'))
registerMediaScheme()
registerProvider(localLlamaProvider)
app.on('before-quit', () => stopOllama())

let win: BrowserWindow | null = null
let settings: Settings = loadSettings()

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Слово',
    backgroundColor: settings.theme === 'dark' ? '#17171C' : '#FAF9F5',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })
  win.on('page-title-updated', (e) => e.preventDefault())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---------- настройки ----------
ipcMain.handle('settings:get', () => settings)
ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
  settings = { ...settings, ...patch }
  saveSettings(settings)
  return settings
})

// ---------- проекты ----------
function sendImportProgress(phase: string, message: string): void {
  win?.webContents.send('import:progress', { phase, message })
}

async function importFromPath(src: string) {
  return createProjectFromFile(src, (phase) => {
    const messages: Record<string, string> = {
      repair: 'Проверяю и готовлю файл…',
      extract: 'Извлекаю звук из видео…',
      peaks: 'Строю звуковую волну…',
      done: 'Готово'
    }
    sendImportProgress(phase, messages[phase] ?? phase)
  })
}

ipcMain.handle('project:import', async () => {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, {
    title: 'Выберите аудио- или видеозапись',
    properties: ['openFile'],
    filters: [
      {
        name: 'Аудио и видео',
        extensions: [
          // аудио
          'm4a', 'mp3', 'wav', 'aac', 'ogg', 'oga', 'flac', 'opus', 'wma',
          // видео
          'mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mpg', 'mpeg', 'mts', 'm2ts', 'ts', '3gp', 'ogv'
        ]
      },
      { name: 'Все файлы', extensions: ['*'] }
    ]
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return importFromPath(res.filePaths[0])
})

// Импорт по пути (перетаскивание файла в окно) — без диалога.
ipcMain.handle('project:importPath', (_e, path: string) => importFromPath(path))

ipcMain.handle('project:list', () => listProjects())
ipcMain.handle('project:get', (_e, slug: string) => {
  const meta = getProject(slug)
  // Ленивый merge: результат движка на диске есть, а слитого транскрипта нет.
  // Срабатывает и когда задача не финализировалась (краш движка на teardown
  // уже после записи файлов) — результат не теряется.
  if (meta && !meta.turns && existsSync(join(projectDir(slug), 'engine', 'audio.json'))) {
    try {
      const merged = mergeEngineOutputs(slug)
      meta.speakers = merged.speakers
      meta.turns = merged.turns
      if (!meta.engine) {
        meta.engine = { model: 'large-v3', completedAt: new Date().toISOString() }
      }
      saveProject(meta)
    } catch {
      // файлы движка неполные — отдадим как есть
    }
  }
  return meta
})
ipcMain.handle('project:peaks', (_e, slug: string) => readPeaks(slug))
ipcMain.handle(
  'project:saveTranscript',
  (_e, slug: string, turns: Turn[], speakers: SpeakerInfo[]) =>
    saveTranscript(slug, turns, speakers)
)

// ---------- задачи расшифровки ----------
ipcMain.handle('job:start', (_e, slug: string, opts: TranscribeOptions) =>
  enqueueTranscribe(slug, opts)
)
ipcMain.handle('job:cancel', (_e, id: string) => cancelJob(id))
ipcMain.handle('job:list', () => listJobs())

// ---------- экспорт ----------
ipcMain.handle(
  'export:run',
  async (_e, slug: string, format: ExportFormat, highlight: boolean) => {
    if (!win) return null
    const meta = getProject(slug)
    if (!meta) return null
    const ext = format
    const res = await dialog.showSaveDialog(win, {
      title: 'Сохранить расшифровку',
      defaultPath: join(projectDir(slug), `${meta.title}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    })
    if (res.canceled || !res.filePath) return null
    await exportTranscript(meta, res.filePath, format, highlight)
    shell.showItemInFolder(res.filePath)
    return res.filePath
  }
)

// «Видео→аудио» как файл: отдать извлечённый звук проекта (audio.m4a) наружу.
ipcMain.handle('export:audio', async (_e, slug: string) => {
  if (!win) return null
  const meta = getProject(slug)
  if (!meta) return null
  const srcAudio = join(projectDir(slug), 'audio.m4a')
  if (!existsSync(srcAudio)) return null
  const res = await dialog.showSaveDialog(win, {
    title: 'Сохранить аудио',
    defaultPath: join(projectDir(slug), `${meta.title}.m4a`),
    filters: [{ name: 'Аудио', extensions: ['m4a'] }]
  })
  if (res.canceled || !res.filePath) return null
  copyFileSync(srcAudio, res.filePath)
  shell.showItemInFolder(res.filePath)
  return res.filePath
})

// ---------- ИИ-чистка ----------
ipcMain.handle('ai:available', async () => {
  const p = getProvider('local-llama')
  return p ? p.isAvailable() : false
})
ipcMain.handle('ai:hasBackup', (_e, slug: string) => hasAiBackup(slug))
ipcMain.handle('ai:cleanup', (_e, slug: string) =>
  runCleanup(slug, 'local-llama', (p) => win?.webContents.send('ai:progress', p))
)
ipcMain.handle('ai:revert', (_e, slug: string) => revertCleanup(slug))
ipcMain.handle(
  'ai:summarize',
  async (_e, slug: string, level: SummaryLevel, domain: SummaryDomain) => {
    const meta = getProject(slug)
    if (!meta?.turns) return null
    if (!(await ensureOllama())) throw new Error('AI_UNAVAILABLE')
    const provider = getProvider('local-llama')
    if (!provider) throw new Error('AI_PROVIDER_NOT_FOUND')
    if (!(await provider.isAvailable())) throw new Error('AI_MODEL_MISSING')
    const name = (spk: string): string => meta.speakers?.find((s) => s.id === spk)?.name ?? spk
    const text = meta.turns
      .map((t) => name(t.spk) + ': ' + t.words.map((w) => w.t).join(' '))
      .join('\n')
    return provider.summarize(text, level, domain)
  }
)

app.whenReady().then(() => {
  initQueue()
  setJobNotifier((job) => {
    win?.webContents.send('job:update', job)
  })

  installMediaProtocol((url) => {
    if (url.host === 'audio') {
      const slug = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!slug || slug.includes('..') || slug.includes('\\') || slug.includes('/')) return null
      return join(projectDir(slug), 'audio.m4a')
    }
    return null
  })

  createWindow()

  // Автообновление: только в собранном приложении (в dev нет app-update.yml).
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('[updater]', err)
    })
  }

  // Dev-хук: headless-проверка пайплайна импорта без диалога.
  const devImport = process.env['SLOVO_IMPORT']
  if (devImport) {
    importFromPath(devImport)
      .then((meta) => console.log('[SLOVO_IMPORT] ok ' + JSON.stringify(meta)))
      .catch((err) => console.error('[SLOVO_IMPORT] fail ' + String(err)))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
