import { openSync, readSync, closeSync, createReadStream, createWriteStream, existsSync, unlinkSync } from 'fs'
import { spawnSync } from 'child_process'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { FFMPEG } from '../paths'

// Перенос с iPhone иногда добавляет мусорные байты перед боксом ftyp
// (наблюдалось: 2 байта \r\n) — из-за этого файл не открывается.
// Настоящий m4a начинается за 4 байта до сигнатуры 'ftyp' (поле размера бокса).
function findFtyp(path: string): number {
  const head = Buffer.alloc(260)
  const fd = openSync(path, 'r')
  const n = readSync(fd, head, 0, head.length, 0)
  closeSync(fd)
  for (let i = 0; i + 3 < n; i++) {
    if (head[i] === 0x66 && head[i + 1] === 0x74 && head[i + 2] === 0x79 && head[i + 3] === 0x70) {
      return i
    }
  }
  return -1
}

interface Probe {
  hasAudio: boolean
  hasVideo: boolean
}

// Определяем дорожки файла. `ffmpeg -i` без указания выхода печатает сведения о
// потоках в stderr и завершается с кодом 1 — это ожидаемо, парсим stderr.
// Обложку альбома ffmpeg помечает как Video ... (attached pic) — это не видео.
function probe(src: string): Probe {
  const res = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', '-i', src], {
    windowsHide: true,
    encoding: 'utf8'
  })
  const err = res.stderr || ''
  const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(err)
  const videoLines = err.match(/Stream #\d+:\d+.*: Video:[^\n]*/g) || []
  const hasVideo = videoLines.some((l) => !/attached pic/i.test(l))
  return { hasAudio, hasVideo }
}

export interface ImportResult {
  prefixBytes: number
  fromVideo: boolean
}

// Универсальная подготовка медиа: на входе аудио ИЛИ видео, на выходе всегда
// чистый <destDir>\audio.m4a (AAC + faststart: быстрый старт и точный seek).
// - чистое AAC-аудио → копируем дорожку без потерь (быстро);
// - прочее аудио (mp3/wav/flac/ogg…) и видео → извлекаем/перекодируем звук в AAC.
export async function repairAndRemux(
  src: string,
  destDir: string,
  onVideoExtract?: () => void
): Promise<ImportResult> {
  const { hasAudio, hasVideo } = probe(src)
  if (!hasAudio) {
    throw new Error('В файле нет звуковой дорожки — расшифровывать нечего.')
  }

  // Починка iPhone-префикса (срабатывает только если ftyp смещён мусором).
  const ftyp = findFtyp(src)
  let prefixBytes = 0
  let work = src
  const tmp = join(destDir, '_repaired.tmp.m4a')
  if (ftyp >= 6) {
    prefixBytes = ftyp - 4
    await pipeline(createReadStream(src, { start: prefixBytes }), createWriteStream(tmp))
    work = tmp
  }

  const out = join(destDir, 'audio.m4a')

  // Быстрый путь без потерь — только для чистого аудио (копия AAC-дорожки,
  // отбрасывая возможную обложку через -vn).
  let ok = false
  if (!hasVideo) {
    const r = spawnSync(
      FFMPEG,
      ['-y', '-v', 'error', '-nostdin', '-i', work, '-vn', '-c:a', 'copy', '-movflags', '+faststart', out],
      { windowsHide: true, encoding: 'utf8' }
    )
    ok = r.status === 0 && existsSync(out)
  }

  // Универсальный путь: извлечь/перекодировать звук в AAC (видео или не-AAC аудио).
  if (!ok) {
    if (hasVideo) onVideoExtract?.()
    const r = spawnSync(
      FFMPEG,
      [
        '-y', '-v', 'error', '-nostdin', '-i', work,
        '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out
      ],
      { windowsHide: true, encoding: 'utf8' }
    )
    if (r.status !== 0 || !existsSync(out)) {
      if (existsSync(tmp)) unlinkSync(tmp)
      throw new Error('Не удалось извлечь звук: ' + (r.stderr || 'ffmpeg error').slice(0, 300))
    }
  }

  if (existsSync(tmp)) unlinkSync(tmp)
  return { prefixBytes, fromVideo: hasVideo }
}
