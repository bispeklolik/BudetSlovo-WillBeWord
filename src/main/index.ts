import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { DATA_DIR, loadSettings, saveSettings } from './settings'
import { registerMediaScheme, installMediaProtocol } from './protocol'
import {
  createProjectFromFile,
  listProjects,
  getProject,
  readPeaks,
  projectDir
} from './project/store'
import type { Settings } from '../shared/types'

// Все данные Chromium-профиля строго на D: — C: почти полон.
app.setPath('userData', join(DATA_DIR, 'electron'))
registerMediaScheme()

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
      peaks: 'Строю звуковую волну…',
      done: 'Готово'
    }
    sendImportProgress(phase, messages[phase] ?? phase)
  })
}

ipcMain.handle('project:import', async () => {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, {
    title: 'Выберите аудиозапись',
    properties: ['openFile'],
    filters: [
      { name: 'Аудио', extensions: ['m4a', 'mp3', 'wav', 'aac', 'ogg', 'flac', 'webm', 'mp4'] },
      { name: 'Все файлы', extensions: ['*'] }
    ]
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return importFromPath(res.filePaths[0])
})

ipcMain.handle('project:list', () => listProjects())
ipcMain.handle('project:get', (_e, slug: string) => getProject(slug))
ipcMain.handle('project:peaks', (_e, slug: string) => readPeaks(slug))

app.whenReady().then(() => {
  installMediaProtocol((url) => {
    if (url.host === 'audio') {
      const slug = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!slug || slug.includes('..') || slug.includes('\\') || slug.includes('/')) return null
      return join(projectDir(slug), 'audio.m4a')
    }
    return null
  })

  createWindow()

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
