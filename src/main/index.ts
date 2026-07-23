import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { existsSync, copyFileSync, writeFileSync } from 'fs'
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
import { claudeProvider, setClaudeConfig } from './ai/claude'
import { openrouterProvider, setOpenrouterConfig } from './ai/openrouter'
import { runCleanup, revertCleanup, hasAiBackup } from './ai/cleanupJob'
import { stopOllama, ensureOllama } from './ai/ollamaServer'
import { applyHighlights, clearHighlights } from './ai/highlight'
import { listNotes, saveNote, deleteNote } from './notes/store'
import { transcribeClip } from './stt/clip'
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
  ProjectMeta
} from '../shared/types'

// Все данные Chromium-профиля строго на D: — C: почти полон.
app.setPath('userData', join(DATA_DIR, 'electron'))

// Второй экземпляр портит очередь задач и перезатирает настройки/конспекты —
// разрешаем ровно один: повторный запуск просто поднимает уже открытое окно.
if (!app.requestSingleInstanceLock()) {
  app.quit()
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
app.on('before-quit', () => stopOllama())

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
  setClaudeConfig(settings.anthropicKey, settings.claudeModel)
  setOpenrouterConfig(settings.openrouterKey, settings.openrouterModel)
  return settings
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
    await exportTranscript(meta, res.filePath, format, highlight, anon)
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
// Map-reduce для локальной модели: длинная запись не влезает в контекст
// (16k токенов) — обрабатываем частями и сводим итог. Облачным моделям
// (200k+) отдаём целиком.
const LOCAL_CTX_CHARS = 45_000
async function generateSmart(provider: AiProvider, system: string, text: string): Promise<string> {
  if (!provider.isLocal || text.length <= LOCAL_CTX_CHARS) return provider.generate(system, text)
  const chunks = chunkByLines(text, LOCAL_CTX_CHARS)
  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    parts.push(
      await provider.generate(
        system + ` (Это часть ${i + 1} из ${chunks.length} длинной записи — обработай только её.)`,
        chunks[i]
      )
    )
  }
  return provider.generate(
    system +
      ' Ниже — результаты по последовательным частям одной длинной записи. Сведи их в один целостный ответ без повторов.',
    parts.join('\n\n---\n\n')
  )
}

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
  meta.anon = rules
  saveProject(meta)
  return meta
})
ipcMain.handle('ai:setAnon', (_e, slug: string, rules: AnonRule[]) => {
  const meta = getProject(slug)
  if (!meta) return null
  meta.anon = rules
  saveProject(meta)
  return meta
})

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
