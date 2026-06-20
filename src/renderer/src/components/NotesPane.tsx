import { useEffect, useState } from 'react'
import type { Note } from '../../../shared/types'
import { api } from '../api'
import NoteViewer from './NoteViewer'

const KIND_LABEL: Record<Note['kind'], string> = {
  summary: 'Саммари',
  thoughts: 'Лучшие мысли',
  note: 'Заметка'
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export default function NotesPane({
  onCountChange
}: {
  onCountChange: (n: number) => void
}): React.JSX.Element {
  const [notes, setNotes] = useState<Note[]>([])
  const [open, setOpen] = useState<Note | null>(null)

  const load = (): void => {
    api.listNotes().then((n) => {
      setNotes(n)
      onCountChange(n.length)
    })
  }
  useEffect(load, [])

  return (
    <>
      <div className="pane-head">
        Конспекты <span className="pane-count">{notes.length}</span>
      </div>
      {notes.length === 0 ? (
        <div className="empty">
          <div className="empty-title">Здесь будут ваши конспекты</div>
          <div>
            Откройте запись → «✨ ИИ» → «Саммари» или «Лучшие мысли» → «Сохранить в конспекты»
          </div>
        </div>
      ) : (
        <div className="project-grid">
          {notes.map((n) => (
            <div
              key={n.id}
              className="note-card"
              role="button"
              tabIndex={0}
              onClick={() => setOpen(n)}
            >
              <span className={'note-badge note-' + n.kind}>{KIND_LABEL[n.kind]}</span>
              <div className="project-card-title">{n.title}</div>
              <div className="note-card-preview">{n.body.slice(0, 160)}</div>
              <div className="project-card-meta">
                {n.sourceTitle ? `из «${n.sourceTitle}» · ` : ''}
                {fmtDate(n.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && <NoteViewer note={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  )
}
