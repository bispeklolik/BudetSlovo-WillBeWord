import { BrowserWindow, clipboard, screen, globalShortcut } from 'electron'
import { spawn } from 'child_process'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../paths'
import { transcribeClip } from '../stt/clip'
import { hotkeyHook } from './hotkeyHook'
import type { DictationSettings } from '../../shared/types'
import { defaultDictation } from '../../shared/types'

// Менеджер системной диктовки: жест → запись (в главном renderer) →
// распознавание (движок из настроек расшифровки) → опциональная LLM-чистка →
// вставка в активное окно (буфер + Ctrl+V, буфер восстанавливается).
// Оверлей-плашка (focusable:false + showInactive) показывает состояние и
// НИКОГДА не забирает фокус у окна, куда диктуют.

type Phase = 'idle' | 'recording' | 'processing'

const HISTORY = join(DATA_DIR, 'dictation-history.jsonl')

let overlay: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null
let overlayUrl = ''
let cfg: DictationSettings = { ...defaultDictation }
let phase: Phase = 'idle'
let polishFn: ((text: string) => Promise<string>) | null = null

function send(ch: string, ...args: unknown[]): void {
  mainWin?.webContents.send(ch, ...args)
}

function overlayState(state: string): void {
  overlay?.webContents.send('dict:state', state)
}

function showOverlay(): void {
  if (!overlay) return
  // К курсору, снизу экрана с курсором — как у конкурентов.
  const pt = screen.getCursorScreenPoint()
  const disp = screen.getDisplayNearestPoint(pt)
  const { x, y, width, height } = disp.workArea
  overlay.setBounds({
    x: Math.round(x + width / 2 - 130),
    y: Math.round(y + height - 96),
    width: 260,
    height: 64
  })
  overlay.showInactive() // не красть фокус!
}

function hideOverlay(): void {
  overlay?.hide()
}

// Вставка: сохранить буфер → положить текст → Ctrl+V (SendKeys) → вернуть
// буфер, если он всё ещё содержит наш текст (пользователь мог скопировать своё).
function pasteIntoActiveWindow(text: string): void {
  const prev = clipboard.readText()
  clipboard.writeText(text)
  const ps = spawn('powershell', [
    '-NoProfile',
    '-Command',
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
  ])
  ps.on('close', () => {
    setTimeout(() => {
      if (clipboard.readText() === text && prev) clipboard.writeText(prev)
    }, 500)
  })
}

function logHistory(raw: string, polished: string | null): void {
  // Никогда не терять диктовку: append-only журнал (главная жалоба на конкурентов).
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    appendFileSync(
      HISTORY,
      JSON.stringify({ at: new Date().toISOString(), raw, polished }) + '\n',
      'utf8'
    )
  } catch {
    /* журнал не критичен */
  }
}

function startRecording(): void {
  if (phase !== 'idle') return
  console.log('[dictation] recording start')
  phase = 'recording'
  showOverlay()
  overlayState('listening')
  send('dict:record-start', { sounds: cfg.sounds })
  // Esc отменяет запись — регистрируем только на время записи.
  globalShortcut.register('Escape', () => cancelRecording())
}

function stopRecording(): void {
  if (phase !== 'recording') return
  console.log('[dictation] recording stop → processing')
  phase = 'processing'
  globalShortcut.unregister('Escape')
  overlayState('processing')
  send('dict:record-stop')
}

function cancelRecording(): void {
  if (phase !== 'recording') return
  phase = 'idle'
  globalShortcut.unregister('Escape')
  hotkeyHook.reset()
  send('dict:record-cancel')
  hideOverlay()
}

// Renderer прислал записанный клип.
export async function onDictationAudio(data: ArrayBuffer): Promise<void> {
  try {
    const raw = (await transcribeClip(Buffer.from(data))).trim()
    console.log('[dictation] transcribed chars:', raw.length)
    if (!raw) {
      overlayState('empty')
      setTimeout(hideOverlay, 1600)
      return
    }
    let text = raw
    if (cfg.polish && polishFn) {
      try {
        const polished = (await polishFn(raw)).trim()
        if (polished) text = polished
      } catch {
        /* полировка упала — вставляем сырой текст, это лучше потери */
      }
    }
    logHistory(raw, text === raw ? null : text)
    if (cfg.autoPaste) {
      pasteIntoActiveWindow(text)
    } else {
      clipboard.writeText(text)
    }
    overlayState('done')
    setTimeout(hideOverlay, 1200)
  } catch (err) {
    overlayState('error')
    logHistory('', null)
    console.error('[dictation]', err)
    setTimeout(hideOverlay, 2500)
  } finally {
    phase = 'idle'
  }
}

export function initDictation(
  main: BrowserWindow,
  ovl: BrowserWindow,
  url: string,
  polish: (text: string) => Promise<string>
): void {
  mainWin = main
  overlay = ovl
  overlayUrl = url
  polishFn = polish
  void overlay.loadURL(overlayUrl)
  hotkeyHook.on('push-start', startRecording)
  hotkeyHook.on('push-stop', stopRecording)
  hotkeyHook.on('toggle-start', startRecording)
  hotkeyHook.on('toggle-stop', stopRecording)
}

export function applyDictationSettings(d: DictationSettings | undefined): void {
  cfg = { ...defaultDictation, ...d }
  hotkeyHook.stop()
  if (cfg.enabled && hotkeyHook.setHotkey(cfg.hotkey)) {
    hotkeyHook.start()
  }
}

export function stopDictation(): void {
  hotkeyHook.stop()
  globalShortcut.unregister('Escape')
}
