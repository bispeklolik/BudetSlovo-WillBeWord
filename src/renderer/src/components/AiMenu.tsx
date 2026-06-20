import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

interface AiMenuProps {
  busyLabel: string | null // когда идёт долгая операция — текст на кнопке, меню закрыто
  hasBackup: boolean // есть бэкап причёсывания → можно отменить
  hasHl: boolean // есть выделенные «лучшие мысли»
  onCleanup: () => void
  onRevert: () => void
  onSummary: () => void
  onHighlights: () => void
  onShowList: () => void
  onClearHl: () => void
}

export default function AiMenu(props: AiMenuProps): React.JSX.Element {
  const { busyLabel, hasBackup, hasHl } = props
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (fn: () => void): void => {
    fn()
    setOpen(false)
  }

  return (
    <div className="export-wrap" ref={wrapRef}>
      <button
        className="btn"
        disabled={!!busyLabel}
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        data-testid="ai-btn"
      >
        {busyLabel ?? (
          <>
            <Icon name="sparkles" size={15} /> ИИ ▾
          </>
        )}
      </button>
      {open && (
        <div className="export-menu">
          <button className="export-item" onClick={() => pick(props.onCleanup)}>
            Причесать текст
          </button>
          {hasBackup && (
            <button className="export-item" onClick={() => pick(props.onRevert)}>
              Отменить причёсывание
            </button>
          )}
          <div className="menu-sep" />
          <button className="export-item" onClick={() => pick(props.onSummary)}>
            Саммари…
          </button>
          <div className="menu-sep" />
          <button className="export-item" onClick={() => pick(props.onHighlights)}>
            {hasHl ? 'Обновить «лучшие мысли»' : 'Найти «лучшие мысли»'}
          </button>
          {hasHl && (
            <button className="export-item" onClick={() => pick(props.onShowList)}>
              Список мыслей
            </button>
          )}
          {hasHl && (
            <button className="export-item" onClick={() => pick(props.onClearHl)}>
              Убрать выделения
            </button>
          )}
        </div>
      )}
    </div>
  )
}
