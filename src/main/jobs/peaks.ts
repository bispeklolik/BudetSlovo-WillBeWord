import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { FFMPEG } from '../paths'

const SAMPLE_RATE = 16000

export interface PeaksResult {
  durationSec: number
}

// Декодирует аудио стримом (без загрузки в память) и складывает пары min/max
// в Int8 на каждый бакет. 50 бакетов/сек => ~1 МБ на 3 часа.
export function buildPeaks(audioPath: string, outPath: string, perSec = 50): Promise<PeaksResult> {
  const samplesPerBucket = Math.floor(SAMPLE_RATE / perSec)
  return new Promise((resolve, reject) => {
    const ff = spawn(
      FFMPEG,
      ['-v', 'error', '-nostdin', '-i', audioPath, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-'],
      { windowsHide: true }
    )
    const peaks: number[] = []
    let min = 127
    let max = -128
    let count = 0
    let total = 0
    let carry: Buffer | null = null

    ff.stdout.on('data', (chunk: Buffer) => {
      const buf = carry ? Buffer.concat([carry, chunk]) : chunk
      const usable = buf.length - (buf.length % 2)
      for (let i = 0; i < usable; i += 2) {
        const v = buf.readInt16LE(i) >> 8
        if (v < min) min = v
        if (v > max) max = v
        total++
        if (++count === samplesPerBucket) {
          peaks.push(min, max)
          min = 127
          max = -128
          count = 0
        }
      }
      carry = usable < buf.length ? Buffer.from(buf.subarray(usable)) : null
    })

    let err = ''
    ff.stderr.on('data', (d) => (err += String(d)))
    ff.on('error', reject)
    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('ffmpeg peaks failed: ' + err.slice(-400)))
        return
      }
      if (count > 0) peaks.push(min, max)
      writeFileSync(outPath, Buffer.from(Int8Array.from(peaks).buffer))
      resolve({ durationSec: total / SAMPLE_RATE })
    })
  })
}
