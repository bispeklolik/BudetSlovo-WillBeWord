import { useEffect, useState } from 'react'
import type { JobInfo, ProjectMeta, SttEngine } from '../../../shared/types'
import { sttMeta, sttModeLabel } from '../../../shared/sttEngines'
import { api } from '../api'

function isActive(j: JobInfo | null): boolean {
  return !!j && (j.status === 'queued' || j.status === 'running')
}

function elapsedLabel(j: JobInfo, now: number): string {
  if (!j.startedAt) return ''
  const sec = Math.max(0, Math.floor((now - new Date(j.startedAt).getTime()) / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

interface Props {
  meta: ProjectMeta
  onTranscribed: () => void
  onCancel?: () => void
  replaceWarning?: boolean
}

export default function TranscribePanel({
  meta,
  onTranscribed,
  onCancel,
  replaceWarning
}: Props): React.JSX.Element {
  const [job, setJob] = useState<JobInfo | null>(null)
  const [numSpeakers, setNumSpeakers] = useState(meta.transcription?.numSpeakers ?? 2)
  const [enhance, setEnhance] = useState(meta.transcription?.enhance ?? true)
  const [now, setNow] = useState(Date.now())
  const [engine, setEngine] = useState<SttEngine>('local')

  useEffect(() => {
    api.getSettings().then((s) => setEngine(s.sttEngine ?? 'local'))
    api.listJobs().then((jobs) => {
      const mine = [...jobs].reverse().find((j) => j.slug === meta.slug)
      if (mine) setJob(mine)
    })
  }, [meta.slug])

  const em = sttMeta(engine)
  const cloud = !!em?.cloud

  useEffect(
    () =>
      api.onJobUpdate((j) => {
        if (j.slug !== meta.slug) return
        setJob({ ...j })
        if (j.status === 'done') onTranscribed()
      }),
    [meta.slug, onTranscribed]
  )

  useEffect(() => {
    if (!isActive(job)) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [job])

  const start = async (): Promise<void> => {
    const j = await api.startTranscribe(meta.slug, { numSpeakers, enhance })
    setJob({ ...j })
  }

  if (isActive(job)) {
    const j = job as JobInfo
    return (
      <div className="panel" data-testid="job-progress">
        <div className="panel-title">Расшифровка идёт</div>
        <div className="job-phase">
          {j.phase}
          {j.percent !== null && j.status === 'running' ? ` — ${j.percent}%` : ''}
          {j.startedAt ? ` · ${elapsedLabel(j, now)}` : ''}
        </div>
        <div className="progress">
          <div
            className={'progress-fill' + (j.percent === null ? ' indeterminate' : '')}
            style={j.percent !== null ? { width: j.percent + '%' } : undefined}
          />
        </div>
        <div className="panel-note">
          Для записи 2–3 часа это занимает десятки минут. Можно свернуть окно — задача выполняется
          в фоне.
        </div>
        <div>
          <button className="btn" onClick={() => api.cancelJob(j.id)}>
            Отменить
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel" data-testid="transcribe-panel">
      <div className="panel-title">{replaceWarning ? 'Перераспознать запись' : 'Расшифровать запись'}</div>
      {replaceWarning && (
        <div className="job-error">Текущий текст и правки будут заменены новой расшифровкой.</div>
      )}
      {job?.status === 'error' && (
        <div className="job-error">Прошлая попытка завершилась ошибкой: {job.error}</div>
      )}
      {job?.status === 'interrupted' && (
        <div className="job-error">
          Прошлая расшифровка была прервана (приложение закрылось). Запустите ещё раз.
        </div>
      )}
      {job?.status === 'cancelled' && <div className="panel-note">Прошлая расшифровка отменена.</div>}
      <div className="field">
        <span>Движок распознавания</span>
        <span className="settings-status">{em ? sttModeLabel(em) : engine}</span>
      </div>
      <label className="field">
        <span>Говорящих на записи</span>
        <select value={numSpeakers} onChange={(e) => setNumSpeakers(Number(e.target.value))}>
          <option value={2}>Двое: психолог и клиент</option>
          <option value={1}>Один (монолог)</option>
          <option value={0}>Определить автоматически</option>
        </select>
      </label>
      {!cloud && (
        <label className="field field-check">
          <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} />
          <span>Чистка звука (помогает с тихой и неразборчивой речью)</span>
        </label>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={start} data-testid="start-transcribe">
          Расшифровать
        </button>
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            ← Назад к тексту
          </button>
        )}
      </div>
      <div className="panel-note">
        {cloud
          ? `Запись будет отправлена в ${em?.label ?? 'облачный сервис'} (облако) по вашему ключу. Сменить движок можно в Настройках.`
          : 'Всё происходит на вашем компьютере: запись никуда не отправляется. Сменить движок можно в Настройках.'}
      </div>
    </div>
  )
}
