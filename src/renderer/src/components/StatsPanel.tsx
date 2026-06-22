import type { ProjectMeta } from '../../../shared/types'
import { computeStats } from '../../../shared/stats'
import { useEscClose } from '../useEscClose'

function fmtClock(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`
}

const BAR_COLORS = ['var(--spk1)', 'var(--spk2)', '#a06cc4', '#c98a3a']

export default function StatsPanel({
  meta,
  onClose
}: {
  meta: ProjectMeta
  onClose: () => void
}): React.JSX.Element {
  useEscClose(onClose)
  const st = computeStats(meta.turns ?? [], meta.speakers ?? [], meta.audio.durationSec)
  const speechPct =
    st.durationSec > 0 ? Math.round((st.totalTalkSec / st.durationSec) * 100) : 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Статистика записи</span>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="stats-grid">
          <div className="stat-cell">
            <b>{fmtClock(st.durationSec)}</b>
            <span>длительность</span>
          </div>
          <div className="stat-cell">
            <b>{st.totalWords.toLocaleString('ru-RU')}</b>
            <span>слов</span>
          </div>
          <div className="stat-cell">
            <b>{st.totalTurns.toLocaleString('ru-RU')}</b>
            <span>реплик</span>
          </div>
          <div className="stat-cell">
            <b>{fmtClock(st.totalTalkSec)}</b>
            <span>чистая речь{speechPct > 0 ? ` · ${speechPct}%` : ''}</span>
          </div>
        </div>

        <div className="settings-label">Баланс речи</div>
        {st.speakers.length === 0 ? (
          <div className="panel-note">Нет распознанного текста.</div>
        ) : (
          <div className="stats-bars">
            {st.speakers.map((s, i) => (
              <div className="stats-bar-row" key={s.spk}>
                <span className="stats-bar-name" title={s.name}>
                  {s.name}
                </span>
                <div className="stats-bar-track">
                  <div
                    className="stats-bar-fill"
                    style={{ width: `${s.talkPct}%`, background: BAR_COLORS[i % BAR_COLORS.length] }}
                  />
                </div>
                <span className="stats-bar-val">
                  {s.talkPct}% · {fmtClock(s.talkSec)} · {s.words.toLocaleString('ru-RU')} сл.
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="panel-note">
          «Чистая речь» — суммарное время произнесённых слов без пауз. Баланс показывает, кто
          говорил больше: полезно для супервизии (например, не слишком ли много говорил психолог).
        </div>
      </div>
    </div>
  )
}
