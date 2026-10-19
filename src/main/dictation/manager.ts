import { BrowserWindow, clipboard, screen, globalShortcut } from 'electron'
import { spawn } from 'child_process'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../paths'
import { transcribeClip } from '../stt/clip'
import { hotkeyHook } from './hotkeyHook'
import { acceptPolished } from './polish'
import { pauseMedia, resumeMedia } from './media'
import type { DictationSettings, DictationEntry } from '../../shared/types'
import { defaultDictation } from '../../shared/types'

// Менеджер системной диктовки: жест → запись (в главном renderer) →
// распознавание (движок из настроек расшифровки) → опциональная LLM-чистка →
// вставка в активное окно (буфер + Ctrl+V, буфер восстанавливается).
// Оверлей-плашка (focusable:false + showInactive) показывает состояние и
// НИКОГДА не забирает фокус у окна, куда диктуют.
//
// Надёжность (уроки OpenWhispr/Handy): аудио сохраняется ДО распознавания —
// сбой сети или движка не теряет диктовку, её можно «Повторить»; молчащий
// микрофон и отказ в доступе видны сразу, а не зависанием «Распознаю…».

type Phase = 'idle' | 'recording' | 'processing'

const HISTORY = join(DATA_DIR, 'dictation-history.jsonl')
const AUDIO_DIR = join(DATA_DIR, 'dictation')

let overlay: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null
let overlayUrl = ''
let cfg: DictationSettings = { ...defaultDictation }
let phase: Phase = 'idle'
let polishFn: ((text: string) => Promise<string>) | null = null
let pausedMedia: Promise<string[]> | null = null

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
    x: Math.round(x + width / 2 - 150),
    y: Math.round(y + height - 96),
    width: 300,
    height: 64
  })
  overlay.showInactive() // не красть фокус!
}

function hideOverlay(): void {
  overlay?.hide()
}

function finish(state: string, hideAfterMs: number): void {
  overlayState(state)
  setTimeout(hideOverlay, hideAfterMs)
  void restoreMedia()
}

async function restoreMedia(): Promise<void> {
  const p = pausedMedia
  pausedMedia = null
  if (p) await resumeMedia(await p)
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

function logHistory(e: DictationEntry): void {
  // Никогда не терять диктовку: append-only журнал (главная жалоба на конкурентов).
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    appendFileSync(HISTORY, JSON.stringify(e) + '\n', 'utf8')
  } catch {
    /* журнал не критичен */
  }
}

function saveClip(data: Buffer): string | undefined {
  if ((cfg.keepAudioDays ?? 7) <= 0) return undefined
  try {
    mkdirSync(AUDIO_DIR, { recursive: true })
    const name = new Date().toISOString().replace(/[:.]/g, '-') + '.webm'
    writeFileSync(join(AUDIO_DIR, name), data)
    return name
  } catch {
    return undefined
  }
}

/** Удалить аудио диктовок старше срока хранения (запускается при старте и смене настроек). */
export function pruneDictationAudio(): void {
  const days = cfg.keepAudioDays ?? 7
  if (!existsSync(AUDIO_DIR)) return
  const limit = Date.now() - Math.max(0, days) * 86400_000
  for (const f of readdirSync(AUDIO_DIR)) {
    try {
      const p = join(AUDIO_DIR, f)
      if (days <= 0 || statSync(p).mtimeMs < limit) unlinkSync(p)
    } catch {
      /* занят — удалим в следующий раз */
    }
  }
}

/** Последние диктовки (новые сверху) — для списка в настройках. */
export function dictationHistory(limit = 15): DictationEntry[] {
  try {
    const lines = readFileSync(HISTORY, 'utf8').trim().split('\n').slice(-limit * 2)
    return lines
      .map((l) => {
        try {
          return JSON.parse(l) as DictationEntry
        } catch {
          return null
        }
      })
      .filter((e): e is DictationEntry => !!e && (!!e.raw || !!e.error))
      .map((e) => ({ ...e, audio: e.audio && existsSync(join(AUDIO_DIR, e.audio)) ? e.audio : undefined }))
      .reverse()
      .slice(0, limit)
  } catch {
    return []
  }
}

async function recognize(data: Buffer): Promise<{ raw: string; text: string; polished: string | null }> {
  const raw = (await transcribeClip(data)).trim()
  let polished: string | null = null
  if (raw && cfg.polish && polishFn) {
    try {
      polished = acceptPolished(raw, await polishFn(raw))
    } catch {
      /* полировка упала — вставляем сырой текст, это лучше потери */
    }
  }
  return { raw, text: polished ?? raw, polished }
}

/** «Повторить» из списка: распознать сохранённый клип заново и положить в буфер. */
export async function retryDictation(audio: string): Promise<string> {
  const file = join(AUDIO_DIR, audio.replace(/[\\/]/g, ''))
  if (!existsSync(file)) throw new Error('Аудио этой диктовки уже удалено (срок хранения).')
  const { raw, text, polished } = await recognize(readFileSync(file))
  if (!raw) throw new Error('В записи не расслышал речи.')
  logHistory({ at: new Date().toISOString(), raw, polished, audio })
  clipboard.writeText(text)
  return text
}

function startRecording(): void {
  if (phase !== 'idle') return
  console.log('[dictation] recording start')
  phase = 'recording'
  showOverlay()
  overlayState('listening')
  send('dict:record-start', { sounds: cfg.sounds, tailMs: cfg.tailMs ?? 300, micId: cfg.micId ?? '' })
  if (cfg.pauseMedia !== false) pausedMedia = pauseMedia().catch(() => [])
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
  void restoreMedia()
}

export interface ClipMeta {
  /** микрофон весь клип молчал (уровень ниже порога) */
  silent?: boolean
  /** запись не началась: нет доступа к микрофону и т.п. */
  error?: string
}

// Renderer прислал записанный клип (или сообщил, что записи нет).
export async function onDictationAudio(data: ArrayBuffer, meta: ClipMeta = {}): Promise<void> {
  try {
    if (meta.error) {
      logHistory({ at: new Date().toISOString(), raw: '', polished: null, error: meta.error })
      finish('nomic', 3000)
      return
    }
    const buf = Buffer.from(data)
    const audio = saveClip(buf)
    if (meta.silent) {
      logHistory({ at: new Date().toISOString(), raw: '', polished: null, error: 'Микрофон молчал', audio })
      finish('silent', 3000)
      return
    }
    let result: { raw: string; text: string; polished: string | null }
    try {
      result = await recognize(buf)
    } catch (err) {
      logHistory({
        at: new Date().toISOString(),
        raw: '',
        polished: null,
        error: err instanceof Error ? err.message : String(err),
        audio
      })
      console.error('[dictation]', err)
      finish('error', 3000)
      return
    }
    console.log('[dictation] transcribed chars:', result.raw.length, 'polished:', result.polished !== null)
    if (!result.raw) {
      finish('empty', 1600)
      return
    }
    logHistory({ at: new Date().toISOString(), raw: result.raw, polished: result.polished, audio })
    if (cfg.autoPaste) pasteIntoActiveWindow(result.text)
    else clipboard.writeText(result.text)
    finish('done', 1200)
  } finally {
    phase = 'idle'
    hotkeyHook.reset()
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
  pruneDictationAudio()
  hotkeyHook.stop()
  if (cfg.enabled && hotkeyHook.setHotkey(cfg.hotkey)) {
    hotkeyHook.start()
  }
}

export function stopDictation(): void {
  hotkeyHook.stop()
  globalShortcut.unregister('Escape')
}
