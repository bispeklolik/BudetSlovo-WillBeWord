import { useEffect, useState } from 'react'
import type { JobInfo, ProjectMeta, SttEngine } from '../../../shared/types'
import { sttMeta, sttModeLabel } from '../../../shared/sttEngines'
import { api } from '../api'

function isActive(j: JobInfo | null): boolean {
  return !!j && (j.status === 'queued' || j.status === 'running')
}

/** «12:30», «1:02:03» или «90» → секунды; пусто/мусор → null. */
export function parseClock(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return null
  return t.split(':').reduce((acc, p) => acc * 60 + Number(p), 0)
}

function fmtClock(sec: number): string {
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
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
  // Запись звонка: говорящие известны по дорожкам, диаризации нет.
  const isCall = !!meta.channels && !!(meta.channels.mic || meta.channels.sys)
  const [names, setNames] = useState<string[]>(
    meta.channels?.names ?? meta.speakers?.slice(0, 2).map((s) => s.name) ?? ['Психолог', 'Клиент']
  )
  const [verbatim, setVerbatim] = useState(false)
  const [useRange, setUseRange] = useState(false)
  const [from, setFrom] = useState('0:00')
  const [to, setTo] = useState(fmtClock(meta.audio.durationSec || 0))

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

  const dur = meta.audio.durationSec || 0
  const fromSec = parseClock(from)
  const toSec = parseClock(to)
  const rangeError = !useRange
    ? null
    : fromSec === null || toSec === null
      ? 'Время пишите как 12:30 или 1:02:30.'
      : fromSec >= toSec
        ? '«С» должно быть раньше, чем «по».'
        : fromSec >= dur
          ? `Запись короче: она длится ${fmtClock(dur)}.`
          : null

  const nameCount = isCall ? 2 : numSpeakers
  const start = async (): Promise<void> => {
    if (rangeError) return
    const j = await api.startTranscribe(meta.slug, {
      numSpeakers: isCall ? 2 : numSpeakers,
      enhance,
      names: nameCount > 0 ? names.slice(0, nameCount).map((n) => n.trim()) : undefined,
      verbatim,
      range: useRange && fromSec !== null && toSec !== null ? { startSec: fromSec, endSec: Math.min(toSec, dur || toSec) } : undefined
    })
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
        <div className="job-error">
          Текущий текст и правки будут заменены новой расшифровкой.
          {useRange && ' Останется только текст выбранного куска — остальной текст записи удалится.'}
        </div>
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
      {isCall ? (
        <div className="field">
          <span>Говорящие</span>
          <span className="settings-status">по дорожкам записи звонка — путаницы «кто сказал» не будет</span>
        </div>
      ) : (
        <label className="field">
          <span>Говорящих на записи</span>
          <select value={numSpeakers} onChange={(e) => setNumSpeakers(Number(e.target.value))}>
            <option value={2}>Двое</option>
            <option value={1}>Один (монолог)</option>
            <option value={0}>Определить автоматически</option>
          </select>
        </label>
      )}
      {nameCount > 0 && (
        <div className="field names-field">
          <span>{isCall ? 'Подписи' : 'Как подписать (по порядку, кто заговорит первым)'}</span>
          <span className="names-inputs">
            {Array.from({ length: nameCount }, (_, i) => (
              <input
                key={i}
                className="text-input"
                value={names[i] ?? ''}
                placeholder={isCall ? (i === 0 ? 'Я' : 'Собеседник') : `Говорящий ${i + 1}`}
                onChange={(e) => {
                  const next = [...names]
                  next[i] = e.target.value
                  setNames(next)
                }}
              />
            ))}
          </span>
        </div>
      )}
      <label className="field field-check">
        <input type="checkbox" checked={verbatim} onChange={(e) => setVerbatim(e.target.checked)} />
        <span>
          Дословно: сохранять «э-э», «ну», запинки
          <span className="settings-status">
            {cloud ? ' · у облачных сервисов для русского — как получится' : ' · надёжно на локальном движке'}
          </span>
        </span>
      </label>
      <label className="field field-check">
        <input type="checkbox" checked={useRange} onChange={(e) => setUseRange(e.target.checked)} />
        <span>Только часть записи</span>
      </label>
      {useRange && (
        <div className="field range-field">
          <span>с</span>
          <input className="text-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>по</span>
          <input className="text-input" value={to} onChange={(e) => setTo(e.target.value)} />
          {rangeError && <span className="key-bad">{rangeError}</span>}
        </div>
      )}
      {!cloud && (
        <label className="field field-check">
          <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} />
          <span>Чистка звука (помогает с тихой и неразборчивой речью)</span>
        </label>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={start} disabled={!!rangeError} data-testid="start-transcribe">
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
