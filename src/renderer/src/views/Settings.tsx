import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { api } from '../api'
import type { Theme, AiEngine, AiTask, SttEngine, Settings as SettingsData, DictationSettings, SetupInfo, KeyVerdict } from '../../../shared/types'
import { defaultDictation } from '../../../shared/types'
import { STT_ENGINES, sttMeta, sttModeLabel } from '../../../shared/sttEngines'
import { LOCAL_MODELS, localModel, formatBytes } from '../../../shared/localModels'
import { AI_TASKS, AI_ENGINE_LABELS, resolveAiEngine } from '../../../shared/aiRouting'
import { currentClaudeModel } from '../../../shared/claudeModels'
import { DICT_MODES, TONE_NAMES, findMode, type DictTone } from '../../../shared/dictModes'
import {
  SETTINGS_SECTIONS,
  searchSettings,
  type SettingsSection
} from '../../../shared/settingsIndex'
import { DICT_KEYS } from '../dictKeys'
import { showToast, humanError } from '../toast'
import { MicSelect } from '../components/DictationHistory'
import ConsentModal from '../components/ConsentModal'
import McpSection from '../components/McpSection'
import { Row, SwitchRow, Block } from '../components/SettingsParts'
import { useTour, useSectionHints } from '../tour/TourProvider'

// Страница «Настройки»: слева шесть разделов, сверху поиск. Сохранение — сразу.
// Основа — прежнее окно SettingsModal (одна длинная прокрутка): те же поля и те же
// вызовы api.setSettings, только разложены по разделам, а «Вкл/Выкл» — переключатели.

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
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 · дёшево' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 · баланс' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 · максимум' }
]

const HOTKEYS: [string, string][] = [
  ['Клик по слову', 'перейти к месту в аудио; на подсвеченном неуверенном слове ещё и откроется окошко вариантов'],
  ['Правая кнопка по слову', 'варианты для любого слова'],
  ['Tab / Shift + Tab', 'следующее / предыдущее неуверенное слово'],
  ['1 … 5 в окошке вариантов', 'выбрать вариант (A — во всей записи, D — в словарь, Esc — закрыть)'],
  ['Пробел', 'играть / пауза'],
  ['← / →', '−5 / +5 секунд'],
  ['1 … 4', 'скорость 1× / 1.25× / 1.5× / 2×'],
  ['Ctrl + F', 'поиск и замена'],
  ['Ctrl + Z / Ctrl + Y', 'отменить / повторить'],
  ['Esc', 'закрыть поиск или окно']
]

// Облачные движки распознавания — первые; остальные и локальный — под «Дополнительно».
const STT_MAIN = STT_ENGINES.filter((m) => m.cloud && !m.advanced)
const STT_MORE = [...STT_ENGINES.filter((m) => m.cloud && m.advanced), ...STT_ENGINES.filter((m) => !m.cloud)]

// Подставляется сборкой (electron.vite.config.ts → define) из package.json.
declare const __APP_VERSION__: string
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''

/** Поле ключа: вставить, сохранить при уходе из поля, проверить. */
function KeyField({
  service,
  value,
  placeholder,
  onChange,
  onSave
}: {
  service: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  onSave: (v: string) => void
}): React.JSX.Element {
  const [verdict, setVerdict] = useState<KeyVerdict | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => setVerdict(null), [service])
  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      setVerdict(await api.checkKey(service, value.trim()))
    } finally {
      setChecking(false)
    }
  }
  return (
    <div className="st-key">
      <div className="key-row">
        <input
          className="text-input key-input"
          type="password"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setVerdict(null)
          }}
          onBlur={() => onSave(value.trim())}
        />
        <button className="btn" disabled={!value.trim() || checking} onClick={() => void check()}>
          {checking ? 'Проверяю…' : 'Проверить'}
        </button>
      </div>
      {verdict && (
        <div className="key-meta">
          <span className={verdict.ok ? 'key-ok' : 'key-bad'}>
            {verdict.ok ? '✓ ' : '✗ '}
            {verdict.message}
          </span>
        </div>
      )}
    </div>
  )
}

function Disclosure({
  open,
  onToggle,
  children,
  label = 'Дополнительно'
}: {
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  label?: string
}): React.JSX.Element {
  return (
    <div className="st-more">
      <button className="text-link st-more-btn" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        {label}
      </button>
      {open && <div className="st-more-body">{children}</div>}
    </div>
  )
}

export default function SettingsPage({
  theme,
  onToggleTheme,
  onOpenWelcome,
  onVocab,
  vocabOpen,
  onAdd,
  onOpenDictation,
  initialSection
}: {
  theme: Theme
  onToggleTheme: () => void
  onOpenWelcome: () => void
  onVocab: (tab: 'words' | 'modes') => void
  /** Окно «Словарь / Режимы» открыто: после закрытия перечитываем настройки диктовки. */
  vocabOpen: boolean
  onAdd: (kind: 'phone' | 'link' | 'watch') => void
  /** Открыть страницу «Диктовка» (там история). */
  onOpenDictation: () => void
  /** Открыть сразу на разделе (боковое меню: «Диктовка»). */
  initialSection?: SettingsSection
}): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>(initialSection ?? 'general')
  const tour = useTour()
  useSectionHints('settings')
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const [aiReady, setAiReady] = useState<boolean | null>(null)
  const [engine, setEngine] = useState<AiEngine>('claude')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('claude-sonnet-5-5')
  const [orKey, setOrKey] = useState('')
  const [orModel, setOrModel] = useState('anthropic/claude-sonnet-5')
  const [stt, setStt] = useState<SttEngine>('local')
  const [sttKeys, setSttKeys] = useState<Record<string, string>>({})
  const [dict, setDict] = useState<DictationSettings>({ ...defaultDictation })
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [localId, setLocalId] = useState('large-v3')
  const [device, setDevice] = useState<'auto' | 'cuda' | 'cpu'>('auto')
  const [backupBusy, setBackupBusy] = useState<string | null>(null)
  const [pauseSec, setPauseSec] = useState(3)
  const [pauseExport, setPauseExport] = useState(true)
  const [callPrompt, setCallPrompt] = useState(true)
  const [consentOpen, setConsentOpen] = useState(false)
  const [callMuted, setCallMuted] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [sttMore, setSttMore] = useState(false)
  const [aiMore, setAiMore] = useState(false)
  const [aiTasks, setAiTasks] = useState<Partial<Record<AiTask, AiEngine>>>({})
  const [tasksMore, setTasksMore] = useState(false)
  const [dictMore, setDictMore] = useState(false)

  const applySettings = useCallback((s: SettingsData, first: boolean): void => {
    setDict({ ...defaultDictation, ...s.dictation })
    if (!first) return
    setEngine(s.aiEngine ?? 'local-llama')
    setKey(s.anthropicKey ?? '')
    // Старые модели (4.x, 5) показываем как их замену 5.5 — так работает и main (claude.ts).
    setModel(currentClaudeModel(s.claudeModel))
    setOrKey(s.openrouterKey ?? '')
    setOrModel(s.openrouterModel ?? 'anthropic/claude-sonnet-5')
    setStt(s.sttEngine ?? 'local')
    setSttKeys(s.sttKeys ?? {})
    setLocalId(localModel(s.localModel).id)
    setDevice(s.localDevice ?? 'auto')
    setPauseSec(s.pauseMarkSec ?? 3)
    setPauseExport(s.pauseInExport !== false)
    setCallPrompt(s.callPrompt !== false)
    setCallMuted(s.callMuted ?? [])
    // Локальный движок прячется под «Дополнительно» — но если выбран, показываем сразу.
    setSttMore(!STT_MAIN.some((m) => m.id === (s.sttEngine ?? 'local')))
    setAiMore((s.aiEngine ?? 'local-llama') === 'local-llama')
    setAiTasks(s.aiTasks ?? {})
    // Свёрнуто, если ни одна задача не переопределена.
    setTasksMore(Object.keys(s.aiTasks ?? {}).length > 0)
    setLoaded(true)
  }, [])

  useEffect(() => {
    api.aiAvailable().then(setAiReady)
    api.getSettings().then((s) => applySettings(s, true))
    api.setupInfo().then(setInfo)
  }, [applySettings])

  // Окно «Словарь / Режимы» меняет свои части диктовки само — подтянуть после закрытия.
  const wasVocab = useRef(false)
  useEffect(() => {
    if (wasVocab.current && !vocabOpen) api.getSettings().then((s) => applySettings(s, false))
    wasVocab.current = vocabOpen
  }, [vocabOpen, applySettings])

  // Переход из поиска: открыть раздел, проскроллить к настройке, подсветить.
  useEffect(() => {
    if (!target || !loaded) return
    if (target === 'ai-tasks') setTasksMore(true)
    const t = window.setTimeout(() => {
      const el = document.getElementById('set-' + target)
      if (el) {
        el.scrollIntoView({ block: 'center' })
        el.classList.add('st-flash')
        window.setTimeout(() => el.classList.remove('st-flash'), 1600)
      }
      setTarget(null)
    }, 60)
    return () => window.clearTimeout(t)
  }, [target, section, loaded])

  const save = (patch: Partial<SettingsData>): void => {
    void api.setSettings(patch)
  }
  // Диктовку берём свежую из файла: окно «Режимы» могло изменить свои части.
  const saveDict = (patch: Partial<DictationSettings>): void => {
    setDict((d) => ({ ...d, ...patch }))
    void api.getSettings().then((s) => {
      const next = { ...defaultDictation, ...s.dictation, ...patch }
      return api.setSettings({ dictation: next })
    })
  }

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

  const sm = sttMeta(stt)
  const mode = findMode(dict.mode, dict.customModes)
  const results = searchSettings(query)

  // ---------- разделы ----------

  const general = (
    <>
      <Block title="Оформление">
        <SwitchRow
          id="theme"
          label="Тёмная тема"
          checked={theme === 'dark'}
          onChange={() => onToggleTheme()}
          onText="Тёмная"
          offText="Светлая"
        />
      </Block>
      <Block title="Начало работы">
        <Row id="wizard" label="Выбрать пример, облако или движок на этом компьютере">
          <button className="btn" onClick={onOpenWelcome}>
            Пройти заново
          </button>
        </Row>
      </Block>
      <div data-tour="tour-block">
        <Block id="tour" title="Обучение">
          <Row label="Короткий тур" hint="2–3 минуты по главному.">
            <button className="btn" onClick={() => tour.start('short')} data-testid="tour-start-short">
              Пройти коротко
            </button>
          </Row>
          <Row label="Подробный тур" hint="Все разделы и функции подряд.">
            <button className="btn" onClick={() => tour.start('full')} data-testid="tour-start-full">
              Пройти подробно
            </button>
          </Row>
          <Row label="Подсказки в разделах" hint="Две-три подсказки при первом заходе в каждый раздел.">
            <button className="btn" onClick={tour.resetHints} data-testid="tour-reset-hints">
              Снова показывать подсказки в разделах
            </button>
          </Row>
        </Block>
      </div>
      <Block id="hotkeys" title="Горячие клавиши в записи">
        {HOTKEYS.map(([k, v]) => (
          <div className="settings-row" key={k}>
            <span>{k}</span>
            <span className="settings-status">{v}</span>
          </div>
        ))}
      </Block>
      <Block id="about" title="О программе">
        <div className="settings-row">
          <span>Слово — редактор расшифровок для тех, чья работа — разговоры.</span>
          {APP_VERSION && <span className="settings-status">Версия {APP_VERSION}</span>}
        </div>
        <div className="settings-row">
          <span>
            Список русских слов для подбора вариантов: FrequencyWords (Hermit Dave), по субтитрам OpenSubtitles. Лицензия CC BY-SA 4.0.
          </span>
          <button className="link-btn" onClick={() => api.openExternal('https://github.com/hermitdave/FrequencyWords')}>
            Источник и лицензия
          </button>
        </div>
      </Block>
    </>
  )

  const dictation = (
    <>
      <Block title="Диктовка в любое окно">
        <SwitchRow id="dict-enabled" label="Диктовка включена" checked={dict.enabled} onChange={(v) => saveDict({ enabled: v })} />
        <Row id="dict-hotkey" label="Клавиша">
          <select className="rate" value={dict.hotkey} onChange={(e) => saveDict({ hotkey: e.target.value })}>
            {DICT_KEYS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Row>
        <Row id="dict-mic" label="Микрофон">
          <MicSelect value={dict.micId ?? ''} onChange={(id) => saveDict({ micId: id })} />
        </Row>
        <fieldset className="st-fieldset" disabled={!dict.enabled}>
          <SwitchRow
            id="dict-paste"
            label="Вставлять в активное окно"
            checked={!!dict.autoPaste}
            onChange={(v) => saveDict({ autoPaste: v })}
            offText="только в буфер"
          />
          <Row id="dict-tail" label="Дописывать после отпускания клавиши">
            <select className="rate" value={dict.tailMs ?? 300} onChange={(e) => saveDict({ tailMs: Number(e.target.value) })}>
              {[0, 150, 300, 500, 800].map((ms) => (
                <option key={ms} value={ms}>
                  {ms === 0 ? 'нет' : `${ms} мс`}
                </option>
              ))}
            </select>
          </Row>
          <SwitchRow
            id="dict-pausemedia"
            label="Ставить музыку и видео на паузу"
            checked={dict.pauseMedia !== false}
            onChange={(v) => saveDict({ pauseMedia: v })}
          />
          <SwitchRow id="dict-sounds" label="Звуковые сигналы" checked={!!dict.sounds} onChange={(v) => saveDict({ sounds: v })} />
          <Row id="dict-keepaudio" label="Хранить аудио диктовок для «Повторить»">
            <select className="rate" value={dict.keepAudioDays ?? 7} onChange={(e) => saveDict({ keepAudioDays: Number(e.target.value) })}>
              <option value={0}>не хранить</option>
              <option value={1}>1 день</option>
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
            </select>
          </Row>
          <SwitchRow
            id="dict-editbyvoice"
            label="Shift + клавиша — правка выделенного текста голосом"
            checked={dict.editByVoice !== false}
            onChange={(v) => saveDict({ editByVoice: v })}
          />
          <SwitchRow
            id="dict-live"
            label="Текст во время речи"
            hint="Показывается в плашке. Сейчас работает с движком Deepgram."
            checked={dict.livePreview !== false}
            onChange={(v) => saveDict({ livePreview: v })}
          />
          <SwitchRow
            id="dict-polish"
            label="ИИ-чистка текста"
            hint="Убирает слова-паразиты и расставляет знаки препинания."
            checked={!!dict.polish}
            onChange={(v) => saveDict({ polish: v })}
          />
        </fieldset>
        <Row id="dict-modes" label="Режимы — в разделе «Режимы», слова и замены — в «Словаре»">
          <div className="st-btns">
            <button className="btn btn-sm" onClick={() => onVocab('modes')}>
              Режимы
            </button>
            <button className="btn btn-sm" onClick={() => onVocab('words')}>
              Словарь
            </button>
          </div>
        </Row>
        <Disclosure open={dictMore} onToggle={() => setDictMore((v) => !v)}>
          <SwitchRow
            id="dict-punct"
            label="Пунктуация голосом: «запятая», «с новой строки»"
            checked={dict.voicePunct !== false}
            onChange={(v) => saveDict({ voicePunct: v })}
          />
          <SwitchRow
            id="dict-fuzzy"
            label="Исправлять слова, похожие на слова из словаря"
            checked={dict.fuzzyVocab !== false}
            onChange={(v) => saveDict({ fuzzyVocab: v })}
          />
          <fieldset className="st-fieldset" disabled={!dict.polish}>
            <SwitchRow
              id="dict-digits"
              label="Числа и даты цифрами"
              checked={dict.digits !== false}
              onChange={(v) => saveDict({ digits: v })}
            />
            <SwitchRow
              id="dict-dropcorr"
              label="Убирать оговорки"
              hint="«нет, в среду» → «в среду». Работает при включённой ИИ-чистке."
              checked={dict.dropCorrections === true}
              onChange={(v) => saveDict({ dropCorrections: v })}
            />
            <Row id="dict-mode" label="Режим по умолчанию">
              <select className="rate" value={mode.id} onChange={(e) => saveDict({ mode: e.target.value })}>
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
            </Row>
            {mode.hint && (
              <div className="panel-note">
                {mode.hint}
                {mode.reformat &&
                  ' Переписывать текст лучше умеет облачный ИИ; локальная модель иногда ошибается — тогда вставится просто очищенный текст.'}
              </div>
            )}
            {mode.reformat && (
              <Row id="dict-tone" label="Тон">
                <select className="rate" value={dict.tone ?? 'neutral'} onChange={(e) => saveDict({ tone: e.target.value as DictTone })}>
                  {(Object.keys(TONE_NAMES) as DictTone[]).map((t) => (
                    <option key={t} value={t}>
                      {TONE_NAMES[t]}
                    </option>
                  ))}
                </select>
              </Row>
            )}
            <SwitchRow
              id="dict-automode"
              label="Режим по программе"
              hint="Telegram → «Сообщение», почта → «Письмо». Правила — в «Режимах»."
              checked={dict.autoMode !== false}
              onChange={(v) => saveDict({ autoMode: v })}
            />
          </fieldset>
        </Disclosure>
        <div className="panel-note">
          Зажмите клавишу — говорите, отпустите — текст вставится туда, где курсор. Быстрое двойное нажатие — запись
          без рук до следующего нажатия. Esc — отмена. Выделите текст и зажмите Shift + клавишу — скажите, что с ним
          сделать («сделай мягче», «сократи»): текст заменится. Для правки нужен ИИ из раздела «Движки и ключи».
          Если ИИ-чистка ошиблась или не ответила, вставится сырой текст — диктовка не теряется.
        </div>
      </Block>
      <Block id="dict-history">
        <div className="settings-row">
          <span>История диктовок — на странице «Диктовка».</span>
          <button className="text-link" onClick={onOpenDictation} data-testid="open-dictation-page">
            Открыть
          </button>
        </div>
      </Block>
    </>
  )

  const records = (
    <>
      <Block title="Паузы в тексте">
        <Row id="pause-mark" label="Отмечать паузы в тексте">
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
        </Row>
        <SwitchRow
          id="pause-export"
          label="Паузы и в экспорте (Word, txt, md)"
          checked={pauseExport}
          onChange={(v) => {
            setPauseExport(v)
            save({ pauseInExport: v })
          }}
        />
      </Block>
      <Block title="Звонки">
        <SwitchRow
          id="call-prompt"
          label="Предлагать запись, когда начинается звонок"
          checked={callPrompt}
          onChange={(v) => {
            setCallPrompt(v)
            save({ callPrompt: v })
          }}
        />
        {callMuted.length > 0 && (
          <Row id="call-muted" label={<span className="settings-status">Не предлагать для: {callMuted.map((id) => CALL_APP_NAMES[id] ?? id).join(', ')}</span>}>
            <button
              className="btn btn-sm"
              onClick={async () => {
                for (const id of callMuted) await api.callUnmute(id)
                setCallMuted([])
              }}
            >
              Вернуть
            </button>
          </Row>
        )}
        <Row id="consent" label="Согласие клиента на запись">
          <button className="btn btn-sm" onClick={() => setConsentOpen(true)}>
            Открыть шаблон
          </button>
        </Row>
        <div className="panel-note">
          «Слово» замечает, что Telegram, Zoom, WhatsApp, Teams или браузер включили микрофон, и предлагает записать
          разговор. Запись звонка — кнопкой на главном экране.
        </div>
      </Block>
    </>
  )

  const sttBlock = (
    <>
      <Block id="stt-engine" title="Распознавание речи">
        <Row label="Движок">
          <select
            className="rate"
            value={stt}
            onChange={(e) => {
              const id = e.target.value as SttEngine
              setStt(id)
              save({ sttEngine: id })
            }}
          >
            {STT_MAIN.map((m) => (
              <option key={m.id} value={m.id}>
                {sttModeLabel(m)}
                {m.diarize ? '' : ' · один голос'}
              </option>
            ))}
            {(sttMore || !STT_MAIN.some((m) => m.id === stt)) &&
              STT_MORE.map((m) => (
                <option key={m.id} value={m.id}>
                  {sttModeLabel(m)}
                  {m.cloud && !m.diarize ? ' · один голос' : ''}
                </option>
              ))}
          </select>
        </Row>
        {sm?.cloud && (
          <div id="set-stt-key">
            <div className="input-label">Ключ {sm.label} (вставьте свой; хранится на этом компьютере)</div>
            <KeyField
              service={stt}
              value={sttKeys[stt] ?? ''}
              placeholder={sm.keyHint ? 'ключ · ' + sm.keyHint : 'вставьте ключ'}
              onChange={(v) => setSttKeys({ ...sttKeys, [stt]: v })}
              onSave={(v) => save({ sttKeys: { ...sttKeys, [stt]: v } })}
            />
            <div className="panel-note">
              {sm.price} · {sm.diarize ? 'разделяет говорящих (Психолог/Клиент).' : 'без разделения — один голос.'} Аудио уходит на
              серверы {sm.label} (облако). Для клиентских сессий выбирайте осознанно{sm.keyHint ? `; ключ — на ${sm.keyHint}` : ''}.
            </div>
          </div>
        )}
        <Disclosure open={sttMore} onToggle={() => setSttMore((v) => !v)}>
          <div className="panel-note">Другие облачные движки и расшифровка на этом компьютере (аудио никуда не уходит).</div>
          {!sm?.cloud && (
            <div id="set-stt-local" className="st-sub">
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
            </div>
          )}
        </Disclosure>
      </Block>
    </>
  )

  const aiBlock = (
    <Block id="ai-engine" title="Искусственный интеллект">
      <Row label="Движок">
        <div className="st-btns">
          {(
            [
              ['claude', 'Claude (облако)'],
              ['openrouter', 'OpenRouter (облако)'],
              ...(aiMore || engine === 'local-llama' ? [['local-llama', 'Локально']] : [])
            ] as [AiEngine, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={'btn' + (engine === id ? ' btn-primary' : '')}
              aria-pressed={engine === id}
              onClick={() => {
                setEngine(id)
                save({ aiEngine: id })
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </Row>

      {engine === 'claude' && (
        <>
          <div id="set-ai-key">
            <div className="input-label">Ключ Anthropic API (вставьте свой; хранится на этом компьютере)</div>
            <KeyField service="claude" value={key} placeholder="sk-ant-…" onChange={setKey} onSave={(v) => save({ anthropicKey: v })} />
          </div>
          <div className="settings-row" id="set-ai-model">
            <span>Модель</span>
            <div className="st-btns">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  className={'btn' + (model === m.id ? ' btn-primary' : '')}
                  aria-pressed={model === m.id}
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
            Ключ берётся на console.anthropic.com (оплата по факту, это не подписка). Обезличивание всегда работает
            локально — для клиентских сессий сначала обезличьте, потом отправляйте в Claude.
          </div>
        </>
      )}
      {engine === 'openrouter' && (
        <>
          <div id="set-ai-key">
            <div className="input-label">Ключ OpenRouter (вставьте свой; хранится на этом компьютере)</div>
            <KeyField service="openrouter" value={orKey} placeholder="sk-or-…" onChange={setOrKey} onSave={(v) => save({ openrouterKey: v })} />
          </div>
          <div id="set-ai-model">
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
          </div>
          <div className="panel-note">
            Один ключ — сотни моделей (openrouter.ai, оплата по факту). Для саммари и супервизора берите умную модель.
            Обезличивание всегда работает локально.
          </div>
        </>
      )}
      {engine === 'local-llama' && (
        <>
          <div className="settings-row" id="set-ai-model">
            <span>Локальная модель</span>
            <span className="settings-status">{aiReady === null ? '…' : aiReady ? 'qwen2.5:7b · готова' : 'не найдена'}</span>
          </div>
          <div className="panel-note">Обработка на вашем компьютере — ничего не уходит наружу.</div>
        </>
      )}
      <div id="set-ai-tasks" className="st-sub">
        <Disclosure open={tasksMore} onToggle={() => setTasksMore((v) => !v)} label="Свой ИИ для отдельных задач">
          <div className="panel-note">
            Например, диктовку чистить на компьютере, а конспекты делать в облаке. Облако быстрее и точнее. На компьютере
            бесплатно, и текст не уходит в интернет. Для варианта «Локально» нужен скачанный локальный ИИ.
          </div>
          {AI_TASKS.map((t) => {
            const own = aiTasks[t.id]
            const eff = resolveAiEngine({ aiEngine: engine, aiTasks }, t.id)
            // Ключ общего движка видно выше; предупреждаем только о ключе, нужном для своего выбора.
            const noKey = !!own && ((eff === 'claude' && !key.trim()) || (eff === 'openrouter' && !orKey.trim()))
            return (
              <div key={t.id} className="st-sub">
                <div className="settings-row">
                  <span title={t.hint}>{t.label}</span>
                  <select
                    className="rate"
                    aria-label={t.label}
                    value={own ?? ''}
                    onChange={(e) => {
                      const v = e.target.value as AiEngine | ''
                      const next = { ...aiTasks }
                      if (v) next[t.id] = v
                      else delete next[t.id]
                      setAiTasks(next)
                      save({ aiTasks: next })
                    }}
                  >
                    <option value="">Как везде — {AI_ENGINE_LABELS[engine]}</option>
                    <option value="claude">{AI_ENGINE_LABELS.claude}</option>
                    <option value="openrouter">{AI_ENGINE_LABELS.openrouter}</option>
                    <option value="local-llama">{AI_ENGINE_LABELS['local-llama']}</option>
                  </select>
                </div>
                {own === 'local-llama' && aiReady === false && (
                  <div className="settings-row">
                    <span className="key-bad">Локальный ИИ ещё не скачан.</span>
                    <button className="btn" onClick={onOpenWelcome}>
                      Скачать
                    </button>
                  </div>
                )}
                {noKey && (
                  <div>
                    <div className="input-label key-bad">
                      Нет ключа {eff === 'claude' ? 'Anthropic' : 'OpenRouter'}. Вставьте его здесь; он общий для всех задач.
                    </div>
                    {eff === 'claude' ? (
                      <KeyField service="claude" value={key} placeholder="sk-ant-…" onChange={setKey} onSave={(v) => save({ anthropicKey: v })} />
                    ) : (
                      <KeyField service="openrouter" value={orKey} placeholder="sk-or-…" onChange={setOrKey} onSave={(v) => save({ openrouterKey: v })} />
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <div className="panel-note">Обезличивание записи всегда идёт на компьютере. Модель Claude общая для всех задач.</div>
        </Disclosure>
      </div>
      {!aiMore && engine !== 'local-llama' && (
        <button className="text-link st-more-btn" onClick={() => setAiMore(true)}>
          <ChevronRight size={14} aria-hidden="true" /> Дополнительно: ИИ на этом компьютере
        </button>
      )}
    </Block>
  )

  const engines = (
    <>
      {sttBlock}
      {aiBlock}
    </>
  )

  const connections = (
    <>
      <Block id="mcp" bare>
        <McpSection />
      </Block>
      <Block title="Источники записей">
        <Row id="phone" label="Запись с телефона по Wi-Fi (QR-код)">
          <button className="btn btn-sm" onClick={() => onAdd('phone')}>
            Открыть
          </button>
        </Row>
        <Row id="watch" label="Папка-наблюдатель: новые записи из папки берутся сами">
          <button className="btn btn-sm" onClick={() => onAdd('watch')}>
            Настроить
          </button>
        </Row>
        <Row id="link" label="Ссылка на видео YouTube или VK">
          <button className="btn btn-sm" onClick={() => onAdd('link')}>
            Вставить
          </button>
        </Row>
      </Block>
    </>
  )

  const privacy = (
    <Block title="Данные и резервная копия">
      <Row id="datadir" label={<span className="settings-status st-break">{info?.dataDir ?? '…'}</span>}>
        <button className="btn" onClick={() => void api.openDataDir()}>
          Открыть папку
        </button>
      </Row>
      <Row id="backup" label="Все записи, конспекты и настройки — одним файлом .zip">
        <button className="btn" disabled={!!backupBusy} onClick={() => void doBackup()}>
          {backupBusy === 'Создаю копию…' ? backupBusy : 'Сделать копию'}
        </button>
      </Row>
      <Row id="restore" label="Вернуть данные из такого файла">
        <button className="btn" disabled={!!backupBusy} onClick={() => void doRestore()}>
          {backupBusy === 'Восстанавливаю…' ? backupBusy : 'Восстановить'}
        </button>
      </Row>
      <div className="panel-note">
        В копии лежат ваши записи и ключи сервисов — храните её так же бережно, как записи клиентов. Модели и движок в
        копию не входят: их можно скачать заново.
      </div>
    </Block>
  )

  const body: Record<SettingsSection, React.JSX.Element> = { general, dictation, records, engines, connections, privacy }

  const goTo = (id: string, sec: SettingsSection): void => {
    setQuery('')
    setSection(sec)
    // Настройка может лежать в свёрнутом «Дополнительно» — раскрываем, иначе
    // переход «молча не сработает» (ревью шага 3).
    setDictMore(true)
    setSttMore(true)
    setTarget(id)
  }

  return (
    <main className="st-page" data-testid="settings-page">
      <header className="st-head">
        <h1 className="st-title">Настройки</h1>
        <div className="st-search" data-tour="settings-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="text-input"
            type="search"
            placeholder="Найти настройку"
            aria-label="Найти настройку"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
          />
          {query && (
            <button className="st-clear" aria-label="Очистить поиск" onClick={() => setQuery('')}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      <Tabs.Root className="st-body" orientation="vertical" value={section} onValueChange={(v) => setSection(v as SettingsSection)}>
        <Tabs.List className="st-menu" aria-label="Разделы настроек" data-tour="settings-tabs">
          {SETTINGS_SECTIONS.map((s) => (
            <Tabs.Trigger key={s.id} value={s.id} className="st-tab" data-testid={'st-tab-' + s.id} onClick={() => setQuery('')}>
              {s.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <div className="st-content" ref={contentRef} id={'settings-' + section} data-tour="settings-content">
          {query.trim() ? (
            <div className="st-results">
              {results.length === 0 ? (
                <div className="panel-note">Ничего не нашлось. Попробуйте другое слово.</div>
              ) : (
                results.map((e) => (
                  <button key={e.id} className="st-result" onClick={() => goTo(e.id, e.section)}>
                    <span>{e.label}</span>
                    <span className="settings-status">{SETTINGS_SECTIONS.find((s) => s.id === e.section)?.label}</span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <Tabs.Content value={section} className="st-sections" forceMount>
              {body[section]}
            </Tabs.Content>
          )}
        </div>
      </Tabs.Root>
      {consentOpen && <ConsentModal onClose={() => setConsentOpen(false)} />}
    </main>
  )
}
