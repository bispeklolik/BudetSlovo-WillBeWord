import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

export default function ExportMenu({ slug }: { slug: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(true)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const run = async (format: 'docx' | 'md' | 'txt'): Promise<void> => {
    setBusy(true)
    try {
      await api.exportTranscript(slug, format, format === 'docx' ? highlight : false)
    } catch (err) {
      alert('Не удалось сохранить: ' + String(err))
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <div className="export-wrap" ref={wrapRef}>
      <button className="btn" onClick={() => setOpen((v) => !v)} data-testid="export-btn">
        Экспорт ▾
      </button>
      {open && (
        <div className="export-menu">
          <label className="export-check">
            <input
              type="checkbox"
              checked={highlight}
              onChange={(e) => setHighlight(e.target.checked)}
            />
            <span>с подсветкой неуверенных мест</span>
          </label>
          <button className="export-item" disabled={busy} onClick={() => run('docx')}>
            Word (.docx)
          </button>
          <button className="export-item" disabled={busy} onClick={() => run('md')}>
            Markdown (.md)
          </button>
          <button className="export-item" disabled={busy} onClick={() => run('txt')}>
            Текст (.txt)
          </button>
        </div>
      )}
    </div>
  )
}
