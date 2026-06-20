import type { Turn } from '../../../shared/types'
import { useEscClose } from '../useEscClose'

interface Span {
  text: string
  sec: number
}

// Собираем подсвеченные «лучшие мысли»: подряд идущие слова с hl → один span.
function collectSpans(turns: Turn[]): Span[] {
  const spans: Span[] = []
  for (const t of turns) {
    let buf: string[] = []
    let sec = t.startSec
    let started = false
    const flush = (): void => {
      if (buf.length) spans.push({ text: buf.join(' ').replace(/\s+/g, ' ').trim(), sec })
      buf = []
      started = false
    }
    for (const w of t.words) {
      if (w.hl) {
        if (!started) {
          sec = w.s ?? t.startSec
          started = true
        }
        buf.push(w.t)
      } else flush()
    }
    flush()
  }
  return spans
}

export default function HighlightsPanel({
  turns,
  onJump,
  onClose
}: {
  turns: Turn[]
  onJump: (sec: number) => void
  onClose: () => void
}): React.JSX.Element {
  useEscClose(onClose)
  const spans = collectSpans(turns)
  const fmt = (sec: number): string => {
    const t = Math.floor(sec)
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Лучшие мысли</span>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {spans.length === 0 ? (
          <div className="panel-note">
            Пока ничего не выделено. Нажмите «Лучшие мысли» в редакторе — ИИ найдёт ключевые места.
          </div>
        ) : (
          <div className="hl-list">
            {spans.map((s, i) => (
              <button key={i} className="hl-item" onClick={() => onJump(s.sec)}>
                <span className="hl-item-time">{fmt(s.sec)}</span>
                <span className="hl-item-text">{s.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
