import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { api } from '../api'
import { aiEngineLabel } from '../../../shared/aiRouting'
import type { AiTask } from '../../../shared/types'

interface AiMenuProps {
  busyLabel: string | null // когда идёт долгая операция — текст на кнопке, меню закрыто
  hasBackup: boolean // есть бэкап причёсывания → можно отменить
  hasHl: boolean // есть выделенные «лучшие мысли»
  hasAnon: boolean // есть правила обезличивания
  hasUncertain: boolean // в записи есть неуверенные слова
  onPrepareWords: () => void // подготовить варианты для неуверенных слов
  onCleanup: () => void
  onRevert: () => void
  onHighlights: () => void
  onShowList: () => void
  onClearHl: () => void
  onAnonymize: () => void
  onAnonList: () => void
}

export default function AiMenu(props: AiMenuProps): React.JSX.Element {
  const { busyLabel, hasBackup, hasHl } = props
  const [open, setOpen] = useState(false)
  const [engineLabel, setEngineLabel] = useState('Локально')
  // Подпись «своего» ИИ у пунктов, где он отличается от общего (настройка «Свой ИИ для отдельных задач»).
  const [own, setOwn] = useState<Partial<Record<AiTask, string>>>({})
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open)
      api.getSettings().then((s) => {
        const common = aiEngineLabel({ ...s, aiTasks: undefined }, 'notes')
        setEngineLabel(common)
        const diff: Partial<Record<AiTask, string>> = {}
        for (const t of ['cleanup', 'highlights', 'variants'] as AiTask[]) {
          const l = aiEngineLabel(s, t)
          if (l !== common) diff[t] = l
        }
        setOwn(diff)
      })
  }, [open])

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
    <div className="export-wrap" ref={wrapRef} data-tour="editor-ai">
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
          <div className="export-note">
            Общий движок: {engineLabel}
          </div>
          <div className="menu-sep" />
          <button className="export-item" onClick={() => pick(props.onCleanup)}>
            Причесать текст{own.cleanup ? ` · ${own.cleanup}` : ''}
          </button>
          {hasBackup && (
            <button className="export-item" onClick={() => pick(props.onRevert)}>
              Отменить причёсывание
            </button>
          )}
          <div className="menu-sep" />
          <button className="export-item" onClick={() => pick(props.onHighlights)}>
            {hasHl ? 'Обновить «лучшие мысли»' : 'Найти «лучшие мысли»'}
            {own.highlights ? ` · ${own.highlights}` : ''}
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
          {props.hasUncertain && (
            <>
              <div className="menu-sep" />
              <button
                className="export-item"
                onClick={() => pick(props.onPrepareWords)}
                title="Спросить ИИ про все подсвеченные слова заранее: потом варианты откроются сразу"
              >
                Подготовить варианты для неуверенных слов{own.variants ? ` · ${own.variants}` : ''}
              </button>
            </>
          )}
          <div className="menu-sep" />
          <button className="export-item" onClick={() => pick(props.onAnonymize)}>
            {props.hasAnon ? 'Обновить обезличивание' : 'Обезличить (убрать имена)'}
          </button>
          {props.hasAnon && (
            <button className="export-item" onClick={() => pick(props.onAnonList)}>
              Список замен…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
