import { useEffect, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { ProjectMeta, Turn, Word } from '../../../shared/types'

function fmtTime(sec: number): string {
  const t = Math.floor(sec)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function confClass(w: Word): string {
  if (w.t0 !== undefined || w.p === undefined) return ''
  if (w.p < 0.5) return ' low'
  if (w.p < 0.72) return ' mid'
  return ''
}

interface Props {
  meta: ProjectMeta
  activeWordId: number | null
  activeTurnIndex: number | null
  follow: boolean
  onWordClick: (w: Word) => void
  onUserScroll: () => void
  onCommitWord: (turnId: string, wordId: number, text: string) => void
  onInsertBefore: (turnId: string, index: number) => number
  onRenameSpeaker: (speakerId: string, name: string) => void
  onSetTurnSpeaker: (turnId: string, spk: string) => void
  onMergeTurn: (turnId: string) => void
  onSplitTurn: (turnId: string, wordId: number) => void
  matchIds: Set<number>
  currentMatchId: number | null
  searchTurnIndex: number | null
  anonMode: boolean
  anonOverlay: Map<number, string>
}

export default function TranscriptView(props: Props): React.JSX.Element {
  const { meta, activeWordId, activeTurnIndex, follow } = props
  const turns = meta.turns ?? []
  const ref = useRef<VirtuosoHandle>(null)

  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [spkEdit, setSpkEdit] = useState<string | null>(null)
  const [spkDraft, setSpkDraft] = useState('')

  const speaker = (spk: string): { name: string; color: string } => {
    const s = meta.speakers?.find((s) => s.id === spk)
    return { name: s?.name ?? spk, color: `var(--${s?.colorKey ?? 'spk1'})` }
  }

  useEffect(() => {
    if (follow && activeTurnIndex !== null && ref.current) {
      ref.current.scrollToIndex({ index: activeTurnIndex, align: 'center', behavior: 'smooth' })
    }
  }, [activeTurnIndex, follow])

  useEffect(() => {
    if (props.searchTurnIndex !== null && ref.current) {
      ref.current.scrollToIndex({ index: props.searchTurnIndex, align: 'center', behavior: 'smooth' })
    }
  }, [props.searchTurnIndex, props.currentMatchId])

  const startEdit = (w: Word): void => {
    setEditId(w.id)
    setDraft(w.t)
  }
  const commit = (turnId: string): void => {
    if (editId !== null) props.onCommitWord(turnId, editId, draft)
    setEditId(null)
  }

  const renderTurn = (index: number, turn: Turn): React.JSX.Element => {
    const sp = speaker(turn.spk)
    return (
      <div className="turn" data-turn={turn.id}>
        <div className="turn-head">
          {spkEdit === turn.spk ? (
            <input
              className="spk-input"
              value={spkDraft}
              autoFocus
              onChange={(e) => setSpkDraft(e.target.value)}
              onBlur={() => {
                props.onRenameSpeaker(turn.spk, spkDraft.trim() || sp.name)
                setSpkEdit(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setSpkEdit(null)
              }}
            />
          ) : (
            <button
              className="spk-name"
              style={{ color: sp.color }}
              title="Переименовать говорящего"
              onClick={() => {
                setSpkEdit(turn.spk)
                setSpkDraft(sp.name)
              }}
            >
              {sp.name}
            </button>
          )}
          <span className="turn-time">{fmtTime(turn.startSec)}</span>
          {(meta.speakers?.length ?? 0) > 1 && (
            <select
              className="turn-spk"
              value={turn.spk}
              title="Кто говорит в этой реплике"
              onChange={(e) => props.onSetTurnSpeaker(turn.id, e.target.value)}
            >
              {meta.speakers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {index > 0 && (
            <button
              className="turn-merge"
              title="Объединить с предыдущей репликой"
              onClick={() => props.onMergeTurn(turn.id)}
            >
              ⌃ объединить
            </button>
          )}
        </div>
        <p className="turn-text">
          {turn.words.map((w, i) => {
            if (props.anonMode) {
              const ov = props.anonOverlay.get(w.id)
              if (ov === '') return null // скрытый хвост многословной замены
              const replaced = ov !== undefined
              return (
                <span className="wtok" key={w.id}>
                  <span
                    className={
                      'word' +
                      (replaced ? ' anon' : '') +
                      (w.id === activeWordId ? ' active' : '')
                    }
                    data-word={w.id}
                    onClick={() => props.onWordClick(w)}
                  >
                    {replaced ? ov : w.t}
                  </span>{' '}
                </span>
              )
            }
            return (
            <span className="wtok" key={w.id}>
              <button
                className="ins"
                title="Вставить слово"
                tabIndex={-1}
                onClick={() => {
                  const id = props.onInsertBefore(turn.id, i)
                  setEditId(id)
                  setDraft('')
                }}
              >
                +
              </button>
              {i > 0 && (
                <button
                  className="splitbtn"
                  title="Разделить: новая реплика с этого слова"
                  tabIndex={-1}
                  onClick={() => props.onSplitTurn(turn.id, w.id)}
                >
                  ⏎
                </button>
              )}
              {editId === w.id ? (
                <input
                  className="word-input"
                  value={draft}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(turn.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    else if (e.key === 'Escape') setEditId(null)
                  }}
                />
              ) : (
                <span
                  className={
                    'word' +
                    confClass(w) +
                    (w.src ? ' ' + w.src : '') +
                    (w.hl ? ' hl' : '') +
                    (props.matchIds.has(w.id)
                      ? w.id === props.currentMatchId
                        ? ' match-current'
                        : ' match'
                      : '') +
                    (w.id === activeWordId ? ' active' : '')
                  }
                  data-word={w.id}
                  title={
                    w.src === 'suspect'
                      ? 'ИИ: возможно, ошибка распознавания — проверь'
                      : w.src === 'ai'
                        ? w.t0 !== undefined
                          ? 'ИИ поправил · исходно: ' + w.t0.trim()
                          : 'вставлено ИИ'
                        : w.t0 !== undefined
                          ? 'исходно: ' + w.t0.trim()
                          : undefined
                  }
                  onClick={() => props.onWordClick(w)}
                  onDoubleClick={() => startEdit(w)}
                >
                  {w.t}
                  <button
                    className="wdel"
                    title="Удалить слово"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onCommitWord(turn.id, w.id, '')
                    }}
                  >
                    ×
                  </button>
                </span>
              )}{' '}
            </span>
            )
          })}
          {!props.anonMode && (
            <button
              className="ins ins-end"
              title="Добавить слово в конец"
              tabIndex={-1}
              onClick={() => {
                const id = props.onInsertBefore(turn.id, turn.words.length)
                setEditId(id)
                setDraft('')
              }}
            >
              +
            </button>
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="transcript" data-testid="transcript" onWheel={props.onUserScroll}>
      <Virtuoso
        ref={ref}
        data={turns}
        itemContent={renderTurn}
        computeItemKey={(_i, t) => t.id}
        increaseViewportBy={600}
      />
    </div>
  )
}
