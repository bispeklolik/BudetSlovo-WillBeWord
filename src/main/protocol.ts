import { protocol } from 'electron'
import { createReadStream, existsSync, statSync } from 'fs'
import { Readable } from 'stream'

// Вызывается ДО app.whenReady — иначе схема не получит stream-привилегии.
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { stream: true, supportFetchAPI: true } }
  ])
}

// media://audio/<slug>  ->  <projects>/<slug>/audio.m4a
// Range отдаём вручную — это гарантирует мгновенный seek в больших файлах
// независимо от версии Electron.
export function installMediaProtocol(resolvePath: (url: URL) => string | null): void {
  protocol.handle('media', async (req) => {
    const url = new URL(req.url)
    const fp = resolvePath(url)
    if (!fp || !existsSync(fp)) return new Response('not found', { status: 404 })

    const size = statSync(fp).size
    const type = 'audio/mp4'
    const range = req.headers.get('range')

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      let start = m && m[1] ? parseInt(m[1], 10) : 0
      let end = m && m[2] ? parseInt(m[2], 10) : size - 1
      if (Number.isNaN(start) || start < 0) start = 0
      if (Number.isNaN(end) || end >= size) end = size - 1
      if (start > end) return new Response('bad range', { status: 416 })
      const stream = Readable.toWeb(createReadStream(fp, { start, end })) as ReadableStream
      return new Response(stream, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1)
        }
      })
    }

    const stream = Readable.toWeb(createReadStream(fp)) as ReadableStream
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(size)
      }
    })
  })
}
