import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { ffmpegPath } from '../engine/location'

// Небольшие операции ffmpeg для записи звонков и расшифровки куска файла.

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], {
      windowsHide: true
    })
    let err = ''
    p.stderr.setEncoding('utf8')
    p.stderr.on('data', (s: string) => (err += s))
    p.on('error', (e) => reject(e))
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg (${code}): ${err.slice(-300)}`))))
  })
}

/** Файл есть и в нём больше пары килобайт (пустая дорожка webm весит ~200 байт). */
export function hasAudio(path: string): boolean {
  return existsSync(path) && statSync(path).size > 4096
}

/** Одна дорожка → моно m4a (для распознавания и хранения). */
export function toMonoM4a(src: string, dest: string): Promise<void> {
  return runFfmpeg(['-i', src, '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', dest])
}

/**
 * Две дорожки → одна для прослушивания. normalize=0: без него amix делит
 * громкость на число входов (грабли Vibe 3.1.2); alimiter страхует от клиппинга;
 * aresample=async выравнивает дрейф между двумя рекордерами.
 */
export function mixTwo(a: string, b: string, dest: string): Promise<void> {
  return runFfmpeg([
    '-i', a,
    '-i', b,
    '-filter_complex',
    '[0:a]aresample=async=1[a0];[1:a]aresample=async=1[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]',
    '-map', '[a]',
    '-ac', '2',
    '-c:a', 'aac',
    '-b:a', '128k',
    dest
  ])
}

/**
 * Хвост идущей записи (от startSec до конца) из одной или двух дорожок → моно
 * m4a. Дорожки ещё пишутся, конец файла может быть оборван — если ffmpeg
 * ругается на конец, но звук получился, это не ошибка.
 */
export async function tailMix(inputs: string[], startSec: number, dest: string): Promise<void> {
  const s = Math.max(0, startSec).toFixed(2)
  const trims = inputs.map((_, i) => `[${i}:a]atrim=start=${s},asetpts=PTS-STARTPTS,aresample=async=1[a${i}]`)
  const mix =
    inputs.length > 1
      ? `${inputs.map((_, i) => `[a${i}]`).join('')}amix=inputs=${inputs.length}:duration=longest:normalize=0,alimiter=limit=0.95[a]`
      : '[a0]anull[a]'
  const args = [
    ...inputs.flatMap((f) => ['-i', f]),
    '-filter_complex', [...trims, mix].join(';'),
    '-map', '[a]',
    '-ac', '1',
    '-c:a', 'aac',
    '-b:a', '64k',
    dest
  ]
  try {
    await runFfmpeg(args)
  } catch (err) {
    if (!(existsSync(dest) && statSync(dest).size > 2048)) throw err
  }
}

/** Кусок записи «с — по» с перекодированием (точный рез, а не по ключевым кадрам). */
export function trimAudio(src: string, dest: string, startSec: number, endSec: number): Promise<void> {
  const start = Math.max(0, startSec)
  return runFfmpeg([
    '-ss', String(start),
    '-i', src,
    '-t', String(Math.max(0.5, endSec - start)),
    '-vn',
    '-c:a', 'aac',
    '-b:a', '128k',
    dest
  ])
}
