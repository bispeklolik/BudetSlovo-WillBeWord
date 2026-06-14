import { protocol, net } from 'electron'
import { existsSync } from 'fs'
import { pathToFileURL } from 'url'

// Вызывается ДО app.whenReady — иначе схема не получит привилегии.
// corsEnabled + ACAO ниже нужны, чтобы renderer мог fetch() этот ресурс в Blob.
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { stream: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

// media://audio/<slug> -> <projects>/<slug>/audio.m4a
// Renderer вычитывает ответ целиком в Blob и проигрывает из него (seek в любую
// точку). Поэтому отдаём весь файл (200) и разрешаем CORS.
export function installMediaProtocol(resolvePath: (url: URL) => string | null): void {
  protocol.handle('media', async (req) => {
    const url = new URL(req.url)
    const fp = resolvePath(url)
    if (!fp || !existsSync(fp)) return new Response('not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(fp).toString())
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })
}
