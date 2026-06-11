import { useEffect, useRef } from 'react'
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
}

export default function TranscriptView({
  meta,
  activeWordId,
  activeTurnIndex,
  follow,
  onWordClick,
  onUserScroll
}: Props): React.JSX.Element {
  const turns = meta.turns ?? []
  const ref = useRef<VirtuosoHandle>(null)

  const speakerName = (spk: string): string =>
    meta.speakers?.find((s) => s.id === spk)?.name ?? spk
  const speakerColor = (spk: string): string => {
    const key = meta.speakers?.find((s) => s.id === spk)?.colorKey ?? 'spk1'
    return `var(--${key})`
  }

  useEffect(() => {
    if (follow && activeTurnIndex !== null && ref.current) {
      ref.current.scrollToIndex({ index: activeTurnIndex, align: 'center', behavior: 'smooth' })
    }
  }, [activeTurnIndex, follow])

  const renderTurn = (_index: number, turn: Turn): React.JSX.Element => (
    <div className="turn" data-turn={turn.id}>
      <div className="turn-head" style={{ color: speakerColor(turn.spk) }}>
        {speakerName(turn.spk)} — {fmtTime(turn.startSec)}
      </div>
      <p className="turn-text">
        {turn.words.map((w) => (
          <span
            key={w.id}
            className={'word' + confClass(w) + (w.id === activeWordId ? ' active' : '')}
            data-word={w.id}
            onClick={() => onWordClick(w)}
          >
            {w.t}{' '}
          </span>
        ))}
      </p>
    </div>
  )

  return (
    <div className="transcript" data-testid="transcript" onWheel={onUserScroll}>
      <Virtuoso
        ref={ref}
        data={turns}
        context={{ activeWordId }}
        itemContent={renderTurn}
        computeItemKey={(_i, t) => t.id}
        increaseViewportBy={600}
      />
    </div>
  )
}
