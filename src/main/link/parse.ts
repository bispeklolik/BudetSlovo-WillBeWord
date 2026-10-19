// Импорт по ссылке (волна 5): чистые помощники — что за ссылка, разбор вывода
// yt-dlp и контрольных сумм. Под тестами.

const DIRECT = /\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|mp4|mov|webm|mkv|m4v)$/i

export type LinkKind = 'direct' | 'site' | 'bad'

/** Прямая ссылка на файл — качаем сами; страница сайта — через yt-dlp. */
export function linkKind(raw: string): LinkKind {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return 'bad'
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'bad'
  return DIRECT.test(u.pathname) ? 'direct' : 'site'
}

/** Имя файла из прямой ссылки (для названия записи). */
export function directFileName(raw: string): string {
  const u = new URL(raw.trim())
  const base = decodeURIComponent(u.pathname.split('/').pop() ?? '').replace(/[<>:"|?*\\/\u0000-\u001f]/g, '_')
  return base || 'запись.mp3'
}

/** Строка вывода yt-dlp → процент загрузки (или null). */
export function ytDlpPercent(line: string): number | null {
  const m = /\[download\]\s+([\d.]+)%/.exec(line)
  return m ? Math.min(100, Number(m[1])) : null
}

/** Аргументы yt-dlp: только звук, без плейлистов, файл в папку out, путь — в stdout. */
export function ytDlpArgs(url: string, outDir: string, ffmpeg: string): string[] {
  return [
    '-f', 'bestaudio/best',
    '--no-playlist',
    '--newline',
    // --print включает тихий режим: без --progress не было бы процентов;
    // без --encoding русское название приходило в кодировке Windows (ревью волны 5).
    '--progress',
    '--encoding', 'utf-8',
    '--no-mtime',
    '--restrict-filenames',
    '--ffmpeg-location', ffmpeg,
    '-o', `${outDir}/%(title).80s.%(ext)s`,
    '--print', 'after_move:filepath',
    '--print', 'after_move:title',
    url.trim()
  ]
}

/** SHA2-256SUMS релиза yt-dlp → сумма нужного файла. */
export function shaFor(sums: string, file: string): string | null {
  for (const line of sums.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (m && m[2].trim() === file) return m[1].toLowerCase()
  }
  return null
}

/** Понятная причина по хвосту ошибки yt-dlp. */
export function ytDlpError(stderr: string): string {
  const s = stderr.toLowerCase()
  if (s.includes('private video') || s.includes('sign in') || s.includes('login required'))
    return 'Видео закрыто или нужен вход в аккаунт — скачайте файл сами и импортируйте.'
  if (s.includes('not available in your country') || s.includes('geo')) return 'Видео недоступно в вашей стране.'
  if (s.includes('unsupported url')) return 'Этот сайт не поддерживается. Нужна ссылка на видео или аудио.'
  if (s.includes('deno') || s.includes('javascript runtime') || s.includes('js runtime'))
    return 'Для этого сайта yt-dlp нужна ещё программа Deno. Пока скачайте запись сами и импортируйте файл.'
  if (s.includes('unable to download') || s.includes('http error')) return 'Сайт не отдал видео. Проверьте ссылку и интернет.'
  const last = stderr.trim().split('\n').filter(Boolean).pop() ?? ''
  return last.replace(/^ERROR:\s*/i, '').slice(0, 300) || 'yt-dlp не смог скачать запись.'
}
