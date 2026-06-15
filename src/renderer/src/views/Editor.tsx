import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectMeta, Word } from '../../../shared/types'
import type { Patch } from '../../../shared/patches'
import { nextWordId } from '../../../shared/patches'
import { withPatch } from '../editing'
import { api } from '../api'
import Waveform, { type Lane } from '../components/Waveform'
import TranscribePanel from '../components/TranscribePanel'
import TranscriptView from '../components/TranscriptView'
import ExportMenu from '../components/ExportMenu'

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
  const [dirty, setDirty] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [reproc, setReproc] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const rafRef = useRef(0)
  const indexRef = useRef<IndexEntry[]>([])
  const undoRef = useRef<ProjectMeta[]>([])
  const redoRef = useRef<ProjectMeta[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const metaRef = useRef<ProjectMeta | null>(null)
  metaRef.current = meta

  const loadMeta = useCallback((m: ProjectMeta | null): void => {
    undoRef.current = []
    redoRef.current = []
    setMeta(m)
  }, [])

  useEffect(() => {
    api.getProject(slug).then(loadMeta)
    api.getPeaks(slug).then((u8) => {
      if (u8) setPeaks(new Int8Array(u8.buffer, u8.byteOffset, u8.byteLength))
    })
  }, [slug, loadMeta])

  // Грузим аудио целиком в Blob (через media://) и проигрываем из него:
  // Blob seekable в любую точку, в отличие от потокового протокола.
  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    setAudioUrl(null)
    fetch(`media://audio/${slug}`)
      .then((r) => r.blob())
      .then((b) => {
        if (cancelled) return
        url = URL.createObjectURL(b)
        setAudioUrl(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
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
    idx.sort((a, b) => a.s - b.s)
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

  // -------- сохранение (дебаунс) --------
  const scheduleSave = useCallback(
    (m: ProjectMeta): void => {
      setDirty(true)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        api.saveTranscript(slug, m.turns ?? [], m.speakers ?? []).then(() => setDirty(false))
      }, 700)
    },
    [slug]
  )

  // -------- правки + отмена/повтор --------
  const edit = useCallback(
    (patch: Patch): void => {
      const m = metaRef.current
      if (!m) return
      undoRef.current.push(m)
      if (undoRef.current.length > 60) undoRef.current.shift()
      redoRef.current = []
      const next = withPatch(m, patch)
      setMeta(next)
      scheduleSave(next)
    },
    [scheduleSave]
  )

  const undo = useCallback((): void => {
    const m = metaRef.current
    const prev = undoRef.current.pop()
    if (!prev || !m) return
    redoRef.current.push(m)
    setMeta(prev)
    scheduleSave(prev)
  }, [scheduleSave])

  const redo = useCallback((): void => {
    const m = metaRef.current
    const nxt = redoRef.current.pop()
    if (!nxt || !m) return
    undoRef.current.push(m)
    setMeta(nxt)
    scheduleSave(nxt)
  }, [scheduleSave])

  useEffect(() => {
    const tick = (): void => {
      const a = audioRef.current
      if (a) {
        setCur(a.currentTime)
        if (!a.paused) {
          const idx = indexRef.current
          if (idx.length) {
            let lo = 0
            let hi = idx.length - 1
            let cand = -1
            const t = a.currentTime
            while (lo <= hi) {
              const mid = (lo + hi) >> 1
              if (idx[mid].s <= t) {
                cand = mid
                lo = mid + 1
              } else hi = mid - 1
            }
            if (cand >= 0) {
              const entry = idx[cand]
              setActiveWordId((p) => (entry.wordId !== p ? entry.wordId : p))
              setActiveTurnIndex((p) => (entry.turnIdx !== p ? entry.turnIdx : p))
            }
          }
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
    } else a.pause()
  }, [])

  const skip = useCallback((d: number): void => {
    const a = audioRef.current
    if (a) a.currentTime = Math.max(0, a.currentTime + d)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return
      // e.code (раскладко-независимо): на RU-раскладке e.key для Z = 'я'.
      if (e.ctrlKey && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.ctrlKey && e.code === 'KeyY') {
        e.preventDefault()
        redo()
      } else if (e.code === 'Space') {
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
  }, [togglePlay, skip, undo, redo])

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

  // -------- колбэки правок для TranscriptView --------
  const onCommitWord = (turnId: string, wordId: number, text: string): void => {
    const m = metaRef.current
    const turn = m?.turns?.find((t) => t.id === turnId)
    const w = turn?.words.find((w) => w.id === wordId)
    if (!w) return
    const next = text.trim()
    if (next === w.t) return
    if (next === '') edit({ op: 'deleteWords', turnId, wordIds: [wordId] })
    else edit({ op: 'setWordText', turnId, wordId, t: next, t0: w.t0 ?? w.t })
  }
  const onInsertBefore = (turnId: string, index: number): number => {
    const m = metaRef.current
    if (!m) return -1
    const id = nextWordId(m)
    edit({ op: 'insertWords', turnId, atIndex: index, words: [{ id, t: '' }] })
    return id
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

  const hasText = (meta.turns?.length ?? 0) > 0

  return (
    <main className="editor">
      <div className="editor-head">
        <h1 className="editor-title">{meta.title}</h1>
        <span className="editor-sub">
          {fmtTime(meta.audio.durationSec)}
          {meta.audio.repairedPrefixBytes > 0 && ' · файл починен при импорте'}
          {hasText && (dirty ? ' · сохраняю…' : ' · сохранено')}
        </span>
        {hasText && !reproc && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              className="btn"
              onClick={() => {
                if (
                  window.confirm(
                    'Перераспознать запись заново? Текущий текст и правки будут заменены.'
                  )
                )
                  setReproc(true)
              }}
            >
              Перераспознать
            </button>
            <ExportMenu slug={slug} />
          </div>
        )}
      </div>

      <div className="editor-body">
        {reproc ? (
          <TranscribePanel
            meta={meta}
            replaceWarning
            onCancel={() => setReproc(false)}
            onTranscribed={() => {
              setReproc(false)
              api.getProject(slug).then(loadMeta)
            }}
          />
        ) : hasText ? (
          <TranscriptView
            meta={meta}
            activeWordId={activeWordId}
            activeTurnIndex={activeTurnIndex}
            follow={follow && playing}
            onWordClick={onWordClick}
            onUserScroll={() => setFollow(false)}
            onCommitWord={onCommitWord}
            onInsertBefore={onInsertBefore}
            onRenameSpeaker={(speakerId, name) => edit({ op: 'renameSpeaker', speakerId, name })}
            onSetTurnSpeaker={(turnId, spk) => edit({ op: 'setTurnSpeaker', turnId, spk })}
            onMergeTurn={(turnId) => edit({ op: 'mergeTurnIntoPrev', turnId })}
          />
        ) : meta.engine?.completedAt ? (
          <div className="transcript-placeholder">
            <div className="empty-title">Собираю текст…</div>
          </div>
        ) : (
          <TranscribePanel meta={meta} onTranscribed={() => api.getProject(slug).then(loadMeta)} />
        )}
      </div>

      <div className="player">
        <audio
          ref={audioRef}
          src={audioUrl ?? undefined}
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
