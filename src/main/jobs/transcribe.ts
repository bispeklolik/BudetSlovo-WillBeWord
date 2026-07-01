import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { ENGINE_EXE, ENGINE_DIR, MODELS_DIR, STT_TEMP } from '../paths'
import { projectDir, getProject, saveProject } from '../project/store'
import { mergeEngineOutputs } from '../project/merge'
import { loadSettings } from '../settings'
import { transcribeWithDeepgram } from '../stt/deepgram'
import type { JobInfo } from '../../shared/types'

const procs = new Map<string, ChildProcess>()

export function killJobProcess(jobId: string): void {
  const p = procs.get(jobId)
  if (p?.pid) {
    spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true })
  }
}

// Результат готов, если записан непустой audio.json. Движок (PyInstaller+CUDA)
// иногда падает на teardown с кодом 0xC0000409 уже ПОСЛЕ записи всех файлов —
// такой результат полноценен, и выбрасывать его нельзя.
function outputsValid(engineOut: string): boolean {
  try {
    const data = JSON.parse(readFileSync(join(engineOut, 'audio.json'), 'utf8'))
    return Array.isArray(data.segments) && data.segments.length > 0
  } catch {
    return false
  }
}

function engineEnv(): NodeJS.ProcessEnv {
  // Все кэши движка строго на D: — тот же набор, что в проверенном Transcribe.ps1.
  return {
    ...process.env,
    HF_HOME: 'D:\\STT\\models\\hf',
    HUGGINGFACE_HUB_CACHE: 'D:\\STT\\models\\hf\\hub',
    TORCH_HOME: 'D:\\STT\\models\\torch',
    XDG_CACHE_HOME: 'D:\\STT\\models\\cache',
    PYANNOTE_CACHE: 'D:\\STT\\models\\pyannote',
    TEMP: STT_TEMP,
    TMP: STT_TEMP
  }
}

function parseTimecodeSec(tc: string): number {
  const parts = tc.split(':')
  let sec = 0
  for (const p of parts) sec = sec * 60 + parseFloat(p.replace(',', '.'))
  return sec
}

async function runDeepgram(
  job: JobInfo,
  emit: (patch: Partial<JobInfo>) => void
): Promise<void> {
  const key = (loadSettings().deepgramKey ?? '').trim()
  if (!key) throw new Error('Не указан ключ Deepgram — вставьте его в Настройках.')
  const audio = join(projectDir(job.slug), 'audio.m4a')
  if (!existsSync(audio)) throw new Error('Аудио не найдено: ' + audio)

  emit({ phase: 'Отправка в Deepgram', percent: null })
  const result = await transcribeWithDeepgram(audio, key)
  // ponytail: облачную задачу нельзя прервать на середине запроса — если за это
  // время нажали «отмена», просто не сохраняем результат.
  if (job.cancelRequested) return

  emit({ phase: 'Сохранение результата', percent: null })
  const fresh = getProject(job.slug)
  if (fresh) {
    fresh.transcription = { numSpeakers: job.options?.numSpeakers ?? 2, enhance: false }
    fresh.engine = { model: 'deepgram:nova-2', completedAt: new Date().toISOString() }
    fresh.speakers = result.speakers
    fresh.turns = result.turns
    saveProject(fresh)
  }
}

export function runTranscribe(
  job: JobInfo,
  emit: (patch: Partial<JobInfo>) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const meta = getProject(job.slug)
    if (!meta) {
      reject(new Error('Проект не найден: ' + job.slug))
      return
    }

    // Облачный движок: не спавним локальный exe, а грузим аудио в Deepgram.
    if (loadSettings().sttEngine === 'deepgram') {
      runDeepgram(job, emit).then(resolve, reject)
      return
    }

    if (!existsSync(ENGINE_EXE)) {
      reject(new Error('Движок не найден: ' + ENGINE_EXE))
      return
    }

    const dir = projectDir(job.slug)
    const engineOut = join(dir, 'engine')
    mkdirSync(engineOut, { recursive: true })
    mkdirSync(STT_TEMP, { recursive: true })

    const audio = join(dir, 'audio.m4a')
    const durationSec = meta.audio.durationSec || 0

    const args = [
      audio,
      '--model', 'large-v3',
      '--model_dir', MODELS_DIR,
      '--language', 'ru',
      '--compute_type', 'float16',
      '--beam_size', '5',
      '--vad_filter', 'True',
      // Не переносить контекст между сегментами: иначе одна ошибка на трудном
      // участке отравляет последующие и модель сваливается в бред (англ. мусор).
      '--condition_on_previous_text', 'False',
      '--diarize', 'pyannote_v3.1',
      '--output_dir', engineOut,
      '--output_format', 'txt', 'srt', 'json',
      '--beep_off'
    ]
    const n = job.options?.numSpeakers ?? 2
    if (n > 0) args.push('--num_speakers', String(n))
    if (job.options?.enhance !== false) {
      args.push('--ff_loudnorm', '--ff_lowhighpass', '--ff_fftdn', '10')
    }

    const log = createWriteStream(join(dir, 'job.log'), { flags: 'w' })
    log.write(`[slovo] ${new Date().toISOString()}\n[slovo] ${ENGINE_EXE}\n[slovo] args: ${args.join(' ')}\n\n`)

    const startedAt = Date.now()
    const child = spawn(ENGINE_EXE, args, {
      cwd: ENGINE_DIR,
      env: engineEnv(),
      windowsHide: true
    })
    procs.set(job.id, child)

    let lineBuf = ''
    const segRe = /-->\s*([0-9:.,]+)\]/
    const onLine = (line: string): void => {
      if (line.includes('Audio filtering')) {
        emit({ phase: 'Чистка звука', percent: null })
      } else if (line.includes('Diarizing')) {
        emit({ phase: 'Разделение говорящих', percent: null })
      } else if (line.includes('faster-whisper inference')) {
        emit({ phase: 'Распознавание', percent: 0 })
      } else if (line.includes('Subtitles are written') || line.includes('Transcription speed')) {
        emit({ phase: 'Сохранение результата', percent: null })
      } else {
        const m = segRe.exec(line)
        if (m && durationSec > 0) {
          const sec = parseTimecodeSec(m[1])
          const pct = Math.max(0, Math.min(99, Math.round((sec / durationSec) * 100)))
          emit({ phase: 'Распознавание', percent: pct })
        }
      }
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      log.write(chunk)
      lineBuf += chunk
      let idx: number
      while ((idx = lineBuf.indexOf('\n')) >= 0) {
        onLine(lineBuf.slice(0, idx))
        lineBuf = lineBuf.slice(idx + 1)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      log.write(chunk)
    })

    child.on('error', (err) => {
      procs.delete(job.id)
      log.end()
      reject(new Error('Не удалось запустить движок: ' + err.message))
    })

    child.on('close', (code) => {
      procs.delete(job.id)
      const elapsed = Date.now() - startedAt

      if (job.cancelRequested) {
        log.end()
        resolve()
        return
      }

      // Успех = записан валидный результат (код выхода вторичен: движок может
      // упасть на завершении уже после записи файлов).
      if (outputsValid(engineOut)) {
        if (code !== 0) {
          log.write(
            `\n[slovo] движок вышел с кодом ${code}, но результат записан полностью — считаем успехом\n`
          )
        }
        const fresh = getProject(job.slug)
        if (fresh) {
          fresh.transcription = { numSpeakers: n, enhance: job.options?.enhance !== false }
          fresh.engine = { model: 'large-v3', completedAt: new Date().toISOString() }
          try {
            const merged = mergeEngineOutputs(job.slug)
            fresh.speakers = merged.speakers
            fresh.turns = merged.turns
          } catch (err) {
            log.write('\n[slovo] merge failed: ' + String(err) + '\n')
          }
          saveProject(fresh)
        }
        log.end()
        resolve()
        return
      }

      log.end()
      if (elapsed < 3000) {
        reject(
          new Error(
            `Движок мгновенно завершился (код ${code}). Похоже на блокировку антивирусом — добавьте D:\\STT и D:\\Apps\\slovo в исключения Kaspersky. Подробности: job.log`
          )
        )
        return
      }
      reject(
        new Error(`Движок завершился с ошибкой (код ${code}), результат не записан. Подробности: job.log в папке проекта.`)
      )
    })
  })
}
