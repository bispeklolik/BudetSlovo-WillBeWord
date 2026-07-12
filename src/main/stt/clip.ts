import { spawn, spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ENGINE_DIR, ENGINE_EXE, FFMPEG, MODELS_DIR, STT_TEMP } from '../paths'
import { engineEnv } from '../jobs/transcribe'
import { loadSettings } from '../settings'
import { CLOUD_RUN } from './index'

// Голосовая правка: короткий клип с микрофона (webm из MediaRecorder) → текст.
// Облачный движок (если выбран и есть ключ) — быстро; иначе локальный Whisper
// (медленнее: модель загружается на каждый клип). Возвращает плоский текст.

async function localClipText(m4a: string, outDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Без диаризации и чистки — клип короткий, надиктован одним голосом в упор.
    const args = [
      m4a,
      '--model', 'large-v3',
      '--model_dir', MODELS_DIR,
      '--language', 'ru',
      '--compute_type', 'float16',
      '--beam_size', '5',
      '--condition_on_previous_text', 'False',
      '--output_dir', outDir,
      '--output_format', 'json',
      '--beep_off'
    ]
    const child = spawn(ENGINE_EXE, args, { cwd: ENGINE_DIR, env: engineEnv(), windowsHide: true })
    child.on('error', (err) => reject(new Error('Не удалось запустить движок: ' + err.message)))
    child.on('close', () => {
      // Успех — по наличию результата, не по коду (движок может падать на teardown).
      try {
        const base = m4a.replace(/\\/g, '/').split('/').pop()!.replace(/\.m4a$/, '')
        const data = JSON.parse(readFileSync(join(outDir, base + '.json'), 'utf8')) as {
          segments?: { text?: string }[]
        }
        const text = (data.segments ?? [])
          .map((s) => (s.text ?? '').trim())
          .filter(Boolean)
          .join(' ')
        resolve(text)
      } catch {
        reject(new Error('Движок не вернул результат по клипу.'))
      }
    })
  })
}

export async function transcribeClip(webm: Buffer): Promise<string> {
  mkdirSync(STT_TEMP, { recursive: true })
  const stamp = Date.now().toString(36)
  const src = join(STT_TEMP, `clip-${stamp}.webm`)
  const m4a = join(STT_TEMP, `clip-${stamp}.m4a`)
  const outDir = join(STT_TEMP, `clip-${stamp}-out`)
  writeFileSync(src, webm)
  try {
    const ff = spawnSync(FFMPEG, ['-y', '-i', src, '-ac', '1', '-b:a', '48k', '-vn', m4a], {
      windowsHide: true
    })
    if (ff.status !== 0 || !existsSync(m4a)) throw new Error('Не удалось обработать запись микрофона (ffmpeg).')

    const settings = loadSettings()
    const engineId = settings.sttEngine ?? 'local'
    const key = (settings.sttKeys?.[engineId] ?? '').trim()
    if (engineId !== 'local' && CLOUD_RUN[engineId] && key) {
      const result = await CLOUD_RUN[engineId](m4a, key, () => {})
      return result.turns
        .flatMap((t) => t.words.map((w) => w.t))
        .join(' ')
        .trim()
    }
    return (await localClipText(m4a, outDir)).trim()
  } finally {
    rmSync(src, { force: true })
    rmSync(m4a, { force: true })
    rmSync(outDir, { recursive: true, force: true })
  }
}
