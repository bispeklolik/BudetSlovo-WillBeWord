import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Notification } from 'electron'
import { join } from 'path'
import { existsSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'fs'
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
import { exportTranscript, buildTextDocx, type ExportFormat } from './export'
import {
  registerProvider,
  getProvider,
  type SummaryLevel,
  type SummaryDomain,
  type AiProvider
} from './ai/provider'
import {
  localLlamaProvider,
  SUMMARY_BASE,
  SUMMARY_DOMAIN,
  SUMMARY_LEVEL
} from './ai/localLlama'
import { chunkByLines } from '../shared/chunk'
import { generateSmart } from './ai/smart'
import {
  askRecording,
  askAll,
  askAllThorough,
  projectsIn,
  enhanceNotes,
  dynamicsSessions,
  clientDynamics
} from './ai/insights'
import { missedSystem } from '../shared/aiTasks'
import { transcribeClip, transcribeAudioText } from './stt/clip'
import { toDataURL as qrDataUrl } from 'qrcode'
import { startPhoneUpload, stopPhoneUpload } from './phone/server'
import { startWatchFolder, stopWatchFolder } from './watch/folder'
import { downloadLink, installYtDlp, ytDlpInstalled, cancelLinkImport } from './link/import'
import { claudeProvider, setClaudeConfig } from './ai/claude'
import { openrouterProvider, setOpenrouterConfig } from './ai/openrouter'
import { runCleanup, revertCleanup, hasAiBackup } from './ai/cleanupJob'
import { stopOllama, ensureOllama, ollamaStatus, pullOllamaModel } from './ai/ollamaServer'
import { LEGACY_DATA_DIR } from './pathsResolve'
import { enginePaths } from './engine/location'
import { detectGpu, freeBytes } from './engine/sysinfo'
import {
  startSetup,
  stopSetup,
  setupStatus,
  pendingSetup,
  setSetupNotifier,
  modelInstalled
} from './engine/setup'
import { LOCAL_MODELS, DEFAULT_LOCAL_MODEL } from '../shared/localModels'
import { checkKey } from './keyCheck'
import { createDemoProject } from './demo'
import { createBackup, restoreBackup } from './backup'
import { holdAwake, releaseAwake } from './wakeLock'
import { applyHighlights, clearHighlights } from './ai/highlight'
import { listNotes, saveNote, deleteNote } from './notes/store'
import {
  initDictation,
  applyDictationSettings,
  stopDictation,
  onDictationAudio,
  dictationHistory,
  retryDictation,
  type ClipMeta
} from './dictation/manager'
import { setDictationBlocker, isDictating } from './dictation/manager'
import {
  registerCallCapture,
  openCall,
  writeChunk,
  finishCall,
  cancelCall,
  recoverCalls,
  isCallActive,
  abandonActiveCall,
  setCallWriteErrorHandler,
  saveCallNotes,
  missedAudio
} from './calls/recorder'
import { startCallWatcher, stopCallWatcher, snoozeCallPrompts } from './calls/watcher'
import type { CallPrompt } from '../shared/callDetect'
import {
  initQueue,
  setJobNotifier,
  enqueueTranscribe,
  cancelJob,
  listJobs
} from './jobs/queue'
import type {
  Settings,
  TranscribeOptions,
  Turn,
  SpeakerInfo,
  NoteInput,
  AnonRule,
  ProjectMeta,
  AskTurn
} from '../shared/types'

// Профиль Chromium — внутри папки данных (у владельца это D:, где есть место).
app.setPath('userData', join(DATA_DIR, 'electron'))

// Второй экземпляр портит очередь задач и перезатирает настройки/конспекты —
// разрешаем ровно один: повторный запуск просто поднимает уже открытое окно.
// app.quit() асинхронный: второй экземпляр успевал пройти whenReady — открыть
// окно, запустить опрос клавиши диктовки (сирота-PowerShell) и обработчики.
// Поэтому — немедленный выход и whenReady только у владельца блокировки.
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.exit(0)
}
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

registerMediaScheme()
registerProvider(localLlamaProvider)
registerProvider(claudeProvider)
registerProvider(openrouterProvider)
app.on('before-quit', () => {
  stopPhoneUpload()
  stopWatchFolder()
  stopOllama()
  stopDictation()
  stopCallWatcher()
})

let win: BrowserWindow | null = null
let settings: Settings = loadSettings()
setClaudeConfig(settings.anthropicKey, settings.claudeModel)
setOpenrouterConfig(settings.openrouterKey, settings.openrouterModel)

// Готовит выбранный движок для одиночных вызовов (саммари/мысли): для локального
// поднимает Ollama; проверяет доступность (ключ/модель). Обезличивание — всегда локально.
async function prepareEngine(): Promise<AiProvider> {
  const provider = getProvider(settings.aiEngine ?? 'local-llama')
  if (!provider) throw new Error('AI_PROVIDER_NOT_FOUND')
  if (provider.isLocal && !(await ensureOllama())) throw new Error('AI_UNAVAILABLE')
  if (!(await provider.isAvailable())) throw new Error('AI_MODEL_MISSING')
  return provider
}

// Расшифровка как плоский текст «Говорящий: реплика» — вход для ИИ-задач.
function transcriptText(meta: ProjectMeta): string {
  const name = (spk: string): string => meta.speakers?.find((s) => s.id === spk)?.name ?? spk
  return (meta.turns ?? [])
    .map((t) => name(t.spk) + ': ' + t.words.map((w) => w.t).join(' '))
    .join('\n')
}

function rendererUrl(hash: string): string {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) return dev + '#' + hash
  return 'file://' + join(__dirname, '../renderer/index.html') + '#' + hash
}

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
  // Скрытое окно-плашка диктовки держит приложение живым: без этого после
  // закрытия главного окна «Слово» оставалось работать невидимым.
  win.on('closed', () => {
    win = null
    app.quit()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Оверлей диктовки: не забирает фокус, поверх всех окон, без рамки.
function createDictationOverlay(): BrowserWindow {
  return new BrowserWindow({
    width: 260,
    height: 64,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })
}

// ---------- настройки ----------
ipcMain.handle('settings:get', () => settings)
ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
  settings = { ...settings, ...patch }
  saveSettings(settings)
  setClaudeConfig(settings.anthropicKey, settings.claudeModel)
  setOpenrouterConfig(settings.openrouterKey, settings.openrouterModel)
  if ('dictation' in patch || 'vocab' in patch) applyDictationSettings(settings.dictation, settings.vocab)
  if ('callPrompt' in patch) applyCallWatcher()
  if ('watchFolder' in patch) applyWatchFolder(false)
  return settings
})

// Аудио диктовки из renderer → распознать → вставить в активное окно.
ipcMain.handle('dict:audio', (_e, data: ArrayBuffer, meta?: ClipMeta) => onDictationAudio(data, meta))

// ---------- запись звонков ----------
const callNames = (): [string, string] => settings.callNames ?? ['Я', 'Собеседник']
ipcMain.handle('call:open', (_e, id: string) => openCall(id))
// Куски летят каждые 2 с — без ответа (send), чтобы не держать renderer.
ipcMain.on('call:chunk', (_e, id: string, kind: string, data: ArrayBuffer) => writeChunk(id, kind, data))
ipcMain.handle(
  'call:finish',
  (_e, id: string, opts: { title: string; names: [string, string]; app?: string; myNotes?: string }) => {
    patchSettings({ callNames: opts.names })
    return finishCall(id, opts)
  }
)
ipcMain.on('call:notes', (_e, id: string, text: string) => saveCallNotes(id, String(text ?? '')))
// «Что я пропустил?»: последние N минут идущей записи → текст → короткий пересказ.
ipcMain.handle('call:missed', async (_e, id: string, minutes: number) => {
  const m = Math.min(30, Math.max(1, Math.round(Number(minutes) || 3)))
  const audio = await missedAudio(id, m)
  const outDir = audio.replace(/\.m4a$/, '-out')
  try {
    let text: string
    try {
      text = await transcribeAudioText(audio, outDir)
    } catch (err) {
      // Облачные движки на тишине отвечают ошибкой «пустая расшифровка».
      if (/пуст(ая|ую) расшифровк/i.test(String(err))) text = ''
      else throw err
    }
    if (text.replace(/[\s.,!?…-]/g, '').length < 3) return `За последние ${m} мин речи почти не слышно.`
    try {
      const provider = await prepareEngine()
      return (await provider.generate(missedSystem(m), text)).trim()
    } catch {
      return `ИИ сейчас недоступен — вот текст последних ${m} мин:\n\n${text}`
    }
  } finally {
    rmSync(audio, { force: true })
    rmSync(outDir, { recursive: true, force: true })
  }
})
ipcMain.handle('call:cancel', (_e, id: string) => cancelCall(id))
ipcMain.handle('call:mute', (_e, appId: string) => {
  const muted = new Set(settings.callMuted ?? [])
  muted.add(appId)
  patchSettings({ callMuted: [...muted] })
})
ipcMain.handle('call:unmute', (_e, appId: string) => {
  patchSettings({ callMuted: (settings.callMuted ?? []).filter((a) => a !== appId) })
})
ipcMain.handle('call:snooze', () => snoozeCallPrompts())

function onCallDetected(p: CallPrompt): void {
  win?.webContents.send('call:prompt', { appId: p.appId, name: p.name })
  // Окно свёрнуто или не в фокусе — системное уведомление; клик открывает окно записи.
  if (win && !win.isFocused() && Notification.isSupported()) {
    const n = new Notification({
      title: `Похоже, идёт звонок в ${p.name}`,
      body: 'Нажмите, чтобы записать разговор в «Слово».',
      silent: true
    })
    n.on('click', () => {
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('call:prompt', { appId: p.appId, name: p.name, open: true })
    })
    n.show()
  }
}

function applyCallWatcher(): void {
  stopCallWatcher()
  // Выключили подсказки — уже показанную полосу тоже убрать.
  if (settings.callPrompt === false) win?.webContents.send('call:prompt-gone')
  if (settings.callPrompt !== false) {
    startCallWatcher({
      isMuted: (id) => (settings.callMuted ?? []).includes(id),
      isBusy: () => isCallActive() || isDictating(),
      onCall: onCallDetected,
      onGone: () => win?.webContents.send('call:prompt-gone')
    })
  }
}
ipcMain.handle('dict:history', () => dictationHistory())
ipcMain.handle('dict:retry', (_e, audio: string) => retryDictation(audio))

// ---------- первый запуск («три двери»), движок, бэкап ----------
function patchSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch }
  saveSettings(settings)
}

// Владелец со старыми данными или человек, у которого уже есть записи, мастер
// первого запуска не видит — он для новых людей.
if (!settings.onboarded && (DATA_DIR === LEGACY_DATA_DIR || listProjects().length > 0)) {
  patchSettings({ onboarded: true })
}

setSetupNotifier((p) => {
  win?.webContents.send('setup:progress', p)
  const busy = p.stage === 'engine' || p.stage === 'extract' || p.stage === 'model'
  if (busy) holdAwake('setup')
  else releaseAwake('setup')
  // Прогресс загрузки — и на кнопке в панели задач.
  if (win && !win.isDestroyed()) win.setProgressBar(busy && p.total > 0 ? p.done / p.total : -1)
})

ipcMain.handle('setup:info', () => {
  const e = enginePaths()
  return {
    dataDir: DATA_DIR,
    engine: { installed: e.installed, source: e.source, dir: e.dir, modelsDir: e.modelsDir },
    installedModels: LOCAL_MODELS.filter((m) => modelInstalled(e.modelsDir, m.id)).map((m) => m.id),
    localModel: settings.localModel ?? DEFAULT_LOCAL_MODEL,
    gpu: detectGpu(),
    freeBytes: freeBytes(e.dir),
    pending: pendingSetup(),
    progress: setupStatus()
  }
})
ipcMain.handle('setup:start', (_e, modelId: string) => {
  startSetup(modelId, (id) => patchSettings({ localModel: id }))
})
ipcMain.handle('setup:stop', () => stopSetup())
ipcMain.handle('setup:ollama', () => ollamaStatus())

let ollamaPull: AbortController | null = null
ipcMain.handle('setup:pullOllama', async (_e, name: string) => {
  if (ollamaPull) return
  ollamaPull = new AbortController()
  holdAwake('ollama')
  try {
    await pullOllamaModel(name, (p) => win?.webContents.send('setup:ollamaProgress', p), ollamaPull.signal)
  } finally {
    ollamaPull = null
    releaseAwake('ollama')
  }
})
ipcMain.handle('setup:stopOllama', () => ollamaPull?.abort())
ipcMain.handle('setup:checkKey', (_e, service: string, key: string) => checkKey(service, key))
ipcMain.handle('setup:demo', () => createDemoProject())

// Внешние ссылки из мастера — только из белого списка (сайты ключей и Ollama).
const EXTERNAL_OK = [
  'https://ollama.com/',
  'https://elevenlabs.io/',
  'https://console.deepgram.com/',
  'https://www.assemblyai.com/',
  'https://platform.openai.com/',
  'https://console.groq.com/',
  'https://console.anthropic.com/',
  'https://openrouter.ai/'
]
ipcMain.handle('app:openExternal', (_e, url: string) => {
  if (EXTERNAL_OK.some((p) => url.startsWith(p))) return shell.openExternal(url)
})

ipcMain.handle('backup:create', async () => {
  const stamp = new Date().toLocaleDateString('sv-SE') // местная дата ГГГГ-ММ-ДД
  const r = await dialog.showSaveDialog(win!, {
    title: 'Сохранить резервную копию',
    defaultPath: join(app.getPath('documents'), `Слово-копия-${stamp}.zip`),
    filters: [{ name: 'Архив ZIP', extensions: ['zip'] }]
  })
  if (r.canceled || !r.filePath) return null
  const res = await createBackup(DATA_DIR, r.filePath)
  return { path: r.filePath, ...res }
})

ipcMain.handle('backup:restore', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Выберите резервную копию «Слова»',
    properties: ['openFile'],
    filters: [{ name: 'Архив ZIP', extensions: ['zip'] }]
  })
  if (r.canceled || !r.filePaths[0]) return null
  const ok = await dialog.showMessageBox(win!, {
    type: 'warning',
    buttons: ['Восстановить', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
    title: 'Восстановить из копии?',
    message: 'Записи, конспекты и настройки заменятся данными из копии.',
    detail:
      'Нынешние версии не удалятся: они переедут в папку «_before-restore-…» внутри папки данных. После восстановления «Слово» перезапустится.'
  })
  if (ok.response !== 0) return null
  const res = await restoreBackup(DATA_DIR, r.filePaths[0])
  setTimeout(() => {
    app.relaunch()
    app.exit(0)
  }, 1500)
  return res
})

// ---------- конспекты ----------
ipcMain.handle('notes:list', () => listNotes())
ipcMain.handle('notes:save', (_e, input: NoteInput) => saveNote(input))
ipcMain.handle('notes:delete', (_e, id: string) => deleteNote(id))

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
    title: 'Выберите одну или несколько записей',
    properties: ['openFile', 'multiSelections'],
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
  // Пакетный импорт: несколько файлов → каждый импортируем и сразу ставим в
  // очередь расшифровки с настройками по умолчанию (очередь FIFO, по одному).
  const metas: ProjectMeta[] = []
  for (const p of res.filePaths) {
    const meta = await importFromPath(p)
    metas.push(meta)
  }
  if (metas.length > 1) {
    for (const m of metas) enqueueTranscribe(m.slug, { numSpeakers: 2, enhance: true })
  }
  return metas
})

// Импорт по пути (перетаскивание файла в окно) — без диалога.
ipcMain.handle('project:importPath', (_e, path: string) => importFromPath(path))

// ---------- волна 5: запись с телефона, папка-наблюдатель, ссылка ----------
const notifyProjects = (): void => win?.webContents.send('projects:changed')
const notice = (message: string): void => win?.webContents.send('app:notice', message)

ipcMain.handle('phone:start', async () => {
  const s = await startPhoneUpload(async (path) => {
    const meta = await createProjectFromFile(path)
    // Файл пришёл во временную папку — ссылка на него в записи не нужна.
    meta.audio.originalPath = ''
    saveProject(meta)
    notifyProjects()
    win?.webContents.send('phone:received', { slug: meta.slug, title: meta.title })
    return meta.title
  })
  return { urls: s.urls, qr: s.urls[0] ? await qrDataUrl(s.urls[0], { margin: 1, width: 240 }) : '' }
})
ipcMain.handle('phone:stop', () => stopPhoneUpload())

function applyWatchFolder(takeExisting: boolean): void {
  const w = settings.watchFolder
  if (!w?.dir) {
    stopWatchFolder()
    return
  }
  startWatchFolder(w.dir, takeExisting, {
    importFile: async (path) => {
      const meta = await createProjectFromFile(path)
      if (settings.watchFolder?.autoTranscribe) enqueueTranscribe(meta.slug, { numSpeakers: 2, enhance: true })
      return meta.title
    },
    onImported: (title) => {
      notifyProjects()
      notice(`Из папки-наблюдателя: «${title}»${settings.watchFolder?.autoTranscribe ? ' — расшифровка в очереди' : ''}.`)
    },
    onError: notice
  })
}
ipcMain.handle('watch:pick', async () => {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, { title: 'Папка, за которой следить', properties: ['openDirectory'] })
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
})
ipcMain.handle('watch:set', (_e, dir: string | null, autoTranscribe: boolean, takeExisting: boolean) => {
  const prev = settings.watchFolder?.dir
  patchSettings({ watchFolder: dir ? { dir, autoTranscribe: !!autoTranscribe } : undefined })
  // Та же папка — только переключили «расшифровывать»: наблюдатель не перезапускаем.
  if (dir !== prev) applyWatchFolder(!!takeExisting)
})

ipcMain.handle('link:status', () => ({ ytDlp: ytDlpInstalled() }))
ipcMain.handle('link:install', () => installYtDlp((p) => win?.webContents.send('link:progress', p)))
ipcMain.handle('link:cancel', () => cancelLinkImport())
ipcMain.handle('link:import', async (_e, url: string) => {
  const { file, title, dir } = await downloadLink(String(url), (p) => win?.webContents.send('link:progress', p))
  try {
    win?.webContents.send('link:progress', { phase: 'Готовлю запись', percent: null })
    const meta = await createProjectFromFile(file)
    if (title) meta.title = title
    meta.audio.originalPath = String(url)
    saveProject(meta)
    notifyProjects()
    return meta
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Переименование записи (меняем отображаемое название; папка-slug не трогается).
ipcMain.handle('project:rename', (_e, slug: string, title: string) => {
  const meta = getProject(slug)
  if (!meta) return null
  meta.title = title
  saveProject(meta)
  return meta
})

// Положить запись в папку организации (метаданные; файлы на диске не двигаются).
ipcMain.handle('project:setFolder', (_e, slug: string, folder: string) => {
  const meta = getProject(slug)
  if (!meta) return null
  if (folder) meta.folder = folder
  else delete meta.folder
  saveProject(meta)
  return meta
})

// Переименовать папку: обновить префикс пути у всех записей внутри неё.
ipcMain.handle('project:renameFolder', (_e, oldPath: string, newPath: string) => {
  if (!oldPath || !newPath || oldPath === newPath) return false
  for (const p of listProjects()) {
    const f = p.folder ?? ''
    if (f === oldPath || f.startsWith(oldPath + '/')) {
      const full = getProject(p.slug)
      if (full) {
        full.folder = newPath + f.slice(oldPath.length)
        saveProject(full)
      }
    }
  }
  return true
})

ipcMain.handle('project:list', () => listProjects())
// Удаление записи — в Корзину (не безвозвратно), чтобы можно было восстановить.
ipcMain.handle('project:delete', async (_e, slug: string) => {
  await shell.trashItem(projectDir(slug))
  return true
})
ipcMain.handle('app:openDataDir', () => shell.openPath(DATA_DIR))
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
  async (_e, slug: string, format: ExportFormat, highlight: boolean, anon?: boolean) => {
    if (!win) return null
    const meta = getProject(slug)
    if (!meta) return null
    const ext = format
    const suffix = anon ? ' (обезличено)' : ''
    const res = await dialog.showSaveDialog(win, {
      title: 'Сохранить расшифровку',
      defaultPath: join(projectDir(slug), `${meta.title}${suffix}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    })
    if (res.canceled || !res.filePath) return null
    await exportTranscript(
      meta,
      res.filePath,
      format,
      highlight,
      anon,
      settings.pauseInExport === false ? 0 : (settings.pauseMarkSec ?? 3)
    )
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

// Экспорт произвольного текста (саммари/тезисы/мысли) в Word.
ipcMain.handle('export:textDocx', async (_e, title: string, text: string) => {
  if (!win) return null
  const res = await dialog.showSaveDialog(win, {
    title: 'Сохранить в Word',
    defaultPath: join(app.getPath('documents'), `${title}.docx`),
    filters: [{ name: 'DOCX', extensions: ['docx'] }]
  })
  if (res.canceled || !res.filePath) return null
  writeFileSync(res.filePath, await buildTextDocx(title, text))
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
  runCleanup(slug, settings.aiEngine ?? 'local-llama', (p) =>
    win?.webContents.send('ai:progress', p)
  )
)
ipcMain.handle('ai:revert', (_e, slug: string) => revertCleanup(slug))
ipcMain.handle(
  'ai:summarize',
  async (_e, slug: string, level: SummaryLevel, domain: SummaryDomain) => {
    const meta = getProject(slug)
    if (!meta?.turns) return null
    const provider = await prepareEngine()
    return generateSmart(
      provider,
      SUMMARY_BASE + SUMMARY_DOMAIN[domain] + SUMMARY_LEVEL[level],
      transcriptText(meta)
    )
  }
)
// Голосовая правка: клип с микрофона → текст (движок из настроек расшифровки).
ipcMain.handle('stt:clip', (_e, data: ArrayBuffer) => transcribeClip(Buffer.from(data)))

ipcMain.handle('ai:runPrompt', async (_e, slug: string, system: string) => {
  const meta = getProject(slug)
  if (!meta?.turns) return null
  const provider = await prepareEngine()
  return generateSmart(provider, system, transcriptText(meta))
})
// ---------- MCP: Claude читает записи ----------
// Готовая запись для claude_desktop_config.json: тот же exe «Слова» в режиме Node.
ipcMain.handle('mcp:config', () => {
  const script = join(__dirname, 'mcp.js')
  const entry = {
    command: process.execPath,
    args: [script],
    env: { ELECTRON_RUN_AS_NODE: '1', SLOVO_DATA_DIR: DATA_DIR }
  }
  return {
    ok: existsSync(script),
    json: JSON.stringify({ mcpServers: { slovo: entry } }, null, 2),
    configDir: join(app.getPath('appData'), 'Claude')
  }
})
ipcMain.handle('mcp:openConfigDir', async () => {
  const dir = join(app.getPath('appData'), 'Claude')
  if (!existsSync(dir)) return false
  await shell.openPath(dir)
  return true
})

// ---------- волна 4: мои заметки, вопросы к записям, динамика ----------
ipcMain.handle('project:setMyNotes', (_e, slug: string, text: string) => {
  const meta = getProject(slug)
  if (!meta) return
  meta.myNotes = String(text ?? '')
  saveProject(meta)
})
ipcMain.handle('ai:enhanceNotes', async (_e, slug: string) => {
  const meta = getProject(slug)
  if (!meta) throw new Error('Запись не найдена.')
  const provider = await prepareEngine()
  const body = await enhanceNotes(provider, meta)
  return saveNote({ title: `Конспект: ${meta.title}`, body, kind: 'summary', sourceSlug: slug, sourceTitle: meta.title })
})
ipcMain.handle(
  'ai:askRecording',
  async (_e, slug: string, question: string, history: AskTurn[], thorough?: boolean) => {
    const meta = getProject(slug)
    if (!meta) throw new Error('Запись не найдена.')
    const provider = await prepareEngine()
    return askRecording(provider, meta, String(question), history ?? [], !!thorough)
  }
)
ipcMain.handle(
  'ai:askAll',
  async (_e, question: string, folder: string | null, history: AskTurn[], thorough?: boolean) => {
    const projects = projectsIn(listProjects(), folder)
    const provider = await prepareEngine()
    if (!thorough) return askAll(provider, projects, String(question), history ?? [])
    return askAllThorough(provider, projects, String(question), history ?? [], (done, total) =>
      win?.webContents.send('ai:progress', { done, total, phase: `Читаю запись ${Math.min(done + 1, total)} из ${total}` })
    )
  }
)
ipcMain.handle('ai:dynamics', async (_e, folder: string) => {
  const sessions = dynamicsSessions(listProjects(), folder)
  const provider = await prepareEngine()
  const body = await clientDynamics(provider, sessions, {
    progress: (done, total) =>
      win?.webContents.send('ai:progress', {
        done,
        total,
        phase: done < total - 1 ? `Выжимка сессии ${done + 1} из ${total - 1}` : 'Свожу динамику'
      }),
    saveBrief: (m, brief) => {
      const fresh = getProject(m.slug)
      if (!fresh) return
      fresh.brief = brief
      saveProject(fresh)
    }
  })
  const name = folder.split('/').pop() || folder
  return saveNote({ title: `Динамика: ${name}`, body, kind: 'summary', sourceTitle: folder })
})
ipcMain.handle('ai:highlights', async (_e, slug: string) => {
  const meta = getProject(slug)
  if (!meta?.turns) return null
  const provider = await prepareEngine()
  const phrases = await provider.highlights(transcriptText(meta))
  return saveTranscript(slug, applyHighlights(meta.turns, phrases), meta.speakers ?? [])
})
ipcMain.handle('ai:clearHighlights', (_e, slug: string) => {
  const meta = getProject(slug)
  if (!meta?.turns) return null
  return saveTranscript(slug, clearHighlights(meta.turns), meta.speakers ?? [])
})
ipcMain.handle('ai:anonymize', async (_e, slug: string) => {
  const meta = getProject(slug)
  if (!meta?.turns) return null
  if (!(await ensureOllama())) throw new Error('AI_UNAVAILABLE')
  const provider = getProvider('local-llama')
  if (!provider) throw new Error('AI_PROVIDER_NOT_FOUND')
  if (!(await provider.isAvailable())) throw new Error('AI_MODEL_MISSING')
  const text = meta.turns.map((t) => t.words.map((w) => w.t).join(' ')).join('\n')
  // Длинная сессия не влезает в контекст → обезличиваем по частям и сливаем
  // правила (дубли по find убираем). Фича приватности не должна «отказывать
  // молча»: длинный текст и ноль правил = ошибка, а не ложное «готово».
  const chunks = chunkByLines(text, 30_000)
  const merged = new Map<string, AnonRule>()
  for (const chunk of chunks) {
    for (const r of await provider.anonymize(chunk)) {
      const k = r.find.toLowerCase()
      if (!merged.has(k)) merged.set(k, r)
    }
  }
  const rules = [...merged.values()]
  if (rules.length === 0 && text.length > 2000) {
    throw new Error(
      'Обезличивание не нашло ни одного имени в длинной записи — похоже, модель не справилась. Попробуйте ещё раз.'
    )
  }
  // Модель думала минутами — за это время могли сохранить «Мои заметки» или
  // правки: пишем правила в свежую копию, а не в прочитанную до запуска.
  const fresh = getProject(slug)
  if (!fresh) return null
  fresh.anon = rules
  saveProject(fresh)
  return fresh
})
ipcMain.handle('ai:setAnon', (_e, slug: string, rules: AnonRule[]) => {
  const meta = getProject(slug)
  if (!meta) return null
  meta.anon = rules
  saveProject(meta)
  return meta
})

app.whenReady().then(() => {
  if (!primaryInstance) return
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
  // Проверяем при запуске, тихо качаем в фоне, а когда готово — показываем
  // АКТИВНЫЙ диалог с кнопкой «Перезапустить сейчас» (пассивное системное
  // уведомление пользователи пропускают). «Позже» — обновление всё равно
  // поставится при следующем выходе (autoInstallOnAppQuit по умолчанию вкл).
  if (app.isPackaged) {
    autoUpdater.autoDownload = true
    // Загрузка 100 МБ идёт минуты: показываем прогресс на иконке в панели
    // задач, иначе выглядит как «ничего не происходит», и приложение
    // закрывают до конца скачивания (диалог тогда не успевает появиться).
    autoUpdater.on('download-progress', (p) => {
      win?.setProgressBar(p.percent / 100)
    })
    autoUpdater.on('update-downloaded', (info) => {
      win?.setProgressBar(-1)
      void dialog
        .showMessageBox({
          type: 'info',
          buttons: ['Перезапустить сейчас', 'Позже'],
          defaultId: 0,
          cancelId: 1,
          title: 'Обновление готово',
          message: `Доступна новая версия «Слово» ${info.version}.`,
          detail: 'Перезапустить приложение, чтобы установить обновление? Ваши записи не пострадают.'
        })
        .then((res) => {
          if (res.response === 0) autoUpdater.quitAndInstall()
        })
        .catch(() => {})
    })
    autoUpdater.on('error', (err) => console.error('[updater]', err))
    autoUpdater.checkForUpdates().catch((err) => console.error('[updater]', err))
  }

  // Системная диктовка: оверлей + глобальная клавиша (если включена).
  const overlay = createDictationOverlay()
  initDictation(win!, overlay, rendererUrl('overlay'), async (system, user) => {
    const provider = await prepareEngine()
    // Промт режима и проверка ответа — в shared/dictModes.ts и dictation/polish.ts.
    return provider.generate(system, user)
  })
  applyDictationSettings(settings.dictation, settings.vocab)

  // Запись звонков: разрешение на звук компьютера, подсказка «идёт звонок»,
  // сборка записей, прерванных сбоем.
  registerCallCapture()
  // Наблюдатель — после загрузки окна: иначе его предупреждения терялись.
  win?.webContents.once('did-finish-load', () => applyWatchFolder(false))
  setDictationBlocker(() => isCallActive())
  setCallWriteErrorHandler((message) => win?.webContents.send('call:write-error', message))
  // Окно перезагрузили (Ctrl+R) или оно упало посреди записи: файлы закрыть и
  // сразу собрать запись — иначе «идёт запись» висело бы до перезапуска.
  const rescueCall = (): void => {
    if (!abandonActiveCall()) return
    recoverCalls(callNames())
      .then((list) => {
        if (!list.length) return
        const tell = (): void => win?.webContents.send('call:recovered', list.length)
        if (win?.webContents.isLoading()) win.webContents.once('did-finish-load', tell)
        else tell()
      })
      .catch((err) => console.error('[calls] rescue', err))
  }
  win?.webContents.on('render-process-gone', rescueCall)
  win?.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) rescueCall()
  })
  applyCallWatcher()
  recoverCalls(callNames())
    .then((list) => {
      if (!list.length || !win) return
      const tell = (): void => win?.webContents.send('call:recovered', list.length)
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', tell)
      else tell()
    })
    .catch((err) => console.error('[calls] recover', err))

  // Dev-хук: прогнать готовый клип через настоящий конвейер диктовки
  // (сохранение аудио → распознавание → чистка → журнал) без микрофона.
  const devClip = process.env['SLOVO_DICT_CLIP']
  if (devClip) {
    const prevClip = clipboard.readText()
    onDictationAudio(readFileSync(devClip).buffer as ArrayBuffer, {
      silent: process.env['SLOVO_DICT_SILENT'] === '1'
    })
      .then(() => console.log('[SLOVO_DICT_CLIP] ok ' + JSON.stringify(dictationHistory(1)[0] ?? null)))
      .catch((err) => console.error('[SLOVO_DICT_CLIP] fail ' + String(err)))
      .finally(() => setTimeout(() => clipboard.writeText(prevClip), 1500))
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
