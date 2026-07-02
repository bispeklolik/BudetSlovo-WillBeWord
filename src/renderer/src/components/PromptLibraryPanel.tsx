import { useEffect, useState } from 'react'
import { api } from '../api'
import { useEscClose } from '../useEscClose'
import {
  BUILTIN_PROMPTS,
  CATEGORY_LABELS,
  type PromptCategory,
  type CustomPrompt
} from '../../../shared/prompts'

const CATEGORY_ORDER: PromptCategory[] = [
  'universal',
  'psychology',
  'meeting',
  'legal',
  'medical',
  'teaching',
  'journalism',
  'sales'
]

function errText(err: unknown): string {
  const m = String(err)
  if (m.includes('AI_UNAVAILABLE')) return 'Не удалось запустить локальный ИИ (Ollama).'
  if (m.includes('AI_MODEL_MISSING')) return 'ИИ-модель/ключ не готовы — проверьте настройки.'
  if (m.includes('AI_KEY_INVALID')) return 'Неверный ключ Claude — проверьте в настройках.'
  return 'Ошибка: ' + m
}

export default function PromptLibraryPanel({
  slug,
  title,
  onClose
}: {
  slug: string
  title: string
  onClose: () => void
}): React.JSX.Element {
  useEscClose(onClose)
  const [engineCloud, setEngineCloud] = useState(false)
  const [custom, setCustom] = useState<CustomPrompt[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [runningLabel, setRunningLabel] = useState('')
  const [result, setResult] = useState('')
  const [copied, setCopied] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [ownText, setOwnText] = useState('')
  const [ownName, setOwnName] = useState('')

  useEffect(() => {
    api.getSettings().then((s) => {
      setEngineCloud(s.aiEngine === 'claude')
      setCustom(s.customPrompts ?? [])
    })
  }, [])

  const run = async (system: string, label: string, key: string): Promise<void> => {
    setBusy(key)
    setRunningLabel(label)
    setResult('')
    setCopied(false)
    setSavedNote(false)
    try {
      const s = await api.runPromptAi(slug, system)
      setResult(s ?? '')
    } catch (err) {
      setResult(errText(err))
    } finally {
      setBusy(null)
    }
  }

  const saveCard = async (): Promise<void> => {
    const name = ownName.trim()
    const system = ownText.trim()
    if (!name || !system) return
    const next = [...custom, { id: 'c' + Date.now().toString(36), name, system }]
    setCustom(next)
    await api.setSettings({ customPrompts: next })
    setOwnName('')
  }

  const delCard = async (id: string): Promise<void> => {
    const next = custom.filter((c) => c.id !== id)
    setCustom(next)
    await api.setSettings({ customPrompts: next })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Сделать из текста</span>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="panel-note">
          Выберите, что сделать с расшифровкой — ИИ выполнит промт. Движок:{' '}
          {engineCloud ? 'Claude (облако)' : 'Локально'} — умную модель выбираете в настройках.
        </div>

        {busy && (
          <div className="panel-note">«{runningLabel}» — ИИ работает, это может занять до минуты…</div>
        )}

        {result ? (
          <>
            <div className="settings-label" style={{ marginTop: 4 }}>
              Результат — {runningLabel}
            </div>
            <textarea className="summary-result" readOnly value={result} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => setResult('')}>
                ← К списку
              </button>
              <button
                className="btn"
                onClick={() => {
                  navigator.clipboard.writeText(result)
                  setCopied(true)
                }}
              >
                {copied ? 'Скопировано ✓' : 'Копировать'}
              </button>
              <button
                className="btn"
                onClick={() => api.exportTextDocx(runningLabel + ' — ' + title, result)}
              >
                Скачать .docx
              </button>
              <button
                className="btn btn-primary"
                style={{ marginLeft: 'auto' }}
                onClick={async () => {
                  await api.saveNote({
                    kind: 'note',
                    title: runningLabel + ' — ' + title,
                    body: result,
                    sourceSlug: slug,
                    sourceTitle: title
                  })
                  setSavedNote(true)
                  setTimeout(() => setSavedNote(false), 1800)
                }}
              >
                {savedNote ? 'В конспектах ✓' : 'Сохранить в конспекты'}
              </button>
            </div>
          </>
        ) : (
          <div className="prompt-body">
            {custom.length > 0 && (
              <div className="prompt-cat">
                <div className="prompt-cat-title">Мои</div>
                <div className="prompt-grid">
                  {custom.map((c) => (
                    <div className="prompt-card-wrap" key={c.id}>
                      <button
                        className="prompt-card"
                        disabled={busy !== null}
                        onClick={() => run(c.system, c.name, c.id)}
                      >
                        {c.name}
                      </button>
                      <button
                        className="prompt-del"
                        title="Удалить карточку"
                        onClick={() => delCard(c.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {CATEGORY_ORDER.map((cat) => {
              const items = BUILTIN_PROMPTS.filter((p) => p.category === cat)
              if (items.length === 0) return null
              return (
                <div className="prompt-cat" key={cat}>
                  <div className="prompt-cat-title">{CATEGORY_LABELS[cat]}</div>
                  <div className="prompt-grid">
                    {items.map((p) => (
                      <button
                        key={p.id}
                        className="prompt-card"
                        disabled={busy !== null}
                        onClick={() => run(p.system, p.name, p.id)}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}

            <div className="prompt-cat">
              <div className="prompt-cat-title">Свой промт</div>
              <textarea
                className="text-input prompt-own"
                placeholder="Опишите, что сделать с расшифровкой. Напр.: «Вытащи все договорённости и сроки списком» или «Сделай пост для блога от первого лица»."
                value={ownText}
                onChange={(e) => setOwnText(e.target.value)}
              />
              <div className="prompt-own-actions">
                <button
                  className="btn btn-primary"
                  disabled={busy !== null || ownText.trim() === ''}
                  onClick={() => run(ownText.trim(), 'Свой промт', 'own')}
                >
                  Запустить
                </button>
                <input
                  className="text-input"
                  placeholder="имя карточки (чтобы сохранить)"
                  value={ownName}
                  onChange={(e) => setOwnName(e.target.value)}
                />
                <button
                  className="btn"
                  disabled={ownName.trim() === '' || ownText.trim() === ''}
                  onClick={saveCard}
                >
                  Сохранить карточкой
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
