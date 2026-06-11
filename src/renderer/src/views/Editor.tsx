import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectMeta } from '../../../shared/types'
import { api } from '../api'
import Waveform from '../components/Waveform'
import TranscribePanel from '../components/TranscribePanel'

function fmtTime(sec: number): string {
  const t = Math.floor(sec)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]

export default function Editor({ slug }: { slug: string }): React.JSX.Element {
  const [meta, setMeta] = useState<ProjectMeta | null>(null)
  const [peaks, setPeaks] = useState<Int8Array | null>(null)
  const [cur, setCur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const audioRef = useRef<HTMLAudioElement>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    api.getProject(slug).then(setMeta)
    api.getPeaks(slug).then((u8) => {
      if (u8) setPeaks(new Int8Array(u8.buffer, u8.byteOffset, u8.byteLength))
    })
  }, [slug])

  useEffect(() => {
    const tick = (): void => {
      const a = audioRef.current
      if (a) setCur(a.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  const togglePlay = useCallback((): void => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }, [])

  const skip = useCallback((d: number): void => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Math.max(0, a.currentTime + d)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'ArrowLeft') {
        skip(-5)
      } else if (e.code === 'ArrowRight') {
        skip(5)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, skip])

  const seek = (sec: number): void => {
    const a = audioRef.current
    if (a) a.currentTime = sec
  }

  const changeRate = (r: number): void => {
    setRate(r)
    const a = audioRef.current
    if (a) a.playbackRate = r
  }

  if (!meta) {
    return (
      <main className="empty">
        <div className="empty-title">Загружаю проект…</div>
      </main>
    )
  }

  return (
    <main className="editor">
      <div className="editor-head">
        <h1 className="editor-title">{meta.title}</h1>
        <span className="editor-sub">
          {fmtTime(meta.audio.durationSec)}
          {meta.audio.repairedPrefixBytes > 0 && ' · файл был автоматически починен при импорте'}
        </span>
      </div>

      <div className="editor-body">
        {meta.engine?.completedAt ? (
          <div className="transcript-placeholder">
            <div className="empty-title">Расшифровка готова</div>
            <div>Текст с ролями появится здесь на следующем шаге (Фаза 3)</div>
          </div>
        ) : (
          <TranscribePanel
            meta={meta}
            onTranscribed={() => {
              api.getProject(slug).then(setMeta)
            }}
          />
        )}
      </div>

      <div className="player">
        <audio
          ref={audioRef}
          src={`media://audio/${slug}`}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <div className="transport">
          <button className="btn" onClick={() => skip(-5)} title="Назад 5 с (←)">
            −5с
          </button>
          <button className="btn btn-primary" onClick={togglePlay} data-testid="play-btn">
            {playing ? 'Пауза' : 'Играть'}
          </button>
          <button className="btn" onClick={() => skip(5)} title="Вперёд 5 с (→)">
            +5с
          </button>
          <span className="time" data-testid="time">
            {fmtTime(cur)} / {fmtTime(meta.audio.durationSec)}
          </span>
          <select
            className="rate"
            value={rate}
            onChange={(e) => changeRate(Number(e.target.value))}
            title="Скорость воспроизведения"
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                ×{r}
              </option>
            ))}
          </select>
        </div>
        <Waveform peaks={peaks} durationSec={meta.audio.durationSec} currentTime={cur} onSeek={seek} />
      </div>
    </main>
  )
}
