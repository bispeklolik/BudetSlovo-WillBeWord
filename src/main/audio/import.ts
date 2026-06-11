import { openSync, readSync, closeSync, createReadStream, createWriteStream, existsSync, unlinkSync, copyFileSync } from 'fs'
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

export interface ImportResult {
  prefixBytes: number
}

// Чинит контейнер при необходимости и ремуксит с faststart (moov в начало -->
// быстрый старт и точный seek). Результат: <destDir>\audio.m4a
export async function repairAndRemux(src: string, destDir: string): Promise<ImportResult> {
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
  const res = spawnSync(
    FFMPEG,
    ['-y', '-v', 'error', '-nostdin', '-i', work, '-c', 'copy', '-movflags', '+faststart', out],
    { windowsHide: true, encoding: 'utf8' }
  )
  if (res.status !== 0 || !existsSync(out)) {
    // Ремукс не удался (экзотический контейнер) — берём файл как есть.
    copyFileSync(work, out)
  }
  if (existsSync(tmp)) unlinkSync(tmp)
  return { prefixBytes }
}
