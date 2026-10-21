import { BrowserWindow, clipboard, screen, globalShortcut, type NativeImage } from 'electron'
import { spawn } from 'child_process'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../paths'
import { transcribeClip } from '../stt/clip'
import { hotkeyHook, editComboAccelerator, type ForegroundApp } from './hotkeyHook'
import { acceptPolished, acceptEdit, wrapForPolish } from './polish'
import { buildPolishSystem, findMode, EDIT_SYSTEM, wrapForEdit } from '../../shared/dictModes'
import { applyVoicePunctuation } from '../../shared/voicePunct'
import { pickModeForApp, DEFAULT_APP_RULES } from '../../shared/appModes'
import { fuzzyFixVocab } from '../../shared/learn'
import { openDeepgramLive, type LiveSession } from './live'
import { loadSettings } from '../settings'
import { finishDictation, type Vocab } from '../../shared/vocab'
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
let polishFn: ((system: string, user: string) => Promise<string>) | null = null
let vocab: Vocab | undefined
let pausedMedia: Promise<string[]> | null = null
// Что пишем сейчас: обычную диктовку или просьбу «что сделать с выделенным».
let kind: 'dictate' | 'edit' = 'dictate'
// Программа на переднем плане в момент нажатия — для режима по программе.
let appAtStart: ForegroundApp | null = null
// Поток «текст во время речи» (если движок умеет): куски звука идут сразу.
let live: LiveSession | null = null
let liveTall = false
// Номер текущей диктовки. Рекордер присылает его вместе со звуком. Esc во
// время распознавания меняет номер: клавиша сразу свободна, а запоздавший
// звук и результат той диктовки уже не трогают новую (повторное ревью волны 6).
let gen = 0
// Звук какой диктовки уже пришёл; сторож ждёт звук не дольше 15 с.
let audioGen = -1
let stuckTimer: NodeJS.Timeout | null = null
let hideTimer: NodeJS.Timeout | null = null
// Shift + клавиша диктовки, «проглоченная» для жеста правки (см. applyDictationSettings).
let editAccel = ''

function send(ch: string, ...args: unknown[]): void {
  mainWin?.webContents.send(ch, ...args)
}

function overlayState(state: string): void {
  overlay?.webContents.send('dict:state', state)
}

function showOverlay(): void {
  if (!overlay) return
  // Таймер «спрятать» от прошлой диктовки не должен спрятать эту (ревью волны 6).
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  liveTall = false
  // К курсору, снизу экрана с курсором — как у конкурентов.
  const pt = screen.getCursorScreenPoint()
  const disp = screen.getDisplayNearestPoint(pt)
  const { x, y, width, height } = disp.workArea
  overlay.setBounds({
    x: Math.round(x + width / 2 - 170),
    y: Math.round(y + height - 96),
    width: 340,
    height: 64
  })
  overlay.showInactive() // не красть фокус!
}

/** Текст во время речи — в плашку; при первом тексте плашка вырастает в высоту. */
function overlayLive(text: string): void {
  if (!overlay) return
  if (text && !liveTall) {
    liveTall = true
    const b = overlay.getBounds()
    overlay.setBounds({ x: b.x, y: b.y - 64, width: b.width, height: b.height + 64 })
  }
  overlay.webContents.send('dict:live', text)
}

/**
 * Открыть поток распознавания, если включено и движок умеет: сейчас —
 * Deepgram по ключу пользователя (звук и так уходит туда при диктовке).
 */
function openLive(): LiveSession | null {
  if (cfg.livePreview === false) return null
  const s = loadSettings()
  const key = (s.sttKeys?.deepgram ?? '').trim()
  if (s.sttEngine !== 'deepgram' || !key) return null
  try {
    return openDeepgramLive(key, overlayLive)
  } catch (err) {
    console.error('[dictation] live', err)
    return null
  }
}

/** Кусок звука из рекордера → в поток. */
export function onDictationChunk(data: ArrayBuffer): void {
  live?.push(data)
}

/**
 * Итог потока (или '' — тогда распознаём клип целиком, как раньше).
 * Поток обрывался или терял куски — итог неполный, берём клип. Словарь в поток
 * не уходит, поэтому со словарём поток — только черновик в плашке, а текст
 * берём из клипа, где словарь учтён (ревью волны 6).
 */
async function takeLive(): Promise<string> {
  const l = live
  live = null
  if (!l) return ''
  if (vocab?.words?.length) {
    l.abort()
    return ''
  }
  try {
    const r = await l.finish()
    return r.clean ? r.text.trim() : ''
  } catch {
    return ''
  }
}

function hideOverlay(): void {
  overlay?.hide()
}

function finish(state: string, hideAfterMs: number): void {
  overlayState(state)
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hideTimer = null
    if (phase === 'idle') hideOverlay()
  }, hideAfterMs)
  void restoreMedia()
}

async function restoreMedia(): Promise<void> {
  const p = pausedMedia
  pausedMedia = null
  if (p) await resumeMedia(await p)
}

// Снимок буфера обмена: текст, HTML, RTF, картинка. Раньше возвращали только
// текст — скопированная картинка или таблица после диктовки пропадала (ревью
// волны 6). Файлы (копия из Проводника) Electron прочитать не умеет.
interface ClipSnap {
  text: string
  html: string
  rtf: string
  image: NativeImage | null
}

function snapClipboard(): ClipSnap {
  const image = clipboard.readImage()
  return { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: image.isEmpty() ? null : image }
}

function restoreClipboard(s: ClipSnap): void {
  const data: Electron.Data = {}
  if (s.text) data.text = s.text
  if (s.html) data.html = s.html
  if (s.rtf) data.rtf = s.rtf
  if (s.image) data.image = s.image
  if (Object.keys(data).length) clipboard.write(data)
}

function sendKeysPaste(): Promise<void> {
  return new Promise<void>((resolve) => {
    const ps = spawn('powershell', [
      '-NoProfile',
      '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
    ])
    ps.on('close', () => resolve())
    ps.on('error', () => resolve())
  })
}

// Вставка: снимок буфера → положить текст → Ctrl+V → вернуть буфер, если он всё
// ещё содержит наш текст (пользователь мог скопировать своё). Ctrl+V нажимает уже
// запущенный опросчик клавиши (быстро); нет его — новый PowerShell.
// hwnd — вставлять только в это окно (правка выделенного). false — окно сменилось,
// Ctrl+V не нажимали, текст оставлен в буфере.
async function pasteIntoActiveWindow(text: string, opts: { snap?: ClipSnap; hwnd?: string } = {}): Promise<boolean> {
  const snap = opts.snap ?? snapClipboard()
  clipboard.writeText(text)
  const r = hotkeyHook.running() ? await hotkeyHook.sendCombo('PASTE', opts.hwnd) : null
  if (r?.skipped) return false
  if (!r || (!r.ok && !hotkeyHook.running())) await sendKeysPaste()
  // Опросчик жив, но не ответил вовремя: он может нажать Ctrl+V позже —
  // буфер не трогаем, иначе вставился бы старый буфер.
  else if (!r.ok) return true
  setTimeout(() => {
    if (clipboard.readText() === text) restoreClipboard(snap)
  }, 600)
  return true
}

// Консоли: Ctrl+C там прерывает программу, а не копирует (ревью волны 6).
const CONSOLES = new Set([
  'windowsterminal', 'cmd', 'powershell', 'pwsh', 'conhost', 'openconsole', 'mintty', 'wezterm', 'wezterm-gui',
  'alacritty', 'putty', 'kitty', 'hyper', 'tabby', 'conemu', 'conemu64', 'cmder', 'fluentterminal.app'
])
// Редакторы кода: Ctrl+C без выделения копирует всю строку с переводом строки.
const LINE_COPY_EDITORS =
  /^(code|code - insiders|cursor|windsurf|devenv|sublime_text|zed|fleet|studio64|(idea|pycharm|webstorm|rider|clion|goland|phpstorm|rubymine|datagrip)64)$/

/** Режим для этой диктовки: по программе (если включено и правило нашлось) или из настроек. */
function modeFor(app: ForegroundApp | null): string | undefined {
  if (cfg.autoMode !== false) {
    const byApp = pickModeForApp(app, cfg.appRules?.length ? cfg.appRules : DEFAULT_APP_RULES)
    if (byApp) return byApp
  }
  return cfg.mode
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

async function recognize(
  data: Buffer,
  app: ForegroundApp | null = null,
  liveText = ''
): Promise<{ raw: string; text: string; polished: string | null; mode?: string }> {
  // Поток уже распознал речь — клип второй раз не отправляем (быстрее, не дороже).
  const raw = liveText || (await transcribeClip(data)).trim()
  // До ИИ-чистки и без неё: «запятая» → «,»; почти-слова из словаря → как в словаре.
  let base = raw
  if (base && cfg.voicePunct !== false) base = applyVoicePunctuation(base)
  if (base && cfg.fuzzyVocab !== false) base = fuzzyFixVocab(base, vocab?.words)
  let polished: string | null = null
  let modeId: string | undefined
  if (base && cfg.polish && polishFn) {
    // Режим (по программе или из настроек) + тон + словарь + цифры.
    const mode = findMode(modeFor(app), cfg.customModes)
    modeId = mode.id
    const digits = cfg.digits !== false
    try {
      const system = buildPolishSystem(mode.id, cfg.tone, vocab?.words, cfg.customModes, { digits })
      polished = acceptPolished(base, await polishFn(system, wrapForPolish(base, mode.reformat)), {
        reformat: mode.reformat
      })
      // Режим не справился (ответил на вопрос, выдумал) — хотя бы обычная чистка.
      if (polished === null && mode.reformat) {
        const clean = buildPolishSystem('clean', 'neutral', vocab?.words, cfg.customModes, { digits })
        polished = acceptPolished(base, await polishFn(clean, wrapForPolish(base)))
      }
    } catch {
      /* полировка упала — вставляем текст без чистки, это лучше потери */
    }
  }
  // Точные замены и сниппеты — после чистки: ИИ их не перепишет.
  return { raw, text: base ? finishDictation(polished ?? base, vocab) : base, polished, mode: modeId }
}

/** «Повторить» из списка: распознать сохранённый клип заново и положить в буфер. */
export async function retryDictation(audio: string): Promise<string> {
  const file = join(AUDIO_DIR, audio.replace(/[\\/]/g, ''))
  if (!existsSync(file)) throw new Error('Аудио этой диктовки уже удалено (срок хранения).')
  const { raw, text, polished } = await recognize(readFileSync(file))
  if (!raw) throw new Error('В записи не расслышал речи.')
  logHistory({ at: new Date().toISOString(), raw, polished, text, mode: cfg.polish ? cfg.mode : undefined, audio })
  clipboard.writeText(text)
  return text
}

// Пока идёт запись звонка, микрофон занят ею — диктовку не начинаем.
let blocked: () => boolean = () => false
export function setDictationBlocker(fn: () => boolean): void {
  blocked = fn
}

/** Идёт ли сейчас диктовка (подсказку о звонке в это время не показываем). */
export function isDictating(): boolean {
  return phase !== 'idle'
}

/** Подпись на плашке: каким режимом будет чистка и почему («Сообщение · telegram»). */
function modeLabel(app: ForegroundApp | null): string {
  if (!cfg.polish) return ''
  const mode = findMode(modeFor(app), cfg.customModes)
  const byApp = cfg.autoMode !== false && !!pickModeForApp(app, cfg.appRules?.length ? cfg.appRules : DEFAULT_APP_RULES)
  return mode.id === 'clean' && !byApp ? '' : mode.name + (byApp && app?.proc ? ' · ' + app.proc : '')
}

function startRecording(): void {
  if (phase !== 'idle' || blocked()) return
  console.log('[dictation] recording start')
  phase = 'recording'
  kind = 'dictate'
  gen++
  appAtStart = hotkeyHook.lastApp
  showOverlay()
  overlayState('listening|' + modeLabel(appAtStart))
  live = openLive()
  send('dict:record-start', { sounds: cfg.sounds, tailMs: cfg.tailMs ?? 300, micId: cfg.micId ?? '', live: !!live, id: gen })
  if (cfg.pauseMedia !== false) pausedMedia = pauseMedia().catch(() => [])
  // Esc отменяет запись — регистрируем только на время записи.
  globalShortcut.register('Escape', () => cancelRecording())
}

/** Shift + клавиша: записать просьбу «что сделать с выделенным текстом». */
function startEdit(): void {
  if (cfg.editByVoice === false) return startRecording()
  if (phase !== 'idle' || blocked()) return
  console.log('[dictation] edit start')
  phase = 'recording'
  kind = 'edit'
  gen++
  appAtStart = hotkeyHook.lastApp
  showOverlay()
  overlayState('edit')
  live = openLive()
  send('dict:record-start', { sounds: cfg.sounds, tailMs: cfg.tailMs ?? 300, micId: cfg.micId ?? '', live: !!live, id: gen })
  if (cfg.pauseMedia !== false) pausedMedia = pauseMedia().catch(() => [])
  globalShortcut.register('Escape', () => cancelRecording())
}

function stopRecording(): void {
  if (phase !== 'recording') return
  console.log('[dictation] recording stop → processing')
  phase = 'processing'
  // Esc остаётся: пока распознаём и правим, ещё можно передумать.
  overlayState(kind === 'edit' ? 'editing' : 'processing')
  send('dict:record-stop')
  // Сторож: звук так и не пришёл (микрофон отключили посреди записи) —
  // не висим в «Распознаю…» и не держим клавишу до перезапуска.
  const my = gen
  if (stuckTimer) clearTimeout(stuckTimer)
  stuckTimer = setTimeout(() => {
    stuckTimer = null
    if (gen !== my || phase !== 'processing' || audioGen === my) return
    console.warn('[dictation] звук записи не пришёл — сбрасываю')
    logHistory({ at: new Date().toISOString(), raw: '', polished: null, error: 'Запись не дошла до распознавания' })
    release()
    finish('error', 3000)
  }, 15_000)
}

/** Освободить клавишу: текущая диктовка закончена или отменена. */
function release(): void {
  gen++
  if (stuckTimer) clearTimeout(stuckTimer)
  stuckTimer = null
  globalShortcut.unregister('Escape')
  phase = 'idle'
  hotkeyHook.reset()
  live?.abort()
  live = null
}

function cancelRecording(): void {
  if (phase === 'processing') {
    // Запись уже распознаётся: результат не вставляем (в журнале он останется),
    // а клавишу освобождаем сразу — можно диктовать заново.
    release()
    hideOverlay()
    void restoreMedia()
    return
  }
  if (phase !== 'recording') return
  phase = 'idle'
  globalShortcut.unregister('Escape')
  hotkeyHook.reset()
  live?.abort()
  live = null
  send('dict:record-cancel')
  hideOverlay()
  void restoreMedia()
}

export interface ClipMeta {
  /** микрофон весь клип молчал (уровень ниже порога) */
  silent?: boolean
  /** запись не началась: нет доступа к микрофону и т.п. */
  error?: string
  /** клавишу отпустили раньше, чем открылся микрофон */
  tooShort?: boolean
  /** номер диктовки из dict:record-start */
  id?: number
}

// Renderer прислал записанный клип (или сообщил, что записи нет).
export async function onDictationAudio(data: ArrayBuffer, meta: ClipMeta = {}): Promise<void> {
  const my = meta.id ?? gen
  // Звук отменённой (Esc) диктовки — текущую не трогаем.
  if (my !== gen || phase !== 'processing') return
  audioGen = my
  if (stuckTimer) clearTimeout(stuckTimer)
  stuckTimer = null
  // Всё, что дальше, относится к этой диктовке, даже если началась новая.
  const current = (): boolean => my === gen
  const end = (state: string, ms: number): void => {
    if (current()) finish(state, ms)
  }
  const app = appAtStart
  try {
    if (meta.tooShort) {
      live?.abort()
      live = null
      end('empty', 1200)
      return
    }
    if (meta.error) {
      live?.abort()
      live = null
      logHistory({ at: new Date().toISOString(), raw: '', polished: null, error: meta.error })
      end('nomic', 3000)
      return
    }
    const buf = Buffer.from(data)
    const audio = saveClip(buf)
    const liveText = await takeLive()
    if (meta.silent) {
      live?.abort()
      live = null
      logHistory({ at: new Date().toISOString(), raw: '', polished: null, error: 'Микрофон молчал', audio })
      end('silent', 3000)
      return
    }
    if (kind === 'edit') {
      await handleEdit(buf, audio, liveText, app, current, end)
      return
    }
    let result: { raw: string; text: string; polished: string | null; mode?: string }
    try {
      result = await recognize(buf, app, liveText)
    } catch (err) {
      logHistory({
        at: new Date().toISOString(),
        raw: '',
        polished: null,
        error: err instanceof Error ? err.message : String(err),
        audio
      })
      console.error('[dictation]', err)
      end('error', 3000)
      return
    }
    console.log('[dictation] transcribed chars:', result.raw.length, 'polished:', result.polished !== null)
    if (!result.raw) {
      end('empty', 1600)
      return
    }
    logHistory({
      at: new Date().toISOString(),
      raw: result.raw,
      polished: result.polished,
      text: result.text,
      mode: result.mode,
      audio
    })
    if (!current()) return // Esc: текст в «Последних диктовках», никуда не вставляем
    if (cfg.autoPaste) await pasteIntoActiveWindow(result.text)
    else clipboard.writeText(result.text)
    end('done', 1200)
  } finally {
    // Отменённая диктовка не освобождает клавишу заново — её уже держит новая.
    if (current()) release()
  }
}

/**
 * Правка выделенного: просьба голосом → копируем выделенный текст (Ctrl+C) →
 * ИИ переписывает → вставляем поверх выделения (Ctrl+V). Буфер обмена
 * возвращаем как был. Ничего не выделено или ИИ не справился — текст в окне
 * не трогаем. Пока ИИ думал, человек ушёл в другое окно — не вставляем,
 * результат оставляем в буфере.
 */
async function handleEdit(
  buf: Buffer,
  audio: string | undefined,
  liveText: string,
  app: ForegroundApp | null,
  current: () => boolean,
  end: (state: string, ms: number) => void
): Promise<void> {
  const at = new Date().toISOString()
  let instruction = liveText
  try {
    if (!instruction) instruction = (await transcribeClip(buf)).trim()
  } catch (err) {
    logHistory({ at, raw: '', polished: null, error: err instanceof Error ? err.message : String(err), audio, mode: 'edit' })
    end('error', 3000)
    return
  }
  if (!current()) return // Esc: не копируем и не правим
  if (!instruction) {
    end('empty', 1600)
    return
  }
  const proc = app?.proc ?? ''
  if (CONSOLES.has(proc)) {
    logHistory({ at, raw: instruction, polished: null, error: 'Правка голосом в консоли выключена', audio, mode: 'edit' })
    end('edit-console', 3000)
    return
  }
  // Буфер не стираем: что скопировалось, видно по счётчику буфера в опросчике.
  const snap = snapClipboard()
  const copy = await hotkeyHook.sendCombo('COPY')
  // Что легло в буфер от нашего Ctrl+C — с ним сравниваем при возврате буфера.
  const copied = copy.ok && copy.changed ? clipboard.readText() : ''
  let selected = copied
  // Редактор кода скопировал строку целиком — значит, выделения не было.
  if (LINE_COPY_EDITORS.test(proc) && /^[^\n]*\n$/.test(selected)) selected = ''
  const back = (): void => {
    if (copy.changed && clipboard.readText() === copied) restoreClipboard(snap)
  }
  if (!selected.trim()) {
    back()
    logHistory({ at, raw: instruction, polished: null, error: 'Ничего не выделено', audio, mode: 'edit' })
    end('noselection', 2500)
    return
  }
  const core = selected.trim()
  let result: string | null = null
  try {
    if (!polishFn) throw new Error('ИИ не подключён')
    result = acceptEdit(core, await polishFn(EDIT_SYSTEM, wrapForEdit(core, instruction)))
  } catch (err) {
    console.error('[dictation] edit', err)
  }
  if (!current()) {
    back()
    if (result) logHistory({ at, raw: instruction, polished: result, text: result, audio, mode: 'edit' })
    return
  }
  if (!result) {
    back()
    logHistory({ at, raw: instruction, polished: null, error: 'ИИ не смог поправить текст', audio, mode: 'edit' })
    end('edit-error', 3000)
    return
  }
  // Пробелы и переводы строки по краям выделения — как были (ревью волны 6).
  const lead = /^\s*/.exec(selected)?.[0] ?? ''
  const trail = /\s*$/.exec(selected)?.[0] ?? ''
  result = lead + result + trail
  logHistory({ at, raw: instruction, polished: result, text: result, audio, mode: 'edit' })
  // Пока ИИ думал, человек мог скопировать своё — тогда после вставки останется оно.
  const keep = clipboard.readText() === copied ? snap : undefined
  const pasted = await pasteIntoActiveWindow(result, { snap: keep, hwnd: copy.hwnd })
  end(pasted ? 'done' : 'edit-moved', pasted ? 1200 : 3500)
}

export function initDictation(
  main: BrowserWindow,
  ovl: BrowserWindow,
  url: string,
  polish: (system: string, user: string) => Promise<string>
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
  hotkeyHook.on('edit-start', startEdit)
  hotkeyHook.on('edit-stop', stopRecording)
}

// Shift + клавиша диктовки — жест правки. Клавишу опросчик не глотает, и
// приложение получает, например, Shift+F10 (контекстное меню) — вставка ушла бы
// туда (ревью волны 6). Поэтому эту пару занимаем пустым глобальным сочетанием:
// опросчик её по-прежнему видит, а программа на переднем плане — нет.
// Страховка: если сочетание сработало, а опросчик нажатия не увидел, значит,
// оно прячет клавишу и от опросчика — снимаем его: жест правки важнее.
let comboAt = 0
function onEditCombo(): void {
  const now = Date.now()
  const fresh = now - comboAt > 600 // новое нажатие, а не автоповтор
  comboAt = now
  if (!fresh) return
  setTimeout(() => {
    if (editAccel && hotkeyHook.lastDownAt < now - 400) {
      console.warn('[dictation] Shift+клавиша не видна опросчику — снимаю', editAccel)
      globalShortcut.unregister(editAccel)
      editAccel = ''
    }
  }, 400)
}

function swallowEditCombo(): void {
  if (editAccel) globalShortcut.unregister(editAccel)
  editAccel = ''
  const a = cfg.enabled && cfg.editByVoice !== false ? editComboAccelerator(cfg.hotkey) : null
  if (a && globalShortcut.register(a, onEditCombo)) editAccel = a
}

export function applyDictationSettings(d: DictationSettings | undefined, v?: Vocab): void {
  cfg = { ...defaultDictation, ...d }
  vocab = v
  pruneDictationAudio()
  hotkeyHook.stop()
  if (cfg.enabled && hotkeyHook.setHotkey(cfg.hotkey)) {
    hotkeyHook.start()
  }
  swallowEditCombo()
}

export function stopDictation(): void {
  hotkeyHook.stop()
  globalShortcut.unregister('Escape')
  if (editAccel) globalShortcut.unregister(editAccel)
  editAccel = ''
}
