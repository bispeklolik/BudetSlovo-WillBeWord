import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, type WriteStream } from 'fs'
import { join } from 'path'
import { enginePaths, engineEnv } from '../engine/location'
import { detectGpu } from '../engine/sysinfo'
import { deviceArgs, localModel } from '../../shared/localModels'
import { projectDir, getProject, saveProject } from '../project/store'
import { mergeEngineOutputs, type MergeResult } from '../project/merge'
import { loadSettings } from '../settings'
import { CLOUD_RUN } from '../stt'
import { sttMeta } from '../../shared/sttEngines'
import { VERBATIM_PROMPT_RU } from '../../shared/verbatim'
import { sttPrompt } from '../../shared/vocab'
import {
  wordsFromTurns,
  parseWhisperJsonWords,
  dropEcho,
  mergeChannels,
  offsetTurns,
  applySpeakerNames,
  type ChannelWord
} from '../../shared/channels'
import { trimAudio } from '../calls/ffmpeg'
import type { JobInfo, ProjectMeta, TranscribeOptions } from '../../shared/types'

type Emit = (patch: Partial<JobInfo>) => void

const procs = new Map<string, ChildProcess>()
const cloudAborts = new Map<string, AbortController>()

export function killJobProcess(jobId: string): void {
  const p = procs.get(jobId)
  if (p?.pid) {
    spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true })
  }
  // Облачная задача: обрываем сетевые запросы (иначе «отмена» была no-op,
  // и задача занимала очередь до конца запроса).
  cloudAborts.get(jobId)?.abort()
}

// Результат готов, если записан непустой <имя>.json. Движок (PyInstaller+CUDA)
// иногда падает на teardown с кодом 0xC0000409 уже ПОСЛЕ записи всех файлов —
// такой результат полноценен, и выбрасывать его нельзя.
function outputsValid(outDir: string, base = 'audio', allowEmpty = false): boolean {
  try {
    const data = JSON.parse(readFileSync(join(outDir, base + '.json'), 'utf8'))
    return Array.isArray(data.segments) && (allowEmpty || data.segments.length > 0)
  } catch {
    return false
  }
}

/** Отмена проверяется на каждом шаге: обрезка ffmpeg и переходы между
 *  дорожками не убиваются через killJobProcess (ревью волны 3). */
function checkCancel(job: JobInfo): void {
  if (job.cancelRequested) throw new Cancelled()
}

export { engineEnv }

function parseTimecodeSec(tc: string): number {
  const parts = tc.split(':')
  let sec = 0
  for (const p of parts) sec = sec * 60 + parseFloat(p.replace(',', '.'))
  return sec
}

class Cancelled extends Error {}

interface EngineRun {
  input: string
  outDir: string
  diarize: boolean
  numSpeakers: number
  enhance: boolean
  verbatim: boolean
  durationSec: number
  /** что показывать в очереди: «Распознавание» или «Распознаю: Я» */
  label: string
  /** дорожка звонка может быть без речи (молчал, слушал) — это не ошибка */
  allowEmpty?: boolean
}

/** Один запуск локального движка; успех — по наличию результата, не по коду. */
function runLocalEngine(job: JobInfo, r: EngineRun, emit: Emit, log: WriteStream): Promise<void> {
  checkCancel(job)
  const eng = enginePaths()
  const settings = loadSettings()
  const modelId = localModel(settings.localModel).id
  mkdirSync(r.outDir, { recursive: true })
  mkdirSync(eng.temp, { recursive: true })
  // Старые результаты прошлого запуска убираем: иначе при сбое движка их
  // приняли бы за успех (ревью волны 3: «устаревший audio.json»).
  const base = r.input.replace(/\\/g, '/').split('/').pop()!.replace(/\.[^.]+$/, '')
  for (const ext of ['json', 'txt', 'srt']) rmSync(join(r.outDir, `${base}.${ext}`), { force: true })
  const args = [
    r.input,
    '--model', modelId,
    '--model_dir', eng.modelsDir,
    '--language', 'ru',
    ...deviceArgs(settings.localDevice, !!detectGpu()),
    '--beam_size', '5',
    '--vad_filter', 'True',
    // Не переносить контекст между сегментами: иначе одна ошибка на трудном
    // участке отравляет последующие и модель сваливается в бред (англ. мусор).
    '--condition_on_previous_text', 'False',
    '--output_dir', r.outDir,
    '--output_format', 'txt', 'srt', 'json',
    '--beep_off'
  ]
  if (r.diarize) {
    args.push('--diarize', 'pyannote_v3.1')
    if (r.numSpeakers > 0) args.push('--num_speakers', String(r.numSpeakers))
  }
  if (r.enhance) args.push('--ff_loudnorm', '--ff_lowhighpass', '--ff_fftdn', '10')
  // Затравка: «дословно» (с «э-э»/«ну») и/или словарь пользователя (имена, термины).
  const prompt = sttPrompt(r.verbatim ? VERBATIM_PROMPT_RU : null, settings.vocab?.words)
  if (prompt) args.push('--initial_prompt', prompt)
  // VAD не выкидывает короткие звуки (иначе «м-м» режется до модели).
  if (r.verbatim) args.push('--vad_min_speech_duration_ms', '100')
  log.write(`[slovo] ${new Date().toISOString()}\n[slovo] ${eng.exe}\n[slovo] args: ${args.join(' ')}\n\n`)

  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn(eng.exe, args, { cwd: eng.dir, env: engineEnv(), windowsHide: true })
    procs.set(job.id, child)
    let lineBuf = ''
    const segRe = /-->\s*([0-9:.,]+)\]/
    const onLine = (line: string): void => {
      if (line.includes('Audio filtering')) emit({ phase: 'Чистка звука', percent: null })
      else if (line.includes('Diarizing')) emit({ phase: 'Разделение говорящих', percent: null })
      else if (line.includes('faster-whisper inference')) emit({ phase: r.label, percent: 0 })
      else if (line.includes('Subtitles are written') || line.includes('Transcription speed'))
        emit({ phase: 'Сохранение результата', percent: null })
      else {
        const m = segRe.exec(line)
        if (m && r.durationSec > 0) {
          const pct = Math.max(0, Math.min(99, Math.round((parseTimecodeSec(m[1]) / r.durationSec) * 100)))
          emit({ phase: r.label, percent: pct })
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
    child.stderr.on('data', (chunk: string) => log.write(chunk))
    child.on('error', (err) => {
      procs.delete(job.id)
      reject(new Error('Не удалось запустить движок: ' + err.message))
    })
    child.on('close', (code) => {
      procs.delete(job.id)
      if (job.cancelRequested) return reject(new Cancelled())
      if (outputsValid(r.outDir, base, r.allowEmpty)) {
        if (code !== 0) log.write(`\n[slovo] движок вышел с кодом ${code}, но результат записан полностью — считаем успехом\n`)
        return resolve()
      }
      if (Date.now() - startedAt < 3000) {
        return reject(
          new Error(
            `Движок мгновенно завершился (код ${code}). Похоже на блокировку антивирусом — добавьте папку движка (${eng.dir}) в исключения антивируса. Подробности: job.log`
          )
        )
      }
      reject(new Error(`Движок завершился с ошибкой (код ${code}), результат не записан. Подробности: job.log в папке проекта.`))
    })
  })
}

/** Облачный движок на одном файле (вся логика ключей, отмены и таймаутов). */
async function runCloudOn(job: JobInfo, engineId: string, input: string, verbatim: boolean, emit: Emit, label: string): Promise<MergeResult> {
  const run = CLOUD_RUN[engineId]
  const name = sttMeta(engineId)?.label ?? engineId
  const key = (loadSettings().sttKeys?.[engineId] ?? '').trim()
  if (!key) throw new Error(`Не указан ключ «${name}» — вставьте его в Настройках.`)
  if (!existsSync(input)) throw new Error('Аудио не найдено: ' + input)
  checkCancel(job)
  emit({ phase: label || `Отправка в ${name}`, percent: null })
  const ctrl = new AbortController()
  cloudAborts.set(job.id, ctrl)
  try {
    const result = await run(input, key, emit, ctrl.signal, { verbatim, terms: loadSettings().vocab?.words })
    checkCancel(job) // отменили, пока сервис отвечал, — результат не сохраняем
    return result
  } catch (err) {
    if (err instanceof Cancelled) throw err
    if (job.cancelRequested || ctrl.signal.aborted) throw new Cancelled()
    if (err instanceof Error && err.name === 'TimeoutError')
      throw new Error(`${name}: сервис не ответил вовремя. Проверьте интернет и попробуйте ещё раз.`)
    throw err
  } finally {
    cloudAborts.delete(job.id)
  }
}

/** Вход для движка: весь файл или вырезанный кусок «с — по» (во временной папке). */
async function prepareInput(job: JobInfo, src: string, tmpDir: string, opts: TranscribeOptions | undefined): Promise<string> {
  const range = opts?.range
  if (!range) return src
  mkdirSync(tmpDir, { recursive: true })
  // Имя файла сохраняем: от него движок называет свои результаты (audio.json, mic.json…).
  const dest = join(tmpDir, src.replace(/\\/g, '/').split('/').pop()!)
  await trimAudio(src, dest, range.startSec, range.endSec)
  checkCancel(job)
  return dest
}

function inputDuration(meta: ProjectMeta, opts: TranscribeOptions | undefined): number {
  const r = opts?.range
  return r ? Math.max(0, r.endSec - r.startSec) : meta.audio.durationSec || 0
}

function saveResult(job: JobInfo, result: MergeResult, model: string, opts: TranscribeOptions | undefined): void {
  checkCancel(job)
  const fresh = getProject(job.slug)
  if (!fresh) return
  let { speakers, turns } = result
  if (opts?.range) turns = offsetTurns(turns, opts.range.startSec)
  if (opts?.names?.some((n) => n.trim())) speakers = applySpeakerNames(speakers, turns, opts.names)
  fresh.transcription = { numSpeakers: opts?.numSpeakers ?? 2, enhance: opts?.enhance !== false }
  fresh.engine = { model, completedAt: new Date().toISOString() }
  fresh.speakers = speakers
  fresh.turns = turns
  saveProject(fresh)
}

/** Обычная запись: один файл, говорящих делит движок (диаризация). */
async function runSingle(job: JobInfo, meta: ProjectMeta, emit: Emit, log: WriteStream): Promise<void> {
  const opts = job.options
  const dir = projectDir(job.slug)
  const engineId = loadSettings().sttEngine ?? 'local'
  const tmp = join(dir, 'range-tmp')
  try {
    const input = await prepareInput(job, join(dir, 'audio.m4a'), tmp, opts)
    if (engineId !== 'local' && CLOUD_RUN[engineId]) {
      const result = await runCloudOn(job, engineId, input, !!opts?.verbatim, emit, '')
      emit({ phase: 'Сохранение результата', percent: null })
      saveResult(job, result, engineId, opts)
      return
    }
    requireLocalEngine()
    const engineOut = join(dir, 'engine')
    await runLocalEngine(
      job,
      {
        input,
        outDir: engineOut,
        diarize: true,
        numSpeakers: opts?.numSpeakers ?? 2,
        enhance: opts?.enhance !== false,
        verbatim: !!opts?.verbatim,
        durationSec: inputDuration(meta, opts),
        label: 'Распознавание'
      },
      emit,
      log
    )
    saveResult(job, mergeEngineOutputs(job.slug), localModel(loadSettings().localModel).id, opts)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * Запись звонка: две дорожки (микрофон = «Я», звук компьютера = «Собеседник»)
 * расшифровываются по отдельности — говорящие известны, диаризация не нужна и
 * не ошибается. Эхо собеседника в микрофоне (разговор через колонки) убирается.
 */
async function runChannels(job: JobInfo, meta: ProjectMeta, emit: Emit, log: WriteStream): Promise<void> {
  const ch = meta.channels!
  const opts = job.options
  const names: [string, string] = [
    opts?.names?.[0]?.trim() || ch.names[0],
    opts?.names?.[1]?.trim() || ch.names[1]
  ]
  const dir = projectDir(job.slug)
  const engineId = loadSettings().sttEngine ?? 'local'
  const cloud = engineId !== 'local' && !!CLOUD_RUN[engineId]
  if (!cloud) requireLocalEngine()
  const tmp = join(dir, 'range-tmp')
  const words: Record<'mic' | 'sys', ChannelWord[]> = { mic: [], sys: [] }
  try {
    const kinds = (['mic', 'sys'] as const).filter((k) => ch[k])
    for (const kind of kinds) {
      // Дорожка в записи есть, а файла нет — молча расшифровать половину разговора нельзя.
      if (!existsSync(join(dir, ch[kind])))
        throw new Error(`Не найден файл дорожки «${kind === 'mic' ? names[0] : names[1]}» (${ch[kind]}) в папке записи.`)
    }
    for (const kind of kinds) {
      checkCancel(job)
      const label = `Распознаю: ${kind === 'mic' ? names[0] : names[1]}`
      const input = await prepareInput(job, join(dir, ch[kind]), tmp, opts)
      if (cloud) {
        try {
          const r = await runCloudOn(job, engineId, input, !!opts?.verbatim, emit, label)
          words[kind] = wordsFromTurns(r.turns)
        } catch (err) {
          // Молчащая сторона (слушал вебинар, выключил микрофон) — норма, а не провал звонка.
          if (err instanceof Error && /пуст(ая|ую) расшифровк/i.test(err.message)) words[kind] = []
          else throw err
        }
      } else {
        const outDir = join(dir, 'engine', 'channels')
        await runLocalEngine(
          job,
          {
            input,
            outDir,
            diarize: false,
            numSpeakers: 1,
            enhance: opts?.enhance !== false,
            verbatim: !!opts?.verbatim,
            durationSec: inputDuration(meta, opts),
            label,
            allowEmpty: true
          },
          emit,
          log
        )
        const base = ch[kind].replace(/\.[^.]+$/, '')
        words[kind] = parseWhisperJsonWords(JSON.parse(readFileSync(join(outDir, base + '.json'), 'utf8')))
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  if (!words.mic.length && !words.sys.length)
    throw new Error('Ни на одной дорожке звонка не нашлось речи. Прежний текст оставлен как был.')
  emit({ phase: 'Сохранение результата', percent: null })
  const merged = mergeChannels(dropEcho(words.mic, words.sys), words.sys, names)
  // Имена уже стоят по дорожкам — поверх них ничего не переименовываем.
  saveResult(job, merged, cloud ? engineId : localModel(loadSettings().localModel).id, { ...opts!, names: undefined })
}

function requireLocalEngine(): void {
  if (!enginePaths().installed) {
    throw new Error(
      'Локальный движок расшифровки ещё не установлен. Скачайте его в «Настройки → С чего начать» или выберите облачный движок.'
    )
  }
}

export async function runTranscribe(job: JobInfo, emit: Emit): Promise<void> {
  const meta = getProject(job.slug)
  if (!meta) throw new Error('Проект не найден: ' + job.slug)
  const log = createWriteStream(join(projectDir(job.slug), 'job.log'), { flags: 'w' })
  try {
    if (meta.channels && (meta.channels.mic || meta.channels.sys)) await runChannels(job, meta, emit, log)
    else await runSingle(job, meta, emit, log)
  } catch (err) {
    if (err instanceof Cancelled) return
    log.write('\n[slovo] ' + String(err) + '\n')
    throw err
  } finally {
    log.end()
  }
}
