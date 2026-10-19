import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { networkInterfaces } from 'os'
import { createWriteStream, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { TEMP_DIR } from '../paths'
import { lanAddresses, safeFileName, sameToken } from './lan'
import { phonePage } from './page'

// Приём записи с телефона по QR (волна 5). На время окна «С телефона» в
// домашней сети поднимается маленький сервер: телефон открывает страницу по
// QR-коду, выбирает файл диктофона — файл приходит прямо на компьютер, без
// облака. Адрес содержит случайный ключ; сервер сам гаснет через 30 минут
// бездействия или когда окно закрыли.

const MAX_BYTES = 4 * 1024 ** 3
const IDLE_MS = 30 * 60_000

let server: Server | null = null
let token = ''
let idleTimer: ReturnType<typeof setTimeout> | null = null

export interface PhoneSession {
  urls: string[]
  port: number
}

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(stopPhoneUpload, IDLE_MS)
}

function send(res: ServerResponse, code: number, body: string, type = 'application/json; charset=utf-8'): void {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

/**
 * onFile — импорт пришедшего файла (вызывающий удаляет временный файл сам не
 * должен: сервер уберёт его после импорта). Возвращает название записи.
 */
export async function startPhoneUpload(
  onFile: (path: string, name: string) => Promise<string>,
  host = process.env['SLOVO_PHONE_HOST'] || '0.0.0.0'
): Promise<PhoneSession> {
  stopPhoneUpload()
  token = randomBytes(16).toString('hex')
  const srv = createServer((req, res) => void handle(req, res, onFile))
  // По умолчанию Node обрывает запрос через 5 минут — час видео с телефона по
  // Wi-Fi не успевал дойти (ревью волны 5). Ограничиваем бездействием, не длиной.
  srv.requestTimeout = 0
  srv.setTimeout(120_000)
  server = srv
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(0, host, () => resolve())
  })
  touch()
  const port = (srv.address() as { port: number }).port
  const ips = host === '0.0.0.0' ? lanAddresses(networkInterfaces()) : [host]
  return { urls: ips.map((ip) => `http://${ip}:${port}/u/${token}`), port }
}

export function stopPhoneUpload(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  server?.close()
  server?.closeAllConnections?.()
  server = null
  token = ''
}

export function phoneActive(): boolean {
  return server !== null
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  onFile: (path: string, name: string) => Promise<string>
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x')
  const m = /^\/u\/([0-9a-f]+)(\/file)?$/.exec(url.pathname)
  if (!m || !token || !sameToken(m[1], token)) return send(res, 404, 'Not found', 'text/plain')
  touch()

  if (!m[2] && req.method === 'GET') return send(res, 200, phonePage(), 'text/html; charset=utf-8')

  if (m[2] && req.method === 'POST') {
    const name = safeFileName(url.searchParams.get('name') ?? '')
    if (!name) return send(res, 400, JSON.stringify({ error: 'Это не похоже на аудио или видео.' }))
    mkdirSync(TEMP_DIR, { recursive: true })
    const dir = join(TEMP_DIR, 'phone-' + Date.now().toString(36) + randomBytes(3).toString('hex'))
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, name)
    let bytes = 0
    let tooBig = false
    const out = createWriteStream(dest)
    try {
      await new Promise<void>((resolve, reject) => {
        req.on('data', (c: Buffer) => {
          bytes += c.length
          touch() // идёт передача — не гасить сервер по бездействию
          if (bytes > MAX_BYTES && !tooBig) {
            tooBig = true
            req.destroy()
            reject(new Error('Файл больше 4 ГБ.'))
          }
        })
        req.on('aborted', () => reject(new Error('Передача прервалась.')))
        req.on('error', reject)
        out.on('error', reject)
        out.on('finish', () => resolve())
        req.pipe(out)
      })
      if (bytes === 0) throw new Error('Пустой файл.')
      const title = await onFile(dest, name)
      send(res, 200, JSON.stringify({ ok: true, title }))
    } catch (err) {
      out.destroy()
      if (!res.headersSent && !res.destroyed)
        send(res, 500, JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    return
  }
  send(res, 405, 'Method not allowed', 'text/plain')
}
