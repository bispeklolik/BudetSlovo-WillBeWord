import { useEffect, useRef, useState } from 'react'
import type { Note } from '../../../shared/types'
import { api } from '../api'
import { humanError } from '../toast'
import { useEscClose } from '../useEscClose'

// Мои заметки к записи (как в Granola): пишу коротко что важно — ИИ дополняет
// их подробностями из расшифровки и сохраняет конспект. Заметки сохраняются сами.

export default function MyNotesPanel({
  slug,
  initial,
  hasText,
  onSaved,
  onResult,
  onClose
}: {
  slug: string
  initial: string
  hasText: boolean
  onSaved: (text: string) => void
  onResult: (note: Note) => void
  onClose: () => void
}): React.JSX.Element {
  const [text, setText] = useState(initial)
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const textRef = useRef(text)
  textRef.current = text
  const savedRef = useRef(initial)

  const flush = async (): Promise<void> => {
    clearTimeout(timer.current)
    const t = textRef.current
    if (t === savedRef.current) return
    setState('saving')
    await api.setMyNotes(slug, t)
    savedRef.current = t
    onSaved(t)
    setState(textRef.current === t ? 'saved' : 'dirty')
  }

  // Закрыли окно — дописать несохранённое.
  useEffect(() => () => void flush(), [])

  const close = (): void => {
    void flush()
    onClose()
  }
  useEscClose(close)

  const change = (v: string): void => {
    setText(v)
    setState('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 700)
  }

  const enhance = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      await flush()
      onResult(await api.enhanceNotes(slug))
    } catch (e) {
      setErr(humanError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Мои заметки</span>
          <span className="pane-count" style={{ marginRight: 10 }}>
            {state === 'saved' ? 'сохранено' : 'сохраняю…'}
          </span>
          <button className="btn" onClick={close}>
            Закрыть
          </button>
        </div>
        <div className="panel-note">
          Коротко запишите, что важно: темы, слова клиента, свои мысли. «Сделать конспект» — ИИ возьмёт ваши
          заметки за основу и дополнит их подробностями из расшифровки.
        </div>
        <textarea
          className="note-body"
          autoFocus
          value={text}
          placeholder={'- жалуется на сон\n- мама: «ты всегда всё портишь»\n- домашнее задание: дневник'}
          onChange={(e) => change(e.target.value)}
          spellCheck
        />
        {err && <div className="key-bad">{err}</div>}
        <div className="modal-actions">
          <button
            className="btn btn-primary"
            onClick={() => void enhance()}
            disabled={busy || !text.trim() || !hasText}
            title={hasText ? '' : 'Сначала расшифруйте запись'}
          >
            {busy ? 'Делаю конспект… (локальный ИИ — до нескольких минут)' : 'Сделать конспект из моих заметок'}
          </button>
        </div>
      </div>
    </div>
  )
}
