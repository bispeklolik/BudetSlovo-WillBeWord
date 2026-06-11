import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { DATA_DIR } from '../paths'
import { writeJsonAtomic } from '../project/store'
import type { JobInfo, TranscribeOptions } from '../../shared/types'
import { runTranscribe, killJobProcess } from './transcribe'

const JOBS_FILE = join(DATA_DIR, 'jobs.json')
const HISTORY_LIMIT = 50

let jobs: JobInfo[] = []
let running = false
let notify: (job: JobInfo) => void = () => {}

export function setJobNotifier(fn: (job: JobInfo) => void): void {
  notify = fn
}

function persist(): void {
  writeJsonAtomic(JOBS_FILE, { jobs: jobs.slice(-HISTORY_LIMIT) })
}

function update(job: JobInfo, patch: Partial<JobInfo>): void {
  Object.assign(job, patch)
  persist()
  notify(job)
}

// Вызывается один раз при старте приложения: незавершённые задачи прошлого
// запуска помечаем «прервано» — движок пишет результат только в конце,
// поэтому прерванная задача = перезапустить целиком.
export function initQueue(): void {
  try {
    if (existsSync(JOBS_FILE)) {
      const data = JSON.parse(readFileSync(JOBS_FILE, 'utf8'))
      jobs = Array.isArray(data.jobs) ? data.jobs : []
    }
  } catch {
    jobs = []
  }
  let dirty = false
  for (const j of jobs) {
    if (j.status === 'running' || j.status === 'queued') {
      j.status = 'interrupted'
      j.endedAt = new Date().toISOString()
      dirty = true
    }
  }
  if (dirty) persist()
}

export function listJobs(): JobInfo[] {
  return jobs.slice(-HISTORY_LIMIT)
}

export function enqueueTranscribe(slug: string, opts: TranscribeOptions): JobInfo {
  const existing = jobs.find(
    (j) => j.slug === slug && (j.status === 'queued' || j.status === 'running')
  )
  if (existing) return existing

  const job: JobInfo = {
    id: randomUUID(),
    kind: 'transcribe',
    slug,
    options: opts,
    status: 'queued',
    phase: 'В очереди',
    percent: null,
    createdAt: new Date().toISOString()
  }
  jobs.push(job)
  persist()
  notify(job)
  void pump()
  return job
}

export function cancelJob(id: string): JobInfo | null {
  const job = jobs.find((j) => j.id === id)
  if (!job) return null
  if (job.status === 'queued') {
    update(job, { status: 'cancelled', phase: 'Отменено', endedAt: new Date().toISOString() })
  } else if (job.status === 'running') {
    killJobProcess(job.id)
    // Финальный статус выставит обработчик завершения процесса.
    update(job, { phase: 'Отменяю…', cancelRequested: true })
  }
  return job
}

async function pump(): Promise<void> {
  if (running) return
  const job = jobs.find((j) => j.status === 'queued')
  if (!job) return
  running = true
  update(job, { status: 'running', startedAt: new Date().toISOString(), phase: 'Подготовка' })
  try {
    await runTranscribe(job, (patch) => update(job, patch))
    if (job.cancelRequested) {
      update(job, { status: 'cancelled', phase: 'Отменено', endedAt: new Date().toISOString() })
    } else {
      update(job, {
        status: 'done',
        phase: 'Готово',
        percent: 100,
        endedAt: new Date().toISOString()
      })
    }
  } catch (err) {
    update(job, {
      status: job.cancelRequested ? 'cancelled' : 'error',
      phase: job.cancelRequested ? 'Отменено' : 'Ошибка',
      error: String(err instanceof Error ? err.message : err),
      endedAt: new Date().toISOString()
    })
  } finally {
    running = false
    void pump()
  }
}
