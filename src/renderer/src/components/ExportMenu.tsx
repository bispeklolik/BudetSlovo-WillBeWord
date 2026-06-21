import { useEffect, useRef, useState } from 'react'
import type { ProjectMeta } from '../../../shared/types'
import { buildAnonOverlay, anonTurnText } from '../../../shared/anon'
import { api } from '../api'

export default function ExportMenu({
  slug,
  meta,
  anon
}: {
  slug: string
  meta: ProjectMeta
  anon: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Текст с именами говорящих — для вставки в черновик/заметки. Уважает режим обезличивания.
  const plainText = (): string => {
    const name = (spk: string): string => meta.speakers?.find((s) => s.id === spk)?.name ?? spk
    const overlay = anon ? buildAnonOverlay(meta.turns ?? [], meta.anon ?? []) : null
    return (meta.turns ?? [])
      .map((t) => {
        const body = overlay
          ? anonTurnText(t, overlay)
          : t.words
              .map((w) => w.t)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim()
        return `${name(t.spk)}:\n${body}`
      })
      .join('\n\n')
  }

  const copyText = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(plainText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch (err) {
      alert('Не удалось скопировать: ' + String(err))
    }
  }

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const run = async (format: 'docx' | 'md' | 'txt' | 'srt' | 'vtt'): Promise<void> => {
    setBusy(true)
    try {
      await api.exportTranscript(slug, format, format === 'docx' ? highlight : false, anon)
    } catch (err) {
      alert('Не удалось сохранить: ' + String(err))
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  const runAudio = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.exportAudio(slug)
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
          {anon && (
            <>
              <div className="export-note">🕶 Режим «Обезличено» включён — выгрузится без имён</div>
              <div className="menu-sep" />
            </>
          )}
          <button className="export-item" onClick={copyText}>
            {copied ? 'Скопировано ✓' : 'Скопировать текст'}
          </button>
          <div className="menu-sep" />
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
          <button className="export-item" disabled={busy} onClick={() => run('srt')}>
            Субтитры (.srt)
          </button>
          <button className="export-item" disabled={busy} onClick={() => run('vtt')}>
            Субтитры (.vtt)
          </button>
          <button className="export-item" disabled={busy} onClick={runAudio}>
            Аудио (.m4a)
          </button>
        </div>
      )}
    </div>
  )
}
