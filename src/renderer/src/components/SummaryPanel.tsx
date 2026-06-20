import { useState } from 'react'
import { api } from '../api'

type Level = 'note' | 'medium' | 'detailed'
const LABELS: Record<Level, string> = {
  note: 'Кратко (заметка)',
  medium: 'Средне (с тезисами)',
  detailed: 'Подробно'
}

type Domain = 'therapy' | 'business' | 'general'
const DOMAINS: Record<Domain, string> = {
  therapy: 'Терапия',
  business: 'Переговоры',
  general: 'Общее'
}

export default function SummaryPanel({
  slug,
  title,
  onClose
}: {
  slug: string
  title: string
  onClose: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState<Level | null>(null)
  const [level, setLevel] = useState<Level | null>(null)
  const [domain, setDomain] = useState<Domain>('therapy')
  const [result, setResult] = useState('')
  const [copied, setCopied] = useState(false)

  const run = async (lv: Level): Promise<void> => {
    setBusy(lv)
    setLevel(lv)
    setResult('')
    setCopied(false)
    try {
      const s = await api.summarizeAi(slug, lv, domain)
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
          <span className="panel-note" style={{ alignSelf: 'center', marginRight: 4 }}>
            Тип записи:
          </span>
          {(['therapy', 'business', 'general'] as Domain[]).map((d) => (
            <button
              key={d}
              className={'btn' + (domain === d ? ' btn-primary' : '')}
              disabled={busy !== null}
              onClick={() => setDomain(d)}
            >
              {DOMAINS[d]}
            </button>
          ))}
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
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                onClick={() => {
                  navigator.clipboard.writeText(result)
                  setCopied(true)
                }}
              >
                {copied ? 'Скопировано ✓' : 'Копировать'}
              </button>
              <button className="btn" onClick={() => api.exportTextDocx('Саммари — ' + title, result)}>
                Скачать .docx
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
