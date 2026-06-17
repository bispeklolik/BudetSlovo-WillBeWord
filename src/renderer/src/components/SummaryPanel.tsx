import { useState } from 'react'
import { api } from '../api'

type Level = 'note' | 'medium' | 'detailed'
const LABELS: Record<Level, string> = {
  note: 'Кратко (заметка)',
  medium: 'Средне (с тезисами)',
  detailed: 'Подробно'
}

export default function SummaryPanel({
  slug,
  onClose
}: {
  slug: string
  onClose: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState<Level | null>(null)
  const [level, setLevel] = useState<Level | null>(null)
  const [result, setResult] = useState('')
  const [copied, setCopied] = useState(false)

  const run = async (lv: Level): Promise<void> => {
    setBusy(lv)
    setLevel(lv)
    setResult('')
    setCopied(false)
    try {
      const s = await api.summarizeAi(slug, lv)
      setResult(s ?? '')
    } catch (err) {
      const m = String(err)
      setResult(
        m.includes('AI_UNAVAILABLE')
          ? 'Не удалось запустить локальный ИИ (Ollama).'
          : m.includes('AI_MODEL_MISSING')
            ? 'ИИ-модель не найдена — её нужно скачать.'
            : 'Ошибка: ' + m
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Краткое содержание</span>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="summary-levels">
          {(['note', 'medium', 'detailed'] as Level[]).map((lv) => (
            <button
              key={lv}
              className={'btn' + (level === lv ? ' btn-primary' : '')}
              disabled={busy !== null}
              onClick={() => run(lv)}
            >
              {busy === lv ? 'Делаю…' : LABELS[lv]}
            </button>
          ))}
        </div>
        {busy && (
          <div className="panel-note">
            ИИ-модель работает локально на вашем компьютере — это может занять до минуты…
          </div>
        )}
        {result && (
          <>
            <textarea className="summary-result" readOnly value={result} />
            <div>
              <button
                className="btn"
                onClick={() => {
                  navigator.clipboard.writeText(result)
                  setCopied(true)
                }}
              >
                {copied ? 'Скопировано ✓' : 'Копировать'}
              </button>
            </div>
          </>
        )}
        {!result && !busy && (
          <div className="panel-note">Выберите уровень детализации — ИИ сделает содержание.</div>
        )}
      </div>
    </div>
  )
}
