import { useEffect, useState } from 'react'
import { api } from '../api'
import { showToast, humanError } from '../toast'
import type { SetupInfo, SetupProgress, OllamaStatus, KeyVerdict, SttEngine, AiEngine } from '../../../shared/types'
import { STT_ENGINES } from '../../../shared/sttEngines'
import {
  LOCAL_MODELS,
  ENGINE_RELEASE,
  recommendModel,
  requiredBytes,
  formatBytes,
  localModel
} from '../../../shared/localModels'

// Первый запуск — «три двери» (образец — OpenWhispr: облако / свой ключ / на
// устройстве; карточки моделей «точность/скорость» — Handy). У нас:
//   1) посмотреть на примере — без настройки;
//   2) облако по своему ключу — с кнопкой «Проверить ключ»;
//   3) на этом компьютере — выбрать модель и скачать в фоне.

type Door = 'doors' | 'cloud' | 'local'

const KEY_PAGES: Record<string, string> = {
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  deepgram: 'https://console.deepgram.com/',
  assemblyai: 'https://www.assemblyai.com/dashboard',
  openai: 'https://platform.openai.com/api-keys',
  groq: 'https://console.groq.com/keys',
  claude: 'https://console.anthropic.com/settings/keys',
  openrouter: 'https://openrouter.ai/keys'
}

const OLLAMA_MODEL = 'qwen2.5:7b-instruct'

export function formatEta(remaining: number, bytesPerSec: number): string {
  if (bytesPerSec < 1) return ''
  const sec = remaining / bytesPerSec
  if (sec < 90) return 'меньше 2 минут'
  const min = Math.round(sec / 60)
  if (min < 90) return `≈ ${min} мин`
  return `≈ ${Math.floor(min / 60)} ч ${min % 60} мин`
}

function Meter({ value, label }: { value: number; label: string }): React.JSX.Element {
  return (
    <div className="meter" title={`${label}: ${value} из 5`}>
      <span className="meter-label">{label}</span>
      <span className="meter-bar">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={'meter-seg' + (i <= value ? ' on' : '')} />
        ))}
      </span>
    </div>
  )
}

function KeyField({
  service,
  value,
  onChange
}: {
  service: string
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  const [verdict, setVerdict] = useState<KeyVerdict | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => setVerdict(null), [service])
  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      setVerdict(await api.checkKey(service, value))
    } finally {
      setChecking(false)
    }
  }
  return (
    <div className="key-field">
      <div className="key-row">
        <input
          className="text-input key-input"
          type="password"
          placeholder="Вставьте ключ API"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setVerdict(null)
          }}
        />
        <button className="btn" disabled={!value.trim() || checking} onClick={check}>
          {checking ? 'Проверяю…' : 'Проверить'}
        </button>
      </div>
      <div className="key-meta">
        {verdict ? (
          <span className={verdict.ok ? 'key-ok' : 'key-bad'}>
            {verdict.ok ? '✓ ' : '✗ '}
            {verdict.message}
          </span>
        ) : (
          <button className="link-btn" onClick={() => api.openExternal(KEY_PAGES[service])}>
            Где взять ключ?
          </button>
        )}
      </div>
    </div>
  )
}

function CloudDoor({ onBack, onDone }: { onBack: () => void; onDone: () => void }): React.JSX.Element {
  const [stt, setStt] = useState<SttEngine>('elevenlabs')
  const [sttKeys, setSttKeys] = useState<Record<string, string>>({})
  const [ai, setAi] = useState<AiEngine>('claude')
  const [aiKey, setAiKey] = useState('')
  const [showOther, setShowOther] = useState(false)

  useEffect(() => {
    api.getSettings().then((s) => {
      setSttKeys(s.sttKeys ?? {})
      if (s.sttEngine && s.sttEngine !== 'local') setStt(s.sttEngine)
      if (s.aiEngine === 'openrouter') {
        setAi('openrouter')
        setAiKey(s.openrouterKey ?? '')
      } else setAiKey(s.anthropicKey ?? '')
    })
  }, [])

  const main = STT_ENGINES.filter((e) => e.tier)
  const other = STT_ENGINES.filter((e) => e.cloud && !e.tier)

  const finish = async (): Promise<void> => {
    const patch: Parameters<typeof api.setSettings>[0] = { onboarded: true }
    if ((sttKeys[stt] ?? '').trim()) {
      patch.sttEngine = stt
      patch.sttKeys = sttKeys
    }
    if (aiKey.trim()) {
      patch.aiEngine = ai
      if (ai === 'claude') patch.anthropicKey = aiKey.trim()
      else patch.openrouterKey = aiKey.trim()
    }
    await api.setSettings(patch)
    onDone()
  }

  return (
    <div className="welcome-door">
      <h2 className="welcome-h2">Облако по своему ключу</h2>
      <p className="welcome-lead">
        Быстро и точно на любом компьютере. Запись уходит в выбранный сервис. Ключи хранятся только на этом
        компьютере. Час записи стоит около 20–30 ₽ по тарифам сервисов.
      </p>

      <section className="welcome-section">
        <div className="welcome-step">1. Чем расшифровывать</div>
        <div className="choice-grid">
          {main.map((e) => (
            <button
              key={e.id}
              className={'choice' + (stt === e.id ? ' on' : '')}
              onClick={() => setStt(e.id)}
            >
              <span className="choice-title">{e.label}</span>
              <span className="choice-sub">
                {e.tier === 'max' ? 'Максимальная точность' : 'Цена и качество'} · {e.price}
              </span>
            </button>
          ))}
        </div>
        {showOther ? (
          <select className="text-input" value={stt} onChange={(e) => setStt(e.target.value as SttEngine)}>
            {[...main, ...other].map((e) => (
              <option key={e.id} value={e.id}>
                {e.label} · {e.price}
                {e.diarize ? '' : ' · без разделения говорящих'}
              </option>
            ))}
          </select>
        ) : (
          <button className="link-btn" onClick={() => setShowOther(true)}>
            Другие сервисы
          </button>
        )}
        <div className="welcome-step">2. Ключ API</div>
        <KeyField service={stt} value={sttKeys[stt] ?? ''} onChange={(v) => setSttKeys({ ...sttKeys, [stt]: v })} />
      </section>

      <section className="welcome-section">
        <div className="welcome-step">3. ИИ для результатов — конспекты, заметки, письма (можно позже)</div>
        <div className="choice-grid">
          <button className={'choice' + (ai === 'claude' ? ' on' : '')} onClick={() => setAi('claude')}>
            <span className="choice-title">Claude</span>
            <span className="choice-sub">Ключ Anthropic</span>
          </button>
          <button className={'choice' + (ai === 'openrouter' ? ' on' : '')} onClick={() => setAi('openrouter')}>
            <span className="choice-title">OpenRouter</span>
            <span className="choice-sub">Один ключ — много моделей</span>
          </button>
        </div>
        <KeyField service={ai === 'claude' ? 'claude' : 'openrouter'} value={aiKey} onChange={setAiKey} />
      </section>

      <div className="welcome-actions">
        <button className="btn" onClick={onBack}>
          ← Назад
        </button>
        <button className="btn btn-primary" onClick={finish}>
          Готово
        </button>
      </div>
    </div>
  )
}

export function SetupProgressBar({
  p,
  onStop,
  onResume
}: {
  p: SetupProgress
  onStop?: () => void
  onResume?: () => void
}): React.JSX.Element {
  const busy = p.stage === 'engine' || p.stage === 'extract' || p.stage === 'model'
  const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0
  const bytes = p.stage === 'engine' || p.stage === 'model'
  return (
    <div className={'setup-progress' + (p.stage === 'error' ? ' err' : '')}>
      <div className="setup-progress-head">
        <span>{p.label}</span>
        {busy && onStop && (
          <button className="btn btn-sm" onClick={onStop}>
            Пауза
          </button>
        )}
        {(p.stage === 'stopped' || p.stage === 'error') && onResume && (
          <button className="btn btn-sm btn-primary" onClick={onResume}>
            Продолжить
          </button>
        )}
      </div>
      {(busy || p.stage === 'stopped') && (
        <div className="setup-bar">
          <div className="setup-bar-fill" style={{ width: pct + '%' }} />
        </div>
      )}
      <div className="setup-progress-meta">
        {p.stage === 'error' && p.error}
        {bytes && p.total > 0 && `${formatBytes(p.done)} из ${formatBytes(p.total)} · ${pct}%`}
        {bytes && busy && p.bytesPerSec > 0 && ` · ${formatBytes(p.bytesPerSec)}/с · осталось ${formatEta(p.total - p.done, p.bytesPerSec)}`}
        {p.stage === 'extract' && `${pct}%`}
      </div>
    </div>
  )
}

function LocalDoor({ onBack, onDone }: { onBack: () => void; onDone: () => void }): React.JSX.Element {
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [pick, setPick] = useState<string>('')
  const [prog, setProg] = useState<SetupProgress | null>(null)
  const [ollama, setOllama] = useState<OllamaStatus | null>(null)
  const [pull, setPull] = useState<{ status: string; done: number; total: number } | null>(null)

  const refresh = async (): Promise<void> => {
    const i = await api.setupInfo()
    setInfo(i)
    setProg((cur) => cur ?? i.progress)
    setPick((cur) => cur || i.pending?.modelId || (i.installedModels.length ? i.localModel : recommendModel(i.gpu)))
  }
  useEffect(() => {
    void refresh()
    api.ollamaStatus().then(setOllama)
    const off1 = api.onSetupProgress((p) => {
      setProg(p)
      if (p.stage === 'done') void refresh()
    })
    const off2 = api.onOllamaProgress(setPull)
    return () => {
      off1()
      off2()
    }
  }, [])

  if (!info) return <div className="welcome-door">Проверяю компьютер…</div>

  const rec = recommendModel(info.gpu)
  const needEngine = !info.engine.installed
  const need = requiredBytes(pick, needEngine)
  const enough = info.freeBytes === null || info.freeBytes >= need
  const busy = !!prog && ['engine', 'extract', 'model'].includes(prog.stage)
  const pickInstalled = info.installedModels.includes(pick)

  const start = async (): Promise<void> => {
    await api.setSettings({ sttEngine: 'local' })
    await api.startSetup(pick)
  }
  const hasAiModel = !!ollama?.models.some((m) => m.startsWith('qwen2.5:7b'))
  const pullModel = async (): Promise<void> => {
    try {
      await api.setSettings({ aiEngine: 'local-llama' })
      await api.pullOllama(OLLAMA_MODEL)
      setOllama(await api.ollamaStatus())
    } catch (err) {
      showToast('Модель ИИ не скачалась: ' + humanError(err))
    } finally {
      setPull(null)
    }
  }

  return (
    <div className="welcome-door">
      <h2 className="welcome-h2">На этом компьютере</h2>
      <p className="welcome-lead">
        Полная приватность: запись не покидает компьютер. Один раз скачиваем движок и модель — дальше всё
        работает без интернета. Загрузка идёт в фоне: можно закрыть это окно и работать.
      </p>

      <div className="sys-line">
        <span>
          {info.gpu
            ? `Видеокарта: ${info.gpu.name}, ${Math.round(info.gpu.vramMb / 1024)} ГБ — расшифровка будет быстрой.`
            : 'Видеокарта NVIDIA не найдена — расшифровка пойдёт на процессоре, медленнее.'}
        </span>
        <span>
          Свободно на диске: {info.freeBytes === null ? '—' : formatBytes(info.freeBytes)}
          {info.engine.installed && ' · движок уже установлен ✓'}
        </span>
      </div>

      <div className="welcome-step">1. Выберите модель</div>
      <div className="model-grid">
        {LOCAL_MODELS.map((m) => (
          <button
            key={m.id}
            className={'model-card' + (pick === m.id ? ' on' : '')}
            onClick={() => !busy && setPick(m.id)}
            disabled={busy && pick !== m.id}
          >
            <div className="model-card-head">
              <span className="model-card-title">{m.label}</span>
              {info.installedModels.includes(m.id) ? (
                <span className="badge badge-ok">Скачано</span>
              ) : m.id === rec ? (
                <span className="badge">Советуем для этого ПК</span>
              ) : null}
            </div>
            <div className="model-card-note">{m.note}</div>
            <div className="model-card-foot">
              <Meter label="Точность" value={m.accuracy} />
              <Meter label="Скорость" value={info.gpu ? m.speedGpu : m.speedCpu} />
              <span className="model-size">{formatBytes(m.approxBytes)}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="welcome-step">2. Скачать</div>
      {prog && prog.modelId === pick && prog.stage !== 'done' ? (
        <SetupProgressBar p={prog} onStop={() => api.stopSetup()} onResume={start} />
      ) : pickInstalled && info.engine.installed ? (
        <div className="setup-ready">
          ✓ Всё готово: модель «{localModel(pick).label}» установлена.{' '}
          {info.localModel !== pick && (
            <button className="link-btn" onClick={() => api.setSettings({ localModel: pick, sttEngine: 'local' }).then(refresh)}>
              Сделать основной
            </button>
          )}
        </div>
      ) : (
        <div className="setup-plan">
          <div>
            {needEngine && `Движок расшифровки ≈ ${formatBytes(ENGINE_RELEASE.approxBytes)} + `}
            модель ≈ {formatBytes(localModel(pick).approxBytes)}. Нужно места: {formatBytes(need)}.
          </div>
          {!enough && <div className="key-bad">На диске не хватает места. Освободите место или выберите модель поменьше.</div>}
          <button className="btn btn-primary" disabled={!enough || busy} onClick={start}>
            Скачать и установить
          </button>
        </div>
      )}

      <section className="welcome-section">
        <div className="welcome-step">3. ИИ для результатов на этом компьютере (по желанию)</div>
        {!ollama ? (
          <div className="settings-status">Проверяю Ollama…</div>
        ) : !ollama.installed ? (
          <div className="settings-status">
            Нужна бесплатная программа Ollama (≈ 1 ГБ) и модель ИИ (≈ 4,7 ГБ). Без видеокарты ответы будут
            медленными — тогда удобнее облачный ключ.
            <div className="welcome-inline">
              <button className="btn" onClick={() => api.openExternal('https://ollama.com/download/windows')}>
                Открыть сайт Ollama
              </button>
              <button className="btn" onClick={() => api.ollamaStatus().then(setOllama)}>
                Я установил — проверить
              </button>
            </div>
          </div>
        ) : hasAiModel ? (
          <div className="setup-ready">✓ Ollama и модель ИИ на месте.</div>
        ) : pull ? (
          <SetupProgressBar
            p={{
              stage: 'model',
              modelId: 'ollama',
              label: 'Скачиваю модель ИИ',
              done: pull.done,
              total: pull.total,
              bytesPerSec: 0
            }}
            onStop={() => api.stopOllamaPull()}
          />
        ) : (
          <div className="welcome-inline">
            <span className="settings-status">Ollama есть. Осталось скачать модель ИИ ≈ 4,7 ГБ.</span>
            <button className="btn" onClick={pullModel}>
              Скачать модель ИИ
            </button>
          </div>
        )}
      </section>

      <div className="welcome-actions">
        <button className="btn" onClick={onBack}>
          ← Назад
        </button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await api.setSettings({ onboarded: true })
            onDone()
          }}
        >
          {busy ? 'Продолжить работу — загрузка идёт в фоне' : 'Готово'}
        </button>
      </div>
    </div>
  )
}

export default function Welcome({
  onDone,
  onOpenProject
}: {
  onDone: () => void
  onOpenProject: (slug: string) => void
}): React.JSX.Element {
  const [door, setDoor] = useState<Door>('doors')

  const openDemo = async (): Promise<void> => {
    try {
      const meta = await api.createDemo()
      await api.setSettings({ onboarded: true })
      onOpenProject(meta.slug)
    } catch (err) {
      showToast('Не удалось открыть пример: ' + humanError(err))
    }
  }
  const skip = async (): Promise<void> => {
    await api.setSettings({ onboarded: true })
    onDone()
  }

  return (
    <div className="onboard">
      {door === 'doors' && (
        <div className="welcome-doors">
          <h1 className="welcome-h1">С чего начнём?</h1>
          <p className="welcome-lead">
            «Слово» превращает запись разговора в текст и готовые результаты: конспект, заметку, письмо. Выберите,
            как работать. Потом это можно поменять в настройках.
          </p>
          <div className="door-grid">
            <div className="door">
              <div className="door-icon">👀</div>
              <div className="door-title">Посмотреть на примере</div>
              <div className="door-text">
                Откроем готовую расшифровку консультации и результаты по ней. Ничего не нужно настраивать.
              </div>
              <button className="btn btn-primary door-btn" onClick={openDemo}>
                Открыть пример
              </button>
            </div>
            <div className="door">
              <div className="door-icon">☁️</div>
              <div className="door-title">Облако по своему ключу</div>
              <div className="door-text">
                Быстро на любом компьютере. Запись уходит в выбранный сервис.
              </div>
              <ol className="door-steps">
                <li>Выбрать сервис</li>
                <li>Вставить ключ</li>
                <li>Проверить</li>
              </ol>
              <button className="btn btn-primary door-btn" onClick={() => setDoor('cloud')}>
                Настроить
              </button>
            </div>
            <div className="door">
              <div className="door-icon">💻</div>
              <div className="door-title">На этом компьютере</div>
              <div className="door-text">
                Полная приватность: запись не покидает компьютер. Лучше всего с видеокартой NVIDIA.
              </div>
              <ol className="door-steps">
                <li>Выбрать модель</li>
                <li>Скачать 2–5 ГБ в фоне</li>
                <li>Работать без интернета</li>
              </ol>
              <button className="btn btn-primary door-btn" onClick={() => setDoor('local')}>
                Выбрать модель
              </button>
            </div>
          </div>
          <button className="link-btn welcome-skip" onClick={skip}>
            Пропустить — настрою сам
          </button>
        </div>
      )}
      {door === 'cloud' && <CloudDoor onBack={() => setDoor('doors')} onDone={onDone} />}
      {door === 'local' && <LocalDoor onBack={() => setDoor('doors')} onDone={onDone} />}
    </div>
  )
}
