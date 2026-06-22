import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Theme, AiEngine, Settings } from '../../../shared/types'
import { useEscClose } from '../useEscClose'

const MODELS: { id: string; label: string }[] = [
  { id: 'claude-haiku-4-5', label: 'Haiku · дёшево' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet · баланс' },
  { id: 'claude-opus-4-8', label: 'Opus · макс' }
]

export default function SettingsModal({
  theme,
  onToggleTheme,
  onClose
}: {
  theme: Theme
  onToggleTheme: () => void
  onClose: () => void
}): React.JSX.Element {
  useEscClose(onClose)
  const [aiReady, setAiReady] = useState<boolean | null>(null)
  const [engine, setEngine] = useState<AiEngine>('local-llama')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-6')

  useEffect(() => {
    api.aiAvailable().then(setAiReady)
    api.getSettings().then((s) => {
      setEngine(s.aiEngine ?? 'local-llama')
      setKey(s.anthropicKey ?? '')
      setModel(s.claudeModel ?? 'claude-sonnet-4-6')
    })
  }, [])

  const save = (patch: Partial<Settings>): void => {
    void api.setSettings(patch)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Настройки</span>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-row">
            <span>Тема оформления</span>
            <button className="btn" onClick={onToggleTheme}>
              {theme === 'dark' ? 'Тёмная' : 'Светлая'}
            </button>
          </div>
          <div className="settings-row">
            <span>Папка с записями и данными</span>
            <button className="btn" onClick={() => void api.openDataDir()}>
              Открыть
            </button>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Искусственный интеллект</div>
          <div className="settings-row">
            <span>Движок</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className={'btn' + (engine === 'local-llama' ? ' btn-primary' : '')}
                onClick={() => {
                  setEngine('local-llama')
                  save({ aiEngine: 'local-llama' })
                }}
              >
                Локально
              </button>
              <button
                className={'btn' + (engine === 'claude' ? ' btn-primary' : '')}
                onClick={() => {
                  setEngine('claude')
                  save({ aiEngine: 'claude' })
                }}
              >
                Claude (облако)
              </button>
            </div>
          </div>

          {engine === 'local-llama' ? (
            <>
              <div className="settings-row">
                <span>Локальная модель</span>
                <span className="settings-status">
                  {aiReady === null ? '…' : aiReady ? 'qwen2.5:7b · готова' : 'не найдена'}
                </span>
              </div>
              <div className="panel-note">Обработка на вашем компьютере — ничего не уходит наружу.</div>
            </>
          ) : (
            <>
              <div className="input-label">Ключ Anthropic API (вставьте свой; хранится локально)</div>
              <input
                className="text-input"
                type="password"
                placeholder="sk-ant-…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onBlur={() => save({ anthropicKey: key.trim() })}
              />
              <div className="settings-row">
                <span>Модель</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      className={'btn' + (model === m.id ? ' btn-primary' : '')}
                      onClick={() => {
                        setModel(m.id)
                        save({ claudeModel: m.id })
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="panel-note">
                Ключ берётся на console.anthropic.com (оплата по факту, это не подписка). Обезличивание
                всегда работает локально — для клиентских сессий сначала обезличьте, потом отправляйте
                в Claude.
              </div>
            </>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-label">Горячие клавиши</div>
          {[
            ['Клик по слову', 'перейти к месту в аудио'],
            ['Пробел', 'играть / пауза'],
            ['← / →', '−5 / +5 секунд'],
            ['1 … 4', 'скорость 1× / 1.25× / 1.5× / 2×'],
            ['Ctrl + F', 'поиск и замена'],
            ['Ctrl + Z / Ctrl + Y', 'отменить / повторить'],
            ['Esc', 'закрыть поиск или окно']
          ].map(([k, v]) => (
            <div className="settings-row" key={k}>
              <span>{k}</span>
              <span className="settings-status">{v}</span>
            </div>
          ))}
        </div>

        <div className="panel-note">Слово — локальный редактор расшифровок.</div>
      </div>
    </div>
  )
}
