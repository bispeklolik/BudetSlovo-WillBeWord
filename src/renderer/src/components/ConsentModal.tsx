import { useEffect, useRef, useState } from 'react'
import { CONSENT_TEMPLATE_RU } from '../../../shared/aiTasks'
import { api } from '../api'
import { useEscClose } from '../useEscClose'

// Шаблон согласия клиента на аудиозапись: правлю под себя (сохраняется в
// настройках), копирую или сохраняю в Word, чтобы распечатать и подписать.

export default function ConsentModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  useEscClose(onClose)
  const [text, setText] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = useRef<string | null>(null)

  // Совпадает с шаблоном — храним пусто: обновлённый шаблон подтянется сам.
  const flush = (): void => {
    clearTimeout(timer.current)
    if (pending.current === null) return
    const v = pending.current
    pending.current = null
    void api.setSettings({ consentText: v === CONSENT_TEMPLATE_RU ? '' : v })
  }

  useEffect(() => {
    api.getSettings().then((s) => setText(s.consentText?.trim() ? s.consentText : CONSENT_TEMPLATE_RU))
    return flush // закрыли окно сразу после правки — дописать
  }, [])

  const change = (v: string): void => {
    setText(v)
    pending.current = v
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 600)
  }

  const copy = async (): Promise<void> => {
    if (text === null) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide note-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Согласие клиента на запись</span>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="panel-note">
          Шаблон, а не юридическая консультация. Замените текст в [скобках], уберите лишнее. Правки сохраняются
          сами.
        </div>
        <textarea
          className="note-body"
          value={text ?? ''}
          onChange={(e) => change(e.target.value)}
          spellCheck
        />
        <div className="modal-actions">
          <button
            className="btn"
            style={{ marginRight: 'auto' }}
            onClick={() => {
              if (window.confirm('Вернуть исходный шаблон? Ваши правки пропадут.')) change(CONSENT_TEMPLATE_RU)
            }}
          >
            Вернуть шаблон
          </button>
          <button className="btn" onClick={() => void copy()}>
            {copied ? 'Скопировано ✓' : 'Копировать'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => text !== null && void api.exportTextDocx('Согласие на аудиозапись', text)}
          >
            Сохранить в Word
          </button>
        </div>
      </div>
    </div>
  )
}
