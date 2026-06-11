import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectMeta, Word } from '../../../shared/types'
import { api } from '../api'
import Waveform, { type Lane } from '../components/Waveform'
import TranscribePanel from '../components/TranscribePanel'
import TranscriptView from '../components/TranscriptView'

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

interface IndexEntry {
  s: number
  e: number
  wordId: number
  turnIdx: number
}

export default function Editor({ slug }: { slug: string }): React.JSX.Element {
  const [meta, setMeta] = useState<ProjectMeta | null>(null)
  const [peaks, setPeaks] = useState<Int8Array | null>(null)
  const [cur, setCur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [activeWordId, setActiveWordId] = useState<number | null>(null)
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(null)
  const [follow, setFollow] = useState(true)
  const audioRef = useRef<HTMLAudioElement>(null)
  const rafRef = useRef(0)
  const indexRef = useRef<IndexEntry[]>([])

  useEffect(() => {
    api.getProject(slug).then(setMeta)
    api.getPeaks(slug).then((u8) => {
      if (u8) setPeaks(new Int8Array(u8.buffer, u8.byteOffset, u8.byteLength))
    })
  }, [slug])

  // Плоский индекс слов для караоке/seek: бинарный поиск по currentTime.
  useEffect(() => {
    const idx: IndexEntry[] = []
    meta?.turns?.forEach((turn, ti) => {
      for (const w of turn.words) {
        if (w.s !== undefined && w.e !== undefined) {
          idx.push({ s: w.s, e: w.e, wordId: w.id, turnIdx: ti })
        }
      }
    })
    indexRef.current = idx
  }, [meta])

  const lanes = useMemo<Lane[]>(() => {
    if (!meta?.turns || !meta.audio.durationSec) return []
    const dur = meta.audio.durationSec
    return meta.turns.map((t) => {
      const lastTimed = [...t.words].reverse().find((w) => w.e !== undefined)
      const colorKey = meta.speakers?.find((s) => s.id === t.spk)?.colorKey ?? 'spk1'
      return {
        startFrac: Math.min(1, t.startSec / dur),
        endFrac: Math.min(1, (lastTimed?.e ?? t.startSec) / dur),
        colorKey
      }
    })
  }, [meta])

  useEffect(() => {
    const findActive = (t: number): IndexEntry | null => {
      const idx = indexRef.current
      if (idx.length === 0) return null
      let lo = 0
      let hi = idx.length - 1
      let candidate = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (idx[mid].s <= t) {
          candidate = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      if (candidate === -1) return null
      const entry = idx[candidate]
      // Слово активно, пока не началось следующее (паузы липнут к предыдущему).
      return entry
    }

    const tick = (): void => {
      const a = audioRef.current
      if (a) {
        const t = a.currentTime
        setCur(t)
        if (!a.paused) {
          const entry = findActive(t)
          setActiveWordId((prev) => (entry && entry.wordId !== prev ? entry.wordId : prev))
          setActiveTurnIndex((prev) => (entry && entry.turnIdx !== prev ? entry.turnIdx : prev))
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  const togglePlay = useCallback((): void => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      setFollow(true)
      void a.play()
    } else {
      a.pause()
    }
  }, [])

  const skip = useCallback((d: number): void => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Math.max(0, a.currentTime + d)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return
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

  const onWordClick = (w: Word): void => {
    if (w.s === undefined) return
    setFollow(true)
    seek(w.s + 0.01)
    setActiveWordId(w.id)
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
        {meta.turns && meta.turns.length > 0 ? (
          <TranscriptView
            meta={meta}
            activeWordId={activeWordId}
            activeTurnIndex={activeTurnIndex}
            follow={follow && playing}
            onWordClick={onWordClick}
            onUserScroll={() => setFollow(false)}
          />
        ) : meta.engine?.completedAt ? (
          <div className="transcript-placeholder">
            <div className="empty-title">Собираю текст…</div>
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
          {playing && !follow && (
            <button className="btn btn-follow" onClick={() => setFollow(true)}>
              К текущему месту
            </button>
          )}
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
        <Waveform
          peaks={peaks}
          durationSec={meta.audio.durationSec}
          currentTime={cur}
          lanes={lanes}
          onSeek={seek}
        />
      </div>
    </main>
  )
}
