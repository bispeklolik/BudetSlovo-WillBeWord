import { useState } from 'react'
import type { Note } from '../../../shared/types'
import { api } from '../api'
import { useEscClose } from '../useEscClose'

export default function NoteViewer({
  note,
  onClose,
  onChanged
}: {
  note: Note
  onClose: () => void
  onChanged: () => void
}): React.JSX.Element {
  useEscClose(onClose)
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const dirty = title !== note.title || body !== note.body

  const save = async (): Promise<void> => {
    await api.saveNote({
      id: note.id,
      title: title.trim() || note.title,
      body,
      kind: note.kind,
      sourceSlug: note.sourceSlug,
      sourceTitle: note.sourceTitle
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    onChanged()
  }
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(body)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const del = async (): Promise<void> => {
    if (window.confirm('Удалить этот конспект? Действие необратимо.')) {
      await api.deleteNote(note.id)
      onChanged()
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal note-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <input
            className="text-input note-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <textarea
          className="note-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
        />
        <div className="modal-actions note-actions">
          <button className="btn" onClick={del} title="Удалить конспект">
            Удалить
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={copy}>
              {copied ? 'Скопировано ✓' : 'Копировать'}
            </button>
            <button className="btn" onClick={() => void api.exportTextDocx(title, body)}>
              Скачать .docx
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!dirty}>
              {saved ? 'Сохранено ✓' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
