import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { DATA_DIR, TEMP_DIR } from '../paths'
import { ffmpegPath } from '../engine/location'
import { downloadFile } from '../engine/downloader'
import { linkKind, directFileName, ytDlpArgs, ytDlpPercent, shaFor, ytDlpError } from './parse'

// Импорт по ссылке (волна 5): YouTube, VK Видео, RuTube и сотни других сайтов —
// через yt-dlp (берём только звук); прямые ссылки на файл — качаем сами.
// yt-dlp не входит в установщик: скачивается один раз по согласию человека
// (≈18 МБ с GitHub, сумма SHA-256 проверяется) в папку данных.

const TOOLS = join(DATA_DIR, 'tools')
export const YTDLP = join(TOOLS, 'yt-dlp.exe')
const RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

export interface LinkProgress {
  phase: string
  percent: number | null
}

let current: { proc?: ChildProcess; ctrl: AbortController } | null = null

export function ytDlpInstalled(): boolean {
  return existsSync(YTDLP)
}

/** Скачать yt-dlp (только по согласию человека — кнопка в окне «По ссылке»). */
export async function installYtDlp(onProgress: (p: LinkProgress) => void): Promise<void> {
  if (current) throw new Error('Уже идёт загрузка — дождитесь её.')
  const ctrl = new AbortController()
  current = { ctrl }
  try {
    mkdirSync(TOOLS, { recursive: true })
    const sumsRes = await fetch(`${RELEASE}/SHA2-256SUMS`, { redirect: 'follow', signal: ctrl.signal })
    if (!sumsRes.ok) throw new Error(`GitHub не отдал список сумм (${sumsRes.status}).`)
    const sha = shaFor(await sumsRes.text(), 'yt-dlp.exe')
    if (!sha) throw new Error('В списке сумм нет yt-dlp.exe.')
    const tmp = YTDLP + '.download'
    await downloadFile(`${RELEASE}/yt-dlp.exe`, tmp, {
      sha256: sha,
      signal: ctrl.signal,
      onProgress: (p) => onProgress({ phase: 'Скачиваю yt-dlp', percent: p.total ? Math.round((p.done / p.total) * 100) : null })
    })
    renameSync(tmp, YTDLP)
  } finally {
    current = null
  }
}

export function cancelLinkImport(): void {
  current?.ctrl.abort()
  current?.proc?.kill()
}

/**
 * Скачать запись по ссылке во временную папку → путь к файлу и название.
 * Вызывающий импортирует файл и удаляет папку (dir).
 */
export async function downloadLink(
  url: string,
  onProgress: (p: LinkProgress) => void
): Promise<{ file: string; title: string; dir: string }> {
  const kind = linkKind(url)
  if (kind === 'bad') throw new Error('Это не ссылка. Нужна ссылка вида https://…')
  if (current) throw new Error('Уже идёт загрузка по ссылке — дождитесь её.')
  const ctrl = new AbortController()
  current = { ctrl }
  const dir = join(TEMP_DIR, 'link-' + Date.now().toString(36))
  mkdirSync(dir, { recursive: true })
  try {
    if (kind === 'direct') {
      const name = directFileName(url)
      const file = join(dir, name)
      onProgress({ phase: 'Скачиваю файл', percent: 0 })
      await downloadFile(url.trim(), file, {
        signal: ctrl.signal,
        onProgress: (p) => onProgress({ phase: 'Скачиваю файл', percent: p.total ? Math.round((p.done / p.total) * 100) : null })
      })
      return { file, title: name.replace(/\.[^.]+$/, ''), dir }
    }
    if (!ytDlpInstalled()) throw new Error('YTDLP_MISSING')
    const out = await new Promise<{ file: string; title: string }>((resolve, reject) => {
      const p = spawn(YTDLP, ytDlpArgs(url, dir, ffmpegPath()), { windowsHide: true })
      current!.proc = p
      let stdout = ''
      let stderr = ''
      p.stdout.setEncoding('utf8')
      p.stderr.setEncoding('utf8')
      p.stdout.on('data', (s: string) => {
        stdout += s
        for (const line of s.split('\n')) {
          const pct = ytDlpPercent(line)
          if (pct !== null) onProgress({ phase: 'Скачиваю звук', percent: Math.round(pct) })
        }
      })
      p.stderr.on('data', (s: string) => (stderr += s))
      p.on('error', (e) => reject(new Error('Не удалось запустить yt-dlp: ' + e.message)))
      p.on('close', (code) => {
        if (ctrl.signal.aborted) return reject(new Error('Отменено.'))
        // Путь и название — последние строки, которые печатает --print.
        const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('['))
        const file = lines.find((l) => existsSync(l) && statSync(l).isFile()) ?? findMedia(dir)
        if (code !== 0 || !file) return reject(new Error(ytDlpError(stderr)))
        const title = lines[lines.length - 1] && lines[lines.length - 1] !== file ? lines[lines.length - 1] : ''
        resolve({ file, title })
      })
    })
    return { ...out, dir }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  } finally {
    current = null
  }
}

function findMedia(dir: string): string | undefined {
  const f = readdirSync(dir).find((n) => !n.endsWith('.part') && !n.endsWith('.ytdl'))
  return f ? join(dir, f) : undefined
}
