import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash, randomBytes } from 'crypto'
import { downloadFile } from './downloader'

// Тестовый сервер: отдаёт 3 МБ случайных байт, понимает Range. Режим «рвать»:
// после ~700 КБ на каждый ответ обрывает соединение — так проверяем докачку.
const DATA = randomBytes(3 * 1024 * 1024)
const SHA = createHash('sha256').update(DATA).digest('hex')
let server: Server
let base = ''
let breakAfter = 0
let requests = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    requests++
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/file' })
      res.end()
      return
    }
    if (req.url === '/norange') {
      res.writeHead(200, { 'Content-Length': DATA.length })
      res.end(DATA)
      return
    }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
    let start = 0
    let end = DATA.length - 1
    if (range) {
      start = Number(range[1])
      if (range[2]) end = Number(range[2])
      res.writeHead(206, {
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${DATA.length}`,
        'Accept-Ranges': 'bytes'
      })
    } else {
      res.writeHead(200, { 'Content-Length': DATA.length, 'Accept-Ranges': 'bytes' })
    }
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const chunk = DATA.subarray(start, end + 1)
    if (breakAfter > 0 && chunk.length > breakAfter) {
      res.write(chunk.subarray(0, breakAfter))
      setTimeout(() => res.destroy(), 20)
      return
    }
    res.end(chunk)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
})

afterAll(() => {
  server.close()
})

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'slovo-dl-'))
}

describe('downloadFile', () => {
  it('качает частями и собирает точную копию (sha256 сверен)', async () => {
    breakAfter = 0
    const dir = tmp()
    const dest = join(dir, 'model.bin')
    const seen: number[] = []
    await downloadFile(`${base}/file`, dest, { segments: 4, sha256: SHA, onProgress: (p) => seen.push(p.done) })
    expect(createHash('sha256').update(readFileSync(dest)).digest('hex')).toBe(SHA)
    expect(seen.at(-1)).toBe(DATA.length)
    // за собой не оставляет кусков и файла состояния
    expect(readdirSync(dir)).toEqual(['model.bin'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('обрывы соединения не мешают: докачивает с места обрыва', async () => {
    breakAfter = 700 * 1024
    const dir = tmp()
    const dest = join(dir, 'big.7z')
    await downloadFile(`${base}/file`, dest, { segments: 2, sha256: SHA, retryDelayMs: 10 })
    expect(createHash('sha256').update(readFileSync(dest)).digest('hex')).toBe(SHA)
    breakAfter = 0
    rmSync(dir, { recursive: true, force: true })
  })

  it('отмена сохраняет куски, повторный запуск продолжает, а не начинает заново', async () => {
    breakAfter = 0
    const dir = tmp()
    const dest = join(dir, 'm.bin')
    const ctrl = new AbortController()
    let firstDone = 0
    await expect(
      downloadFile(`${base}/file`, dest, {
        segments: 2,
        signal: ctrl.signal,
        chunkThrottleMs: 5,
        progressIntervalMs: 0,
        onProgress: (p) => {
          firstDone = p.done
          if (p.done > 1024 * 1024) ctrl.abort()
        }
      })
    ).rejects.toThrow()
    expect(existsSync(dest)).toBe(false)
    expect(readdirSync(dir).some((f) => f.includes('.part'))).toBe(true)
    let startedFrom = -1
    await downloadFile(`${base}/file`, dest, {
      segments: 2,
      sha256: SHA,
      onProgress: (p) => {
        if (startedFrom < 0) startedFrom = p.done
      }
    })
    expect(startedFrom).toBeGreaterThan(0)
    expect(firstDone).toBeGreaterThan(0)
    expect(createHash('sha256').update(readFileSync(dest)).digest('hex')).toBe(SHA)
    rmSync(dir, { recursive: true, force: true })
  })

  it('неверная контрольная сумма — ошибка и битый файл удалён', async () => {
    breakAfter = 0
    const dir = tmp()
    const dest = join(dir, 'x.bin')
    await expect(downloadFile(`${base}/file`, dest, { sha256: 'deadbeef' })).rejects.toThrow(/повреждён/)
    expect(existsSync(dest)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('сервер без докачки — качает одним потоком', async () => {
    const dir = tmp()
    const dest = join(dir, 'n.bin')
    await downloadFile(`${base}/norange`, dest, { segments: 4, sha256: SHA })
    expect(readFileSync(dest).length).toBe(DATA.length)
    rmSync(dir, { recursive: true, force: true })
  })

  it('идёт по редиректу (GitHub/HF отдают ссылку на CDN)', async () => {
    const dir = tmp()
    const dest = join(dir, 'r.bin')
    requests = 0
    await downloadFile(`${base}/redirect`, dest, { segments: 2, sha256: SHA })
    expect(requests).toBeGreaterThan(1)
    rmSync(dir, { recursive: true, force: true })
  })
})
