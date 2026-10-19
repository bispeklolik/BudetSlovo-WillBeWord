import { desktopCapturer, session } from 'electron'
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  type WriteStream
} from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../paths'
import { createProjectFromCall } from '../project/store'
import { TEMP_DIR } from '../paths'
import { hasAudio, tailMix } from './ffmpeg'
import type { ProjectMeta } from '../../shared/types'

// Запись звонка: renderer пишет две дорожки (микрофон и звук компьютера через
// loopback Chromium — без нативных модулей, как запасной путь OpenWhispr) и
// шлёт куски каждые 2 с — они сразу ложатся на диск. Сбой посреди звонка
// теряет максимум пару секунд; при следующем запуске запись собирается сама.

const CALLS_DIR = join(DATA_DIR, 'calls')
const streams = new Map<string, WriteStream>()
let active: string | null = null
let openedAt = 0
let onWriteError: (message: string) => void = () => {}

export function isCallActive(): boolean {
  return active !== null
}

/** Куда сообщить, что запись на диск сломалась (диск полон, папку убрал антивирус). */
export function setCallWriteErrorHandler(fn: (message: string) => void): void {
  onWriteError = fn
}

/** Разрешить getDisplayMedia из нашего окна: экран (дорожку видео renderer сразу
 *  глушит) + звук компьютера 'loopback'. Loopback есть только в Windows. */
export function registerCallCapture(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      if (sources.length) cb({ video: sources[0], audio: 'loopback' })
      else cb({})
    } catch {
      cb({})
    }
  })
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '')
}

export function openCall(id: string): void {
  const sid = safeId(id)
  // Вторая запись поверх первой не начинается: прежнюю закрываем (файлы
  // остаются и соберутся восстановлением).
  if (active && active !== sid) abandonActiveCall()
  const dir = join(CALLS_DIR, sid)
  mkdirSync(dir, { recursive: true })
  for (const kind of ['mic', 'sys'] as const) {
    const ws = createWriteStream(join(dir, `${kind}.webm`), { flags: 'a' })
    // Без обработчика ошибка записи (диск полон, EPERM) роняла бы главный процесс.
    ws.on('error', (err) => {
      streams.delete(sid + kind)
      onWriteError(`Не получается записывать звонок на диск: ${err.message}. Остановите запись — сохранится то, что уже записано.`)
    })
    streams.set(sid + kind, ws)
  }
  if (active !== sid) openedAt = Date.now()
  active = sid
}

export function writeChunk(id: string, kind: string, data: ArrayBuffer): void {
  if (kind !== 'mic' && kind !== 'sys') return
  const ws = streams.get(safeId(id) + kind)
  if (ws && !ws.destroyed) ws.write(Buffer.from(data))
}

async function closeStreams(sid: string): Promise<void> {
  for (const kind of ['mic', 'sys']) {
    const s = streams.get(sid + kind)
    streams.delete(sid + kind)
    if (s && !s.destroyed) await new Promise<void>((r) => s.end(() => r()))
  }
  if (active === sid) active = null
}

/**
 * Окно перезагрузилось или упало посреди записи: закрыть файлы активной записи
 * (они остаются для восстановления) и снять «идёт запись», иначе диктовка и
 * подсказка о звонке молчали бы до перезапуска приложения.
 */
export function abandonActiveCall(): boolean {
  if (!active) return false
  const sid = active
  for (const kind of ['mic', 'sys']) {
    const s = streams.get(sid + kind)
    streams.delete(sid + kind)
    if (s && !s.destroyed) s.end()
  }
  active = null
  return true
}

/** Мои заметки во время звонка — сразу на диск: при сбое они соберутся вместе с записью. */
export function saveCallNotes(id: string, text: string): void {
  const dir = join(CALLS_DIR, safeId(id))
  if (!existsSync(dir)) return
  try {
    writeFileSync(join(dir, 'notes.txt'), text, 'utf8')
  } catch {
    /* заметки не критичны: финальный текст придёт с «Остановить» */
  }
}

/**
 * «Что я пропустил?»: последние minutes минут идущей записи — обе дорожки
 * сведены в один m4a во временной папке (вызывающий удаляет файл сам).
 * Файлы пишутся прямо сейчас — работаем с их копией.
 */
export async function missedAudio(id: string, minutes: number): Promise<string> {
  const sid = safeId(id)
  if (active !== sid) throw new Error('Запись звонка не идёт.')
  const dir = join(CALLS_DIR, sid)
  const stamp = Date.now().toString(36)
  const tmp = join(TEMP_DIR, `missed-${stamp}`)
  mkdirSync(tmp, { recursive: true })
  const inputs: string[] = []
  for (const kind of ['mic', 'sys']) {
    const src = join(dir, `${kind}.webm`)
    if (!hasAudio(src)) continue
    const copy = join(tmp, `${kind}.webm`)
    copyFileSync(src, copy)
    inputs.push(copy)
  }
  if (!inputs.length) {
    rmSync(tmp, { recursive: true, force: true })
    throw new Error('В записи пока нет звука.')
  }
  const elapsed = (Date.now() - openedAt) / 1000
  const start = Math.max(0, elapsed - minutes * 60 - 5)
  const dest = join(TEMP_DIR, `missed-${stamp}.m4a`)
  try {
    await tailMix(inputs, start, dest)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return dest
}

export async function finishCall(
  id: string,
  opts: { title: string; names: [string, string]; app?: string; myNotes?: string }
): Promise<ProjectMeta> {
  const sid = safeId(id)
  await closeStreams(sid)
  const dir = join(CALLS_DIR, sid)
  const meta = await createProjectFromCall(dir, opts)
  // Не смогли убрать исходники (заняты) — не беда: проект уже собран.
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* уберём при следующем восстановлении */
  }
  return meta
}

export async function cancelCall(id: string): Promise<void> {
  const sid = safeId(id)
  await closeStreams(sid)
  rmSync(join(CALLS_DIR, sid), { recursive: true, force: true })
}

/**
 * Записи, прерванные сбоем или закрытием приложения посреди звонка: собрать в
 * проекты «Звонок (восстановлен)». Не терять разговор — главное правило.
 */
export async function recoverCalls(names: [string, string]): Promise<ProjectMeta[]> {
  if (!existsSync(CALLS_DIR)) return []
  const out: ProjectMeta[] = []
  for (const sid of readdirSync(CALLS_DIR)) {
    if (sid === active) continue
    const dir = join(CALLS_DIR, sid)
    if (!hasAudio(join(dir, 'mic.webm')) && !hasAudio(join(dir, 'sys.webm'))) {
      rmSync(dir, { recursive: true, force: true })
      continue
    }
    try {
      out.push(await createProjectFromCall(dir, { title: 'Звонок (восстановлен)', names }))
      rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      console.error('[calls] recover failed', sid, err)
    }
  }
  return out
}
