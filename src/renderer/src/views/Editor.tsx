import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectMeta, Word, AnonRule } from '../../../shared/types'
import type { Patch } from '../../../shared/patches'
import { nextWordId } from '../../../shared/patches'
import { withPatch } from '../editing'
import { api } from '../api'
import Waveform, { type Lane } from '../components/Waveform'
import TranscribePanel from '../components/TranscribePanel'
import TranscriptView from '../components/TranscriptView'
import ExportMenu from '../components/ExportMenu'
import PromptLibraryPanel from '../components/PromptLibraryPanel'
import HighlightsPanel from '../components/HighlightsPanel'
import AnonPanel from '../components/AnonPanel'
import StatsPanel from '../components/StatsPanel'
import { buildAnonOverlay } from '../../../shared/anon'
import { rateForKey } from '../../../shared/playback'
import AiMenu from '../components/AiMenu'
import Icon from '../components/Icon'

function fmtTime(sec: number): string {
  const t = Math.floor(sec)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

// Русское склонение: 1 слово / 2 слова / 5 слов.
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]

interface IndexEntry {
  s: number
  e: number
  wordId: number
  turnIdx: number
}

export default function Editor({
  slug,
  initialSearch
}: {
  slug: string
  initialSearch?: string
}): React.JSX.Element {
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
  const [aiBusy, setAiBusy] = useState(false)
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number } | null>(null)
  const [aiBackup, setAiBackup] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [hlPanelOpen, setHlPanelOpen] = useState(false)
  const [hlBusy, setHlBusy] = useState(false)
  const [anonMode, setAnonMode] = useState(false)
  const [anonBusy, setAnonBusy] = useState(false)
  const [anonPanelOpen, setAnonPanelOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  // Голосовая правка: реплика, которую надиктовывают заново.
  const [redict, setRedict] = useState<{ turnId: string; phase: 'rec' | 'stt' } | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recChunksRef = useRef<Blob[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [replace, setReplace] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const rafRef = useRef(0)
  const indexRef = useRef<IndexEntry[]>([])
  const undoRef = useRef<ProjectMeta[]>([])
  const redoRef = useRef<ProjectMeta[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const metaRef = useRef<ProjectMeta | null>(null)
  metaRef.current = meta

  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || !meta?.turns) return [] as { turnIndex: number; wordId: number }[]
    const out: { turnIndex: number; wordId: number }[] = []
    meta.turns.forEach((t, ti) => {
      t.words.forEach((w) => {
        if (w.t.toLowerCase().includes(q)) out.push({ turnIndex: ti, wordId: w.id })
      })
    })
    return out
  }, [search, meta])

  // Наложение обезличивания (до раннего return — иначе нарушится порядок хуков).
  const anonOverlay = useMemo(
    () => buildAnonOverlay(meta?.turns ?? [], meta?.anon ?? []),
    [meta]
  )

  // Переход из глобального поиска: открыть строку поиска с этим словом.
  useEffect(() => {
    if (initialSearch) {
      setSearch(initialSearch)
      setSearchOpen(true)
      setMatchIdx(0)
    }
  }, [initialSearch])

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

  useEffect(() => {
    api.aiHasBackup(slug).then(setAiBackup)
  }, [slug])
  useEffect(() => api.onAiProgress((p) => setAiProgress({ done: p.done, total: p.total })), [])

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
      if (e.ctrlKey && e.code === 'KeyF') {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
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
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        // Цифры 1–4 — скорость воспроизведения (1× / 1.25× / 1.5× / 2×).
        const r = rateForKey(e.code)
        if (r !== null) {
          e.preventDefault()
          setRate(r)
          const a = audioRef.current
          if (a) a.playbackRate = r
        }
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
  // Разрезать реплику: слово wordId становится началом новой реплики (тот же
  // говорящий по умолчанию — потом переназначается дропдауном «Кто говорит»).
  const onSplitTurn = (turnId: string, wordId: number): void => {
    const m = metaRef.current
    const turn = m?.turns?.find((t) => t.id === turnId)
    const w = turn?.words.find((x) => x.id === wordId)
    if (!turn || !w) return
    // Смена реплики = смена говорящего: новая реплика идёт другому говорящему
    // (для двоих — переключение). Если другого нет — остаётся тот же.
    const other = m?.speakers?.find((s) => s.id !== turn.spk)
    edit({
      op: 'splitTurn',
      turnId,
      atWordId: wordId,
      newTurnId: 'T-' + Date.now().toString(36) + '-' + wordId,
      spk: other?.id ?? turn.spk,
      startSec: w.s ?? turn.startSec
    })
  }

  const changeRate = (r: number): void => {
    setRate(r)
    const a = audioRef.current
    if (a) a.playbackRate = r
  }

  // -------- голосовая правка (надиктовать реплику заново) --------
  const startRedictate = async (turnId: string): Promise<void> => {
    if (redict) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      recChunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data)
      }
      recorderRef.current = rec
      rec.start()
      setRedict({ turnId, phase: 'rec' })
    } catch {
      alert('Микрофон недоступен. Проверьте, что он подключён и разрешён для приложения.')
    }
  }

  const finishRedictate = (commit: boolean): void => {
    const rec = recorderRef.current
    const target = redict
    if (!rec || !target) return
    rec.onstop = async () => {
      rec.stream.getTracks().forEach((t) => t.stop())
      recorderRef.current = null
      if (!commit) {
        setRedict(null)
        return
      }
      setRedict({ ...target, phase: 'stt' })
      try {
        const blob = new Blob(recChunksRef.current, { type: 'audio/webm' })
        const text = (await api.transcribeClip(await blob.arrayBuffer())).trim()
        if (!text) {
          alert('Речь не распозналась — попробуйте ещё раз, ближе к микрофону.')
          return
        }
        const m = metaRef.current
        if (!m) return
        let id = nextWordId(m)
        const words = text.split(/\s+/).map((t) => ({ id: id++, t, src: 'ai' as const }))
        edit({ op: 'setTurnWords', turnId: target.turnId, words })
      } catch (err) {
        alert('Не удалось распознать надиктовку: ' + String(err))
      } finally {
        setRedict(null)
      }
    }
    rec.stop()
  }

  if (!meta) {
    return (
      <main className="empty">
        <div className="empty-title">Загружаю проект…</div>
      </main>
    )
  }

  const runAiCleanup = async (): Promise<void> => {
    setAiBusy(true)
    setAiProgress({ done: 0, total: 0 })
    try {
      const m = await api.cleanupAi(slug)
      if (m) {
        loadMeta(m)
        setAiBackup(true)
      }
    } catch (err) {
      const s = String(err)
      if (s.includes('AI_UNAVAILABLE'))
        alert('Не удалось запустить локальный ИИ (Ollama). Проверь, что он установлен в D:\\Apps\\ollama.')
      else if (s.includes('AI_MODEL_MISSING'))
        alert('ИИ-модель qwen2.5:7b-instruct не найдена — её нужно скачать.')
      else alert('Не удалось причесать: ' + s)
    } finally {
      setAiBusy(false)
      setAiProgress(null)
    }
  }

  const revertAiCleanup = async (): Promise<void> => {
    const m = await api.revertAi(slug)
    if (m) {
      loadMeta(m)
      setAiBackup(false)
    }
  }

  const runHighlights = async (): Promise<void> => {
    setHlBusy(true)
    try {
      const m = await api.highlightAi(slug)
      if (m) loadMeta(m)
    } catch (err) {
      const s = String(err)
      if (s.includes('AI_UNAVAILABLE')) alert('Не удалось запустить локальный ИИ (Ollama).')
      else if (s.includes('AI_MODEL_MISSING')) alert('ИИ-модель не найдена — её нужно скачать.')
      else alert('Не удалось выделить мысли: ' + s)
    } finally {
      setHlBusy(false)
    }
  }

  const clearHl = async (): Promise<void> => {
    const m = await api.clearHighlightsAi(slug)
    if (m) loadMeta(m)
  }

  const runAnonymize = async (): Promise<void> => {
    setAnonBusy(true)
    try {
      const m = await api.anonymizeAi(slug)
      if (m) {
        loadMeta(m)
        setAnonMode(true) // сразу показываем результат
      }
    } catch (err) {
      const s = String(err)
      if (s.includes('AI_UNAVAILABLE')) alert('Не удалось запустить локальный ИИ (Ollama).')
      else if (s.includes('AI_MODEL_MISSING')) alert('ИИ-модель не найдена — её нужно скачать.')
      else alert('Не удалось обезличить: ' + s)
    } finally {
      setAnonBusy(false)
    }
  }
  const saveAnonRules = async (rules: AnonRule[]): Promise<void> => {
    const m = await api.setAnonRules(slug, rules)
    if (m) loadMeta(m)
  }

  const matchIds = new Set(searchMatches.map((m) => m.wordId))
  const curMatch = searchMatches[matchIdx]
  const stepMatch = (d: number): void => {
    if (searchMatches.length)
      setMatchIdx((i) => (i + d + searchMatches.length) % searchMatches.length)
  }
  const closeSearch = (): void => {
    setSearchOpen(false)
    setSearch('')
  }
  const doReplaceAll = (): void => {
    const find = search.trim()
    const n = searchMatches.length
    if (!find || !n) return
    const ok = window.confirm(
      `Заменить «${find}» на «${replace}» в ${n} ${plural(n, 'слове', 'словах', 'словах')}? Можно отменить через Ctrl+Z.`
    )
    if (!ok) return
    edit({ op: 'replaceAll', find, replace })
  }

  const hasText = (meta.turns?.length ?? 0) > 0
  const hasHl = !!meta.turns?.some((t) => t.words.some((w) => w.hl))
  const wordCount = (meta.turns ?? []).reduce(
    (n, t) => n + t.words.filter((w) => w.t.trim()).length,
    0
  )
  const anonRules = meta.anon ?? []
  const hasAnon = anonRules.length > 0

  return (
    <main className="editor">
      <div className="editor-head">
        <h1 className="editor-title">{meta.title}</h1>
        <span className="editor-sub">
          {fmtTime(meta.audio.durationSec)}
          {hasText && ` · ${wordCount.toLocaleString('ru-RU')} ${plural(wordCount, 'слово', 'слова', 'слов')}`}
          {meta.audio.repairedPrefixBytes > 0 && ' · файл починен при импорте'}
          {hasText && (dirty ? ' · сохраняю…' : ' · сохранено')}
        </span>
        {hasText && !reproc && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              className="btn btn-icon"
              onClick={() => setSearchOpen(true)}
              title="Поиск по тексту (Ctrl+F)"
            >
              <Icon name="search" size={16} />
            </button>
            <button
              className="btn btn-icon"
              onClick={() => setStatsOpen(true)}
              title="Статистика записи (баланс речи)"
            >
              <Icon name="chart" size={16} />
            </button>
            {hasAnon && (
              <button
                className={'btn' + (anonMode ? ' btn-primary' : '')}
                onClick={() => setAnonMode((v) => !v)}
                title="Показать/скрыть обезличенную версию"
              >
                {anonMode ? '🕶 Обезличено' : 'Обезличено'}
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => setLibraryOpen(true)}
              title="Сделать из расшифровки саммари, заметку, протокол — любой результат"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="sparkles" size={15} /> Сделать из текста
            </button>
            <AiMenu
              busyLabel={
                aiBusy
                  ? `Причёсываю${aiProgress && aiProgress.total ? ` ${aiProgress.done}/${aiProgress.total}` : '…'}`
                  : hlBusy
                    ? 'Ищу мысли…'
                    : anonBusy
                      ? 'Обезличиваю…'
                      : null
              }
              hasBackup={!!aiBackup}
              hasHl={hasHl}
              hasAnon={hasAnon}
              onCleanup={runAiCleanup}
              onRevert={revertAiCleanup}
              onHighlights={runHighlights}
              onShowList={() => setHlPanelOpen(true)}
              onClearHl={clearHl}
              onAnonymize={runAnonymize}
              onAnonList={() => setAnonPanelOpen(true)}
            />
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
            <ExportMenu slug={slug} meta={meta} anon={anonMode} />
          </div>
        )}
      </div>

      {searchOpen && (
        <div className="search-panel">
          <div className="search-bar">
            <Icon name="search" size={15} />
            <input
              className="search-input"
              autoFocus
              placeholder="Поиск по тексту…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setMatchIdx(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1)
                else if (e.key === 'Escape') closeSearch()
              }}
            />
            <span className="search-count">
              {searchMatches.length
                ? `${matchIdx + 1} из ${searchMatches.length}`
                : search
                  ? 'нет'
                  : ''}
            </span>
            <button
              className="btn"
              onClick={() => stepMatch(-1)}
              title="Назад"
              disabled={!searchMatches.length}
            >
              ↑
            </button>
            <button
              className="btn"
              onClick={() => stepMatch(1)}
              title="Вперёд"
              disabled={!searchMatches.length}
            >
              ↓
            </button>
            <button className="btn" onClick={closeSearch} title="Закрыть (Esc)">
              <Icon name="x" size={15} />
            </button>
          </div>
          <div className="search-bar">
            <span className="search-replace-label">Заменить на</span>
            <input
              className="search-input"
              placeholder="…новый текст (можно пусто — удалить)"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doReplaceAll()
                else if (e.key === 'Escape') closeSearch()
              }}
            />
            <button
              className="btn"
              onClick={doReplaceAll}
              disabled={!searchMatches.length}
              title="Заменить все вхождения"
            >
              Заменить всё
            </button>
          </div>
        </div>
      )}

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
          <>
            {anonMode && (
              <div className="anon-banner">
                🕶 Обезличенный вид. Подсвечено то, что заменил ИИ — пробегись глазами, он мог
                что-то пропустить. <button onClick={() => setAnonPanelOpen(true)}>Список замен</button>
              </div>
            )}
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
              onSplitTurn={onSplitTurn}
              onRedictate={(turnId) => void startRedictate(turnId)}
              matchIds={matchIds}
              currentMatchId={curMatch?.wordId ?? null}
              searchTurnIndex={searchOpen ? (curMatch?.turnIndex ?? null) : null}
              anonMode={anonMode}
              anonOverlay={anonOverlay}
            />
          </>
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
            title="Скорость воспроизведения (клавиши 1–4)"
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

      {libraryOpen && (
        <PromptLibraryPanel slug={slug} title={meta.title} onClose={() => setLibraryOpen(false)} />
      )}

      {hlPanelOpen && (
        <HighlightsPanel
          turns={meta.turns ?? []}
          slug={slug}
          title={meta.title}
          onJump={(sec) => {
            seek(sec + 0.01)
            setFollow(true)
            audioRef.current?.play().catch(() => {})
            setHlPanelOpen(false)
          }}
          onClose={() => setHlPanelOpen(false)}
        />
      )}

      {anonPanelOpen && (
        <AnonPanel
          rules={anonRules}
          onSave={(rules) => {
            void saveAnonRules(rules)
            setAnonPanelOpen(false)
          }}
          onClose={() => setAnonPanelOpen(false)}
        />
      )}

      {statsOpen && <StatsPanel meta={meta} onClose={() => setStatsOpen(false)} />}

      {redict && (
        <div className="redict-bar">
          {redict.phase === 'rec' ? (
            <>
              <span className="redict-dot" />
              <span>Говорите — реплика будет заменена вашими словами…</span>
              <button className="btn btn-primary" onClick={() => finishRedictate(true)}>
                Готово
              </button>
              <button className="btn" onClick={() => finishRedictate(false)}>
                Отмена
              </button>
            </>
          ) : (
            <span>Распознаю надиктовку… (локальный движок может думать до минуты)</span>
          )}
        </div>
      )}
    </main>
  )
}
