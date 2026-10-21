import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Theme, AiEngine, SttEngine, Settings, DictationSettings, SetupInfo } from '../../../shared/types'
import { defaultDictation } from '../../../shared/types'
import { STT_ENGINES, sttMeta, sttModeLabel } from '../../../shared/sttEngines'
import { useEscClose } from '../useEscClose'
import { LOCAL_MODELS, localModel, formatBytes } from '../../../shared/localModels'
import { showToast, humanError } from '../toast'
import DictationHistory, { MicSelect } from './DictationHistory'
import ConsentModal from './ConsentModal'
import VocabPanel from './VocabPanel'
import McpSection from './McpSection'
import { DICT_MODES, TONE_NAMES, findMode, type DictTone } from '../../../shared/dictModes'

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

// Подписи программ для списка «не предлагать запись» (id — из shared/callDetect).
const CALL_APP_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  zoom: 'Zoom',
  teams: 'Teams',
  whatsapp: 'WhatsApp',
  skype: 'Skype',
  discord: 'Discord',
  viber: 'Viber',
  telemost: 'Телемост',
  browser: 'браузер'
}

const MODELS: { id: string; label: string }[] = [
  { id: 'claude-haiku-4-5', label: 'Haiku · дёшево' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet · баланс' },
  { id: 'claude-opus-4-8', label: 'Opus · макс' }
]

export default function SettingsModal({
  theme,
  onToggleTheme,
  onClose,
  onOpenWelcome
}: {
  theme: Theme
  onToggleTheme: () => void
  onClose: () => void
  onOpenWelcome: () => void
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
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [localId, setLocalId] = useState('large-v3')
  const [device, setDevice] = useState<'auto' | 'cuda' | 'cpu'>('auto')
  const [backupBusy, setBackupBusy] = useState<string | null>(null)
  const [pauseSec, setPauseSec] = useState(3)
  const [pauseExport, setPauseExport] = useState(true)
  const [callPrompt, setCallPrompt] = useState(true)
  const [consentOpen, setConsentOpen] = useState(false)
  const [vocabOpen, setVocabOpen] = useState(false)
  const [callMuted, setCallMuted] = useState<string[]>([])

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
      setLocalId(localModel(s.localModel).id)
      setDevice(s.localDevice ?? 'auto')
      setPauseSec(s.pauseMarkSec ?? 3)
      setPauseExport(s.pauseInExport !== false)
      setCallPrompt(s.callPrompt !== false)
      setCallMuted(s.callMuted ?? [])
    })
    api.setupInfo().then(setInfo)
  }, [])

  const doBackup = async (): Promise<void> => {
    setBackupBusy('Создаю копию…')
    try {
      const r = await api.createBackup()
      if (r) showToast(`Копия сохранена: ${r.path} (${formatBytes(r.bytes)})`)
    } catch (err) {
      showToast('Копия не создалась: ' + humanError(err))
    } finally {
      setBackupBusy(null)
    }
  }
  const doRestore = async (): Promise<void> => {
    setBackupBusy('Восстанавливаю…')
    try {
      const r = await api.restoreBackup()
      if (r) showToast('Данные восстановлены. «Слово» перезапускается…')
    } catch (err) {
      showToast('Восстановить не удалось: ' + humanError(err))
    } finally {
      setBackupBusy(null)
    }
  }

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
      <div className="modal modal-scroll" onClick={(e) => e.stopPropagation()}>
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
            <span>С чего начать: пример, облако или движок на этом компьютере</span>
            <button className="btn" onClick={onOpenWelcome}>
              Открыть мастер
            </button>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Данные и резервная копия</div>
          <div className="settings-row">
            <span className="settings-status" style={{ wordBreak: 'break-all' }}>
              {info?.dataDir ?? '…'}
            </span>
            <button className="btn" onClick={() => void api.openDataDir()}>
              Открыть папку
            </button>
          </div>
          <div className="settings-row">
            <span>Все записи, конспекты и настройки — одним файлом .zip</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn" disabled={!!backupBusy} onClick={doBackup}>
                {backupBusy === 'Создаю копию…' ? backupBusy : 'Сделать копию'}
              </button>
              <button className="btn" disabled={!!backupBusy} onClick={doRestore}>
                {backupBusy === 'Восстанавливаю…' ? backupBusy : 'Восстановить'}
              </button>
            </div>
          </div>
          <div className="panel-note">
            В копии лежат ваши записи и ключи сервисов — храните её так же бережно, как записи клиентов.
            Модели и движок в копию не входят: их можно скачать заново.
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
            <>
              {info && !info.engine.installed ? (
                <div className="settings-row">
                  <span className="key-bad">Локальный движок ещё не установлен.</span>
                  <button className="btn btn-primary" onClick={onOpenWelcome}>
                    Скачать
                  </button>
                </div>
              ) : (
                <>
                  <div className="settings-row">
                    <span>Модель</span>
                    <select
                      className="rate"
                      value={localId}
                      onChange={(e) => {
                        setLocalId(e.target.value)
                        save({ localModel: e.target.value })
                      }}
                    >
                      {LOCAL_MODELS.filter((m) => info?.installedModels.includes(m.id) || m.id === localId).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                          {info?.installedModels.includes(m.id) ? '' : ' · скачается при первой расшифровке'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-row">
                    <span>Считать на</span>
                    <select
                      className="rate"
                      value={device}
                      onChange={(e) => {
                        const d = e.target.value as 'auto' | 'cuda' | 'cpu'
                        setDevice(d)
                        save({ localDevice: d })
                      }}
                    >
                      <option value="auto">Автоматически{info?.gpu ? ` (${info.gpu.name})` : ' (процессор)'}</option>
                      <option value="cuda">Видеокарте NVIDIA</option>
                      <option value="cpu">Процессоре</option>
                    </select>
                  </div>
                  <button className="text-link" onClick={onOpenWelcome}>
                    Скачать другую модель
                  </button>
                </>
              )}
              <div className="panel-note">Расшифровка на вашем компьютере — аудио никуда не уходит.</div>
            </>
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
          {/* Словарь работает и при расшифровке записей — открыт всегда (ревью волны 5). */}
          <div className="settings-row">
            <span>Словарь, замены, сниппеты, свои режимы</span>
            <button className="btn btn-sm" onClick={() => setVocabOpen(true)}>
              Открыть
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
              {dict.polish && (
                <>
                  <div className="settings-row">
                    <span>Режим</span>
                    <select className="rate" value={findMode(dict.mode, dict.customModes).id} onChange={(e) => saveDict({ mode: e.target.value })}>
                      {DICT_MODES.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                      {(dict.customModes ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {findMode(dict.mode, dict.customModes).hint && (
                    <div className="panel-note">
                      {findMode(dict.mode, dict.customModes).hint}
                      {findMode(dict.mode, dict.customModes).reformat &&
                        ' Переписывать текст лучше умеет облачный ИИ; локальная модель иногда ошибается — тогда вставится просто очищенный текст.'}
                    </div>
                  )}
                  <div className="settings-row">
                    <span>Режим по программе (Telegram → «Сообщение», почта → «Письмо»)</span>
                    <button className={'btn' + (dict.autoMode !== false ? ' btn-primary' : '')} onClick={() => saveDict({ autoMode: dict.autoMode === false })}>
                      {dict.autoMode !== false ? 'Вкл' : 'Выкл'}
                    </button>
                  </div>
                  <div className="settings-row">
                    <span>Числа и даты цифрами</span>
                    <button className={'btn' + (dict.digits !== false ? ' btn-primary' : '')} onClick={() => saveDict({ digits: dict.digits === false })}>
                      {dict.digits !== false ? 'Вкл' : 'Выкл'}
                    </button>
                  </div>
                  {findMode(dict.mode, dict.customModes).reformat && (
                    <div className="settings-row">
                      <span>Тон</span>
                      <select className="rate" value={dict.tone ?? 'neutral'} onChange={(e) => saveDict({ tone: e.target.value as DictTone })}>
                        {(Object.keys(TONE_NAMES) as DictTone[]).map((t) => (
                          <option key={t} value={t}>
                            {TONE_NAMES[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}
              <div className="settings-row">
                <span>Текст во время речи (в плашке; сейчас — с движком Deepgram)</span>
                <button className={'btn' + (dict.livePreview !== false ? ' btn-primary' : '')} onClick={() => saveDict({ livePreview: dict.livePreview === false })}>
                  {dict.livePreview !== false ? 'Вкл' : 'Выкл'}
                </button>
              </div>
              <div className="settings-row">
                <span>Пунктуация голосом: «запятая», «с новой строки»</span>
                <button className={'btn' + (dict.voicePunct !== false ? ' btn-primary' : '')} onClick={() => saveDict({ voicePunct: dict.voicePunct === false })}>
                  {dict.voicePunct !== false ? 'Вкл' : 'Выкл'}
                </button>
              </div>
              <div className="settings-row">
                <span>Исправлять слова, похожие на слова из словаря</span>
                <button className={'btn' + (dict.fuzzyVocab !== false ? ' btn-primary' : '')} onClick={() => saveDict({ fuzzyVocab: dict.fuzzyVocab === false })}>
                  {dict.fuzzyVocab !== false ? 'Вкл' : 'Выкл'}
                </button>
              </div>
              <div className="settings-row">
                <span>Shift + клавиша — правка выделенного текста голосом</span>
                <button className={'btn' + (dict.editByVoice !== false ? ' btn-primary' : '')} onClick={() => saveDict({ editByVoice: dict.editByVoice === false })}>
                  {dict.editByVoice !== false ? 'Вкл' : 'Выкл'}
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
              <div className="settings-row">
                <span>Микрофон</span>
                <MicSelect value={dict.micId ?? ''} onChange={(id) => saveDict({ micId: id })} />
              </div>
              <div className="settings-row">
                <span>Ставить музыку и видео на паузу</span>
                <button
                  className={'btn' + (dict.pauseMedia !== false ? ' btn-primary' : '')}
                  onClick={() => saveDict({ pauseMedia: dict.pauseMedia === false })}
                >
                  {dict.pauseMedia !== false ? 'Вкл' : 'Выкл'}
                </button>
              </div>
              <div className="settings-row">
                <span>Дописывать после отпускания клавиши</span>
                <select
                  className="rate"
                  value={dict.tailMs ?? 300}
                  onChange={(e) => saveDict({ tailMs: Number(e.target.value) })}
                >
                  {[0, 150, 300, 500, 800].map((ms) => (
                    <option key={ms} value={ms}>
                      {ms === 0 ? 'нет' : `${ms} мс`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <span>Хранить аудио диктовок для «Повторить»</span>
                <select
                  className="rate"
                  value={dict.keepAudioDays ?? 7}
                  onChange={(e) => saveDict({ keepAudioDays: Number(e.target.value) })}
                >
                  <option value={0}>не хранить</option>
                  <option value={1}>1 день</option>
                  <option value={7}>7 дней</option>
                  <option value={30}>30 дней</option>
                </select>
              </div>
              <div className="panel-note">
                Зажмите клавишу — говорите, отпустите — текст вставится туда, где курсор. Быстрое
                двойное нажатие — запись без рук до следующего нажатия. Esc — отмена. Выделите текст и
                зажмите Shift + клавишу — скажите, что с ним сделать («сделай мягче», «сократи»): текст
                заменится. Для правки нужен ИИ из раздела «ИИ». Распознаёт
                движок из раздела «Расшифровка»; чистку делает движок из раздела «ИИ». Если ИИ-чистка
                ошиблась или не ответила, вставится сырой текст — диктовка не теряется.
              </div>
              <DictationHistory />
            </>
          )}
          {vocabOpen && (
            <VocabPanel
              customModes={dict.customModes ?? []}
              appRules={dict.appRules}
              onSaveDict={(patch) => saveDict(patch)}
              onClose={() => setVocabOpen(false)}
            />
          )}
        </div>

        <div className="settings-section">
          <div className="settings-label">Паузы и звонки</div>
          <div className="settings-row">
            <span>Отмечать паузы в тексте</span>
            <select
              className="rate"
              value={pauseSec}
              onChange={(e) => {
                const v = Number(e.target.value)
                setPauseSec(v)
                save({ pauseMarkSec: v })
              }}
            >
              <option value={0}>не отмечать</option>
              {[2, 3, 5, 10].map((v) => (
                <option key={v} value={v}>
                  от {v} с
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <span>Паузы и в экспорте (Word, txt, md)</span>
            <button
              className={'btn' + (pauseExport ? ' btn-primary' : '')}
              onClick={() => {
                setPauseExport(!pauseExport)
                save({ pauseInExport: !pauseExport })
              }}
            >
              {pauseExport ? 'Вкл' : 'Выкл'}
            </button>
          </div>
          <div className="settings-row">
            <span>Предлагать запись, когда начинается звонок</span>
            <button
              className={'btn' + (callPrompt ? ' btn-primary' : '')}
              onClick={() => {
                setCallPrompt(!callPrompt)
                save({ callPrompt: !callPrompt })
              }}
            >
              {callPrompt ? 'Вкл' : 'Выкл'}
            </button>
          </div>
          {callMuted.length > 0 && (
            <div className="settings-row">
              <span className="settings-status">Не предлагать для: {callMuted.map((id) => CALL_APP_NAMES[id] ?? id).join(', ')}</span>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  for (const id of callMuted) await api.callUnmute(id)
                  setCallMuted([])
                }}
              >
                Вернуть
              </button>
            </div>
          )}
          <div className="settings-row">
            <span>Согласие клиента на запись</span>
            <button className="btn btn-sm" onClick={() => setConsentOpen(true)}>
              Открыть шаблон
            </button>
          </div>
          <div className="panel-note">
            «Слово» замечает, что Telegram, Zoom, WhatsApp, Teams или браузер включили микрофон, и предлагает
            записать разговор. Запись звонка — кнопкой на главном экране.
          </div>
          {consentOpen && <ConsentModal onClose={() => setConsentOpen(false)} />}
        </div>

        <McpSection />

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
