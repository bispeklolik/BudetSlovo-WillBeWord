import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Theme, AiEngine, SttEngine, Settings, DictationSettings } from '../../../shared/types'
import { defaultDictation } from '../../../shared/types'
import { STT_ENGINES, sttMeta, sttModeLabel } from '../../../shared/sttEngines'
import { useEscClose } from '../useEscClose'

// Клавиши для диктовки: без левых модификаторов (они испортили бы Ctrl+V
// вставку), одиночные и правые — то, что редко занято.
const DICT_KEYS: { id: string; label: string }[] = [
  { id: 'F9', label: 'F9' },
  { id: 'F8', label: 'F8' },
  { id: 'F6', label: 'F6' },
  { id: 'F10', label: 'F10' },
  { id: 'F12', label: 'F12' },
  { id: 'ControlRight', label: 'Правый Ctrl' },
  { id: 'AltRight', label: 'Правый Alt' },
  { id: 'ShiftRight', label: 'Правый Shift' },
  { id: 'CapsLock', label: 'CapsLock' },
  { id: 'ScrollLock', label: 'ScrollLock' },
  { id: 'Pause', label: 'Pause' },
  { id: 'Insert', label: 'Insert' },
  { id: 'NumpadAdd', label: 'Num +' },
  { id: 'NumpadSubtract', label: 'Num −' }
]

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
  const [orKey, setOrKey] = useState('')
  const [orModel, setOrModel] = useState('anthropic/claude-sonnet-5')
  const [stt, setStt] = useState<SttEngine>('local')
  const [sttKeys, setSttKeys] = useState<Record<string, string>>({})
  const [showAllStt, setShowAllStt] = useState(false)
  const [dict, setDict] = useState<DictationSettings>({ ...defaultDictation })

  useEffect(() => {
    api.aiAvailable().then(setAiReady)
    api.getSettings().then((s) => {
      setEngine(s.aiEngine ?? 'local-llama')
      setKey(s.anthropicKey ?? '')
      setModel(s.claudeModel ?? 'claude-sonnet-4-6')
      setOrKey(s.openrouterKey ?? '')
      setOrModel(s.openrouterModel ?? 'anthropic/claude-sonnet-5')
      setStt(s.sttEngine ?? 'local')
      setSttKeys(s.sttKeys ?? {})
      setDict({ ...defaultDictation, ...s.dictation })
    })
  }, [])

  const saveDict = (patch: Partial<DictationSettings>): void => {
    const next = { ...dict, ...patch }
    setDict(next)
    void api.setSettings({ dictation: next })
  }

  const sm = sttMeta(stt)

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
          <div className="settings-label">Расшифровка</div>
          <div className="settings-row">
            <span>Движок</span>
            <select
              className="rate"
              value={stt}
              onChange={(e) => {
                const id = e.target.value as SttEngine
                setStt(id)
                save({ sttEngine: id })
              }}
            >
              {STT_ENGINES.filter((m) => showAllStt || !m.advanced || m.id === stt).map((m) => (
                <option key={m.id} value={m.id}>
                  {sttModeLabel(m)}
                  {m.diarize ? '' : ' · один голос'}
                </option>
              ))}
            </select>
          </div>
          {sm?.cloud ? (
            <>
              <div className="input-label">Ключ {sm.label} (вставьте свой; хранится локально)</div>
              <input
                className="text-input"
                type="password"
                placeholder={sm.keyHint ? 'ключ · ' + sm.keyHint : 'вставьте ключ'}
                value={sttKeys[stt] ?? ''}
                onChange={(e) => setSttKeys({ ...sttKeys, [stt]: e.target.value })}
                onBlur={() => save({ sttKeys: { ...sttKeys, [stt]: (sttKeys[stt] ?? '').trim() } })}
              />
              <div className="panel-note">
                {sm.price} ·{' '}
                {sm.diarize
                  ? 'разделяет говорящих (Психолог/Клиент).'
                  : 'без разделения — один голос.'}{' '}
                Аудио уходит на серверы {sm.label} (облако). Для клиентских сессий выбирайте
                осознанно{sm.keyHint ? `; ключ — на ${sm.keyHint}` : ''}.
              </div>
            </>
          ) : (
            <div className="panel-note">Расшифровка на вашем компьютере — аудио никуда не уходит.</div>
          )}
          <button className="text-link" onClick={() => setShowAllStt((v) => !v)}>
            {showAllStt ? 'Скрыть дополнительные движки' : 'Показать все движки (OpenAI, Groq, AssemblyAI)'}
          </button>
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
              <button
                className={'btn' + (engine === 'openrouter' ? ' btn-primary' : '')}
                onClick={() => {
                  setEngine('openrouter')
                  save({ aiEngine: 'openrouter' })
                }}
              >
                OpenRouter (облако)
              </button>
            </div>
          </div>

          {engine === 'local-llama' && (
            <>
              <div className="settings-row">
                <span>Локальная модель</span>
                <span className="settings-status">
                  {aiReady === null ? '…' : aiReady ? 'qwen2.5:7b · готова' : 'не найдена'}
                </span>
              </div>
              <div className="panel-note">Обработка на вашем компьютере — ничего не уходит наружу.</div>
            </>
          )}
          {engine === 'claude' && (
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
          {engine === 'openrouter' && (
            <>
              <div className="input-label">Ключ OpenRouter (вставьте свой; хранится локально)</div>
              <input
                className="text-input"
                type="password"
                placeholder="sk-or-…"
                value={orKey}
                onChange={(e) => setOrKey(e.target.value)}
                onBlur={() => save({ openrouterKey: orKey.trim() })}
              />
              <div className="input-label">Модель (id с openrouter.ai/models)</div>
              <input
                className="text-input"
                list="or-models"
                placeholder="anthropic/claude-sonnet-5"
                value={orModel}
                onChange={(e) => setOrModel(e.target.value)}
                onBlur={() => save({ openrouterModel: orModel.trim() })}
              />
              <datalist id="or-models">
                <option value="anthropic/claude-sonnet-5">Claude Sonnet 5 · умная</option>
                <option value="google/gemini-2.5-pro">Gemini 2.5 Pro · умная</option>
                <option value="google/gemini-2.5-flash">Gemini 2.5 Flash · быстрая</option>
                <option value="deepseek/deepseek-v4-pro">DeepSeek v4 Pro · дёшево и умно</option>
                <option value="anthropic/claude-haiku-4.5">Claude Haiku 4.5 · дёшево</option>
              </datalist>
              <div className="panel-note">
                Один ключ — сотни моделей (openrouter.ai, оплата по факту). Для саммари и супервизора
                берите умную модель. Обезличивание всегда работает локально.
              </div>
            </>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-label">Диктовка в любое окно</div>
          <div className="settings-row">
            <span>Включена</span>
            <button
              className={'btn' + (dict.enabled ? ' btn-primary' : '')}
              onClick={() => saveDict({ enabled: !dict.enabled })}
            >
              {dict.enabled ? 'Вкл' : 'Выкл'}
            </button>
          </div>
          {dict.enabled && (
            <>
              <div className="settings-row">
                <span>Клавиша</span>
                <select
                  className="rate"
                  value={dict.hotkey}
                  onChange={(e) => saveDict({ hotkey: e.target.value })}
                >
                  {DICT_KEYS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <span>ИИ-чистка текста (паразиты, пунктуация)</span>
                <button
                  className={'btn' + (dict.polish ? ' btn-primary' : '')}
                  onClick={() => saveDict({ polish: !dict.polish })}
                >
                  {dict.polish ? 'Вкл' : 'Выкл'}
                </button>
              </div>
              <div className="settings-row">
                <span>Вставлять в активное окно</span>
                <button
                  className={'btn' + (dict.autoPaste ? ' btn-primary' : '')}
                  onClick={() => saveDict({ autoPaste: !dict.autoPaste })}
                >
                  {dict.autoPaste ? 'Вкл' : 'только в буфер'}
                </button>
              </div>
              <div className="settings-row">
                <span>Звуковые сигналы</span>
                <button
                  className={'btn' + (dict.sounds ? ' btn-primary' : '')}
                  onClick={() => saveDict({ sounds: !dict.sounds })}
                >
                  {dict.sounds ? 'Вкл' : 'Выкл'}
                </button>
              </div>
              <div className="panel-note">
                Зажмите клавишу — говорите, отпустите — текст вставится туда, где курсор. Быстрое
                двойное нажатие — запись без рук до следующего нажатия. Esc — отмена. Распознаёт
                движок из раздела «Расшифровка»; чистку делает движок из раздела «ИИ». Все диктовки
                сохраняются в журнал в папке данных.
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
