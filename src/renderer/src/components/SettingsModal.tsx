import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Theme } from '../../../shared/types'
import { useEscClose } from '../useEscClose'

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
  useEffect(() => {
    api.aiAvailable().then(setAiReady)
  }, [])

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
        </div>

        <div className="settings-section">
          <div className="settings-label">Искусственный интеллект (локально)</div>
          <div className="settings-row">
            <span>Модель чистки и саммари</span>
            <span className="settings-status">
              {aiReady === null ? '…' : aiReady ? 'qwen2.5:7b — готова' : 'не найдена'}
            </span>
          </div>
          <div className="panel-note">
            Обработка идёт на вашем компьютере — запись никуда не отправляется. Облачные модели по
            API-ключу появятся позже.
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Горячие клавиши</div>
          {[
            ['Клик по слову', 'перейти к месту в аудио'],
            ['Пробел', 'играть / пауза'],
            ['← / →', '−5 / +5 секунд'],
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
