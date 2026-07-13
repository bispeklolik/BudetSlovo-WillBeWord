import { useEffect, useRef, useState } from 'react'
import { mdToHtml } from './md'
import type { MergeResult } from '../../src/shared/turns'
import { deepgramToTurns, elevenToTurns, openaiToTurns } from '../../src/shared/sttMappers'
import {
  BUILTIN_PROMPTS,
  CATEGORY_LABELS,
  type CustomPrompt,
  type PromptCategory
} from '../../src/shared/prompts'

// Веб-версия «Слова»: всё в браузере, без сервера. Аудио уходит только в
// выбранный STT-сервис по ключу пользователя; ключи живут в localStorage.

type SttId = 'deepgram' | 'elevenlabs' | 'openai' | 'groq'
type Phase = 'idle' | 'busy' | 'done'

const RELEASES = 'https://github.com/bispeklolik/BudetSlovo-WillBeWord/releases/latest'
const REPO = 'https://github.com/bispeklolik/BudetSlovo-WillBeWord'

const STT_OPTIONS: {
  id: SttId
  label: string
  note: string
  hint: string
  advanced?: boolean
  maxMb: number
}[] = [
  {
    id: 'elevenlabs',
    label: 'Максимальная точность',
    note: 'ElevenLabs Scribe · примерно $0.004 за минуту · разделяет голоса',
    hint: 'ключ с elevenlabs.io',
    maxMb: 200
  },
  {
    id: 'deepgram',
    label: 'Цена и качество',
    note: 'Deepgram · примерно $0.004 за минуту · разделяет голоса',
    hint: 'ключ с console.deepgram.com',
    maxMb: 200
  },
  {
    id: 'groq',
    label: 'Groq',
    note: 'Whisper · примерно $0.0007 за минуту · один голос, файл до 25 МБ',
    hint: 'ключ с console.groq.com',
    advanced: true,
    maxMb: 25
  },
  {
    id: 'openai',
    label: 'OpenAI',
    note: 'Whisper · примерно $0.006 за минуту · один голос, файл до 25 МБ',
    hint: 'ключ с platform.openai.com',
    advanced: true,
    maxMb: 25
  }
]

const CLAUDE_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet · баланс' },
  { id: 'claude-opus-4-8', label: 'Opus · максимум' },
  { id: 'claude-haiku-4-5', label: 'Haiku · дёшево' }
]

const OPENROUTER_MODELS = [
  'anthropic/claude-sonnet-5',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'deepseek/deepseek-v4-pro',
  'anthropic/claude-haiku-4.5'
]

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

async function sttTranscribe(file: File, engine: SttId, key: string): Promise<MergeResult> {
  if (engine === 'deepgram') {
    const params = new URLSearchParams({
      model: 'nova-2',
      language: 'ru',
      diarize: 'true',
      punctuate: 'true',
      smart_format: 'true'
    })
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': file.type || 'audio/mp4' },
      body: file
    })
    if (res.status === 401) throw new Error('Неверный ключ Deepgram.')
    if (!res.ok) throw new Error(`Deepgram: ошибка ${res.status}`)
    return deepgramToTurns(await res.json())
  }
  if (engine === 'elevenlabs') {
    const form = new FormData()
    form.append('file', file, file.name)
    form.append('model_id', 'scribe_v2')
    form.append('diarize', 'true')
    form.append('language_code', 'rus')
    form.append('timestamps_granularity', 'word')
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form
    })
    if (res.status === 401) throw new Error('Неверный ключ ElevenLabs.')
    if (!res.ok) throw new Error(`ElevenLabs: ошибка ${res.status}`)
    return elevenToTurns(await res.json())
  }
  // OpenAI и Groq: один контракт, разный адрес и модель.
  const base =
    engine === 'openai' ? 'https://api.openai.com/v1' : 'https://api.groq.com/openai/v1'
  const model = engine === 'openai' ? 'whisper-1' : 'whisper-large-v3-turbo'
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('model', model)
  form.append('language', 'ru')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('timestamp_granularities[]', 'segment')
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form
  })
  if (res.status === 401)
    throw new Error(engine === 'openai' ? 'Неверный ключ OpenAI.' : 'Неверный ключ Groq.')
  if (!res.ok) throw new Error(`${engine === 'openai' ? 'OpenAI' : 'Groq'}: ошибка ${res.status}`)
  return openaiToTurns(await res.json())
}

async function askClaude(system: string, text: string, key: string, model: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: text }]
    }),
    signal: AbortSignal.timeout(300_000)
  })
  if (res.status === 401) throw new Error('Неверный ключ Claude.')
  if (!res.ok) throw new Error(`Claude: ошибка ${res.status}`)
  const d = (await res.json()) as {
    content?: { type: string; text?: string }[]
    stop_reason?: string
  }
  let out = (d.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim()
  if (d.stop_reason === 'max_tokens') out += '\n\n…[ответ обрезан по лимиту]'
  return out
}

async function askOpenRouter(
  system: string,
  text: string,
  key: string,
  model: string
): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text }
      ]
    }),
    signal: AbortSignal.timeout(300_000)
  })
  if (res.status === 401) throw new Error('Неверный ключ OpenRouter.')
  if (res.status === 404) throw new Error('OpenRouter: такая модель не найдена, проверьте id.')
  if (!res.ok) throw new Error(`OpenRouter: ошибка ${res.status}`)
  const d = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
  }
  const c = d.choices?.[0]
  let out = (c?.message?.content ?? '').trim()
  if (c?.finish_reason === 'length') out += '\n\n…[ответ обрезан по лимиту]'
  return out
}

// ---- шаринг результата ссылкой: JSON → deflate → base64url в #s=... ----
async function packShare(title: string, body: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ t: title, b: body }))
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const packed = new Uint8Array(await new Response(stream).arrayBuffer())
  let bin = ''
  packed.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function unpackShare(s: string): Promise<{ t: string; b: string } | null> {
  try {
    const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return JSON.parse(await new Response(stream).text())
  } catch {
    return null
  }
}

function fmtTime(sec: number): string {
  const t = Math.floor(sec)
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Длительность записи из метаданных браузера — для оценки цены до отправки.
function getDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio()
    const url = URL.createObjectURL(file)
    const done = (v: number | null): void => {
      URL.revokeObjectURL(url)
      resolve(v)
    }
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : null)
    a.onerror = () => done(null)
    setTimeout(() => done(null), 4000)
    a.src = url
  })
}

const PRICE_PER_MIN: Record<SttId, number> = {
  elevenlabs: 0.004,
  deepgram: 0.004,
  openai: 0.006,
  groq: 0.0007
}

// Готовый пример: даёт пощупать транскрипт и промты без ключей и загрузки.
const DEMO: MergeResult = {
  speakers: [
    { id: 'S0', engineLabel: 'demo', name: 'Психолог', colorKey: 'spk1' },
    { id: 'S1', engineLabel: 'demo', name: 'Клиент', colorKey: 'spk2' }
  ],
  turns: [
    { id: 'T0', spk: 'S0', startSec: 0, words: 'Здравствуйте, с чем сегодня пришли?'.split(' ').map((t, i) => ({ id: i, t })) },
    { id: 'T1', spk: 'S1', startSec: 4, words: 'Опять не могу спать, всё думаю про работу и что всех подвожу.'.split(' ').map((t, i) => ({ id: 10 + i, t })) },
    { id: 'T2', spk: 'S0', startSec: 11, words: 'Что именно крутится в голове перед сном?'.split(' ').map((t, i) => ({ id: 30 + i, t })) },
    { id: 'T3', spk: 'S1', startSec: 16, words: 'Что уволят. Что я хуже всех в отделе, хотя вчера меня похвалили.'.split(' ').map((t, i) => ({ id: 40 + i, t })) },
    { id: 'T4', spk: 'S0', startSec: 24, words: 'Давайте посмотрим на факты за и против этой мысли.'.split(' ').map((t, i) => ({ id: 60 + i, t })) }
  ]
}

function download(name: string, body: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

const store = {
  get: (k: string): string => localStorage.getItem('slovo.' + k) ?? '',
  set: (k: string, v: string): void => localStorage.setItem('slovo.' + k, v)
}

function loadCustom(): CustomPrompt[] {
  try {
    const arr = JSON.parse(store.get('customPrompts') || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export default function App(): React.JSX.Element {
  const [engine, setEngine] = useState<SttId>((store.get('stt') as SttId) || 'deepgram')
  const [showAllStt, setShowAllStt] = useState(false)
  const [sttKey, setSttKey] = useState('')
  const [claudeKey, setClaudeKey] = useState(store.get('claudeKey'))
  const [model, setModel] = useState(store.get('model') || 'claude-sonnet-4-6')
  const [aiEngine, setAiEngine] = useState<'claude' | 'openrouter'>(
    (store.get('aiEngine') as 'claude' | 'openrouter') || 'claude'
  )
  const [orKey, setOrKey] = useState(store.get('orKey'))
  const [orModel, setOrModel] = useState(store.get('orModel') || 'anthropic/claude-sonnet-5')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<MergeResult | null>(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [aiTitle, setAiTitle] = useState('')
  const [aiText, setAiText] = useState('')
  const [ownPrompt, setOwnPrompt] = useState('')
  const [ownName, setOwnName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [custom, setCustom] = useState<CustomPrompt[]>(loadCustom)
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [shared, setShared] = useState<{ t: string; b: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => setSttKey(store.get('key.' + engine)), [engine])

  // Расшифровка стоит денег — не даём потерять её случайно: страховка от
  // закрытия вкладки + восстановление последнего результата после перезапуска.
  const [restorable, setRestorable] = useState<string>('')
  const [estimate, setEstimate] = useState('')
  const [busyStart, setBusyStart] = useState(0)
  const [busySec, setBusySec] = useState(0)
  useEffect(() => {
    if (phase !== 'busy') return
    const t = setInterval(() => setBusySec(Math.floor((Date.now() - busyStart) / 1000)), 1000)
    return () => clearInterval(t)
  }, [phase, busyStart])
  useEffect(() => {
    try {
      const saved = localStorage.getItem('slovo.lastResult')
      if (saved) setRestorable((JSON.parse(saved) as { fileName: string }).fileName ?? '')
    } catch {
      /* битое сохранение — игнорируем */
    }
  }, [])
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent): void => {
      if (phase === 'busy') e.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [phase])

  const restoreLast = (): void => {
    try {
      const saved = JSON.parse(localStorage.getItem('slovo.lastResult') ?? '')
      setFileName(saved.fileName)
      setResult(saved.result)
      setPhase('done')
    } catch {
      setRestorable('')
    }
  }

  // Открыта ссылка-шаринг (#s=...) — показываем присланный результат.
  // hashchange нужен, потому что переход по хэшу не перезагружает SPA.
  useEffect(() => {
    const check = (): void => {
      const h = window.location.hash
      if (h.startsWith('#s=')) void unpackShare(h.slice(3)).then((d) => d && setShared(d))
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])

  const pick = (): void => fileRef.current?.click()

  const handleFile = async (file: File): Promise<void> => {
    setError('')
    const opt = STT_OPTIONS.find((o) => o.id === engine)!
    if (!sttKey.trim()) {
      setError('Сначала вставьте ключ выбранного сервиса распознавания.')
      return
    }
    if (file.size > opt.maxMb * 1024 * 1024) {
      setError(
        `Файл больше ${opt.maxMb} МБ` +
          (opt.maxMb === 25
            ? ': это лимит OpenAI и Groq. Выберите другой режим распознавания.'
            : '. Для таких записей лучше приложение для Windows.')
      )
      return
    }
    setFileName(file.name)
    setPhase('busy')
    // Оценка до отправки: длительность → примерная цена по тарифу движка.
    void getDuration(file).then((sec) => {
      if (sec) {
        const min = sec / 60
        setEstimate(`≈ ${Math.round(min)} мин аудио · ~$${(min * PRICE_PER_MIN[engine]).toFixed(2)}`)
      }
    })
    setBusyStart(Date.now())
    try {
      const r = await sttTranscribe(file, engine, sttKey.trim())
      if (r.turns.length === 0) throw new Error('Сервис вернул пустую расшифровку.')
      setResult(r)
      try {
        localStorage.setItem('slovo.lastResult', JSON.stringify({ fileName: file.name, result: r }))
      } catch {
        /* очень длинная запись не влезла в localStorage — просто без страховки */
      }
      setAudioUrl((old) => {
        if (old) URL.revokeObjectURL(old)
        return URL.createObjectURL(file)
      })
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('idle')
    }
  }

  const transcriptText = (): string => {
    if (!result) return ''
    const name = (spk: string): string =>
      result.speakers.find((s) => s.id === spk)?.name ?? spk
    return result.turns
      .map((t) => name(t.spk) + ': ' + t.words.map((w) => w.t).join(' '))
      .join('\n')
  }

  const runPrompt = async (system: string, title: string, id: string): Promise<void> => {
    setError('')
    const useOr = aiEngine === 'openrouter'
    if (useOr ? !orKey.trim() : !claudeKey.trim()) {
      setError(
        useOr
          ? 'Для «Сделать из текста» нужен ключ OpenRouter (openrouter.ai/keys).'
          : 'Для «Сделать из текста» нужен ключ Claude (console.anthropic.com).'
      )
      return
    }
    setAiBusy(id)
    setAiTitle(title)
    setAiText('')
    setCopied(false)
    setLinkCopied(false)
    try {
      const out = useOr
        ? await askOpenRouter(system, transcriptText(), orKey.trim(), orModel.trim())
        : await askClaude(system, transcriptText(), claudeKey.trim(), model)
      setAiText(out)
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(null)
    }
  }

  const saveCard = (): void => {
    const name = ownName.trim()
    const system = ownPrompt.trim()
    if (!name || !system) return
    const next = editingId
      ? custom.map((c) => (c.id === editingId ? { ...c, name, system } : c))
      : [...custom, { id: 'c' + Date.now().toString(36), name, system }]
    setCustom(next)
    store.set('customPrompts', JSON.stringify(next))
    setOwnName('')
    setEditingId(null)
  }

  const editCard = (c: CustomPrompt): void => {
    setOwnPrompt(c.system)
    setOwnName(c.name)
    setEditingId(c.id)
  }

  const delCard = (id: string): void => {
    const next = custom.filter((c) => c.id !== id)
    setCustom(next)
    store.set('customPrompts', JSON.stringify(next))
    if (editingId === id) setEditingId(null)
  }

  const shareResult = async (): Promise<void> => {
    const hash = await packShare(aiTitle, aiText)
    const url = window.location.origin + window.location.pathname + '#s=' + hash
    if (url.length > 8000) {
      setError('Результат слишком длинный для ссылки. Скачайте файлом.')
      return
    }
    await navigator.clipboard.writeText(url)
    setLinkCopied(true)
  }

  const spkColor = (spk: string): string => {
    const s = result?.speakers.find((s) => s.id === spk)
    return `var(--${s?.colorKey ?? 'spk1'})`
  }
  const spkName = (spk: string): string =>
    result?.speakers.find((s) => s.id === spk)?.name ?? spk

  const OWN_BASE =
    'Тебе дают расшифровку разговора. Опирайся только на текст, ничего не выдумывай. Пиши по-русски. '

  // ---- режим просмотра присланной ссылки ----
  if (shared) {
    return (
      <div className="page">
        <header className="top">
          <span className="brand">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 10v4" /><path d="M8 6v12" /><path d="M12 3v18" /><path d="M16 6v12" /><path d="M20 10v4" />
            </svg>
            Слово
            <span className="brand-web">веб</span>
          </span>
        </header>
        <section className="shared">
          <span className="label">Вам поделились результатом</span>
          <h1>{shared.t}</h1>
          <div className="ai-body shared-body md" dangerouslySetInnerHTML={{ __html: mdToHtml(shared.b) }} />
          <div className="hero-ctas">
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(shared.b)
                setCopied(true)
              }}
            >
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
            <button className="btn" onClick={() => download(shared.t + '.md', shared.b)}>
              Скачать
            </button>
            <button
              className="btn primary"
              onClick={() => {
                history.replaceState(null, '', window.location.pathname)
                setShared(null)
              }}
            >
              Сделать свою расшифровку
            </button>
          </div>
        </section>
        <footer className="foot">
          <p>
            «Слово» превращает записи разговоров в текст и результат прямо в браузере. Ключи и
            записи не покидают ваш компьютер, кроме выбранного вами сервиса распознавания.
          </p>
          <a href={REPO}>Открытый код на GitHub</a>
        </footer>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="top">
        <span className="brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 10v4" /><path d="M8 6v12" /><path d="M12 3v18" /><path d="M16 6v12" /><path d="M20 10v4" />
          </svg>
          Слово
          <span className="brand-web">веб</span>
        </span>
        <a className="top-link" href={RELEASES}>
          Приложение для Windows
        </a>
      </header>

      {phase !== 'done' && (
        <section className="hero">
          <div className="hero-copy">
            <h1>Запись разговора становится текстом и смыслом</h1>
            <p>
              Расшифровка с разделением голосов, а затем саммари, протокол или заметка по готовым
              промтам. Без установки и без сервера.
            </p>
            <div className="hero-ctas">
              <button className="btn primary" onClick={pick} disabled={phase === 'busy'}>
                Выбрать запись
              </button>
              {restorable && phase === 'idle' && (
                <button className="btn" onClick={restoreLast}>
                  Вернуться к «{restorable}»
                </button>
              )}
              {!restorable && (
                <button
                  className="btn"
                  onClick={() => {
                    setFileName('Пример: фрагмент сессии')
                    setResult(DEMO)
                    setPhase('done')
                  }}
                >
                  Посмотреть на примере
                </button>
              )}
            </div>
          </div>

          <div className="uploader">
            <div className="field">
              <span className="label">Распознавание</span>
              <div className="seg">
                {STT_OPTIONS.filter((o) => showAllStt || !o.advanced || o.id === engine).map(
                  (o) => (
                    <button
                      key={o.id}
                      className={'seg-btn' + (engine === o.id ? ' on' : '')}
                      onClick={() => {
                        setEngine(o.id)
                        store.set('stt', o.id)
                      }}
                    >
                      {o.label}
                    </button>
                  )
                )}
              </div>
              <span className="hint">{STT_OPTIONS.find((o) => o.id === engine)?.note}</span>
              <button className="text-link" onClick={() => setShowAllStt((v) => !v)}>
                {showAllStt ? 'Скрыть дополнительные движки' : 'Ещё движки (OpenAI, Groq)'}
              </button>
            </div>
            <div className="field">
              <span className="label">Ключ сервиса ({STT_OPTIONS.find((o) => o.id === engine)?.hint})</span>
              <input
                type="password"
                placeholder="вставьте ключ, он останется в вашем браузере"
                value={sttKey}
                onChange={(e) => setSttKey(e.target.value)}
                onBlur={() => store.set('key.' + engine, sttKey.trim())}
              />
            </div>
            <div
              className={'drop' + (dragOver ? ' over' : '')}
              onClick={pick}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const f = e.dataTransfer.files?.[0]
                if (f) void handleFile(f)
              }}
              role="button"
              tabIndex={0}
            >
              {phase === 'busy' ? (
                <>
                  <span className="drop-title">Распознаю «{fileName}»…</span>
                  <span className="hint">
                    {estimate ? estimate + ' · ' : ''}
                    {busySec > 0 ? `идёт ${busySec} с · ` : ''}
                    обычно меньше минуты, не закрывайте вкладку
                  </span>
                </>
              ) : (
                <>
                  <span className="drop-title">Перетащите аудио или видео сюда</span>
                  <span className="hint">или нажмите, чтобы выбрать файл. mp3, m4a, wav, mp4</span>
                </>
              )}
            </div>
            {error && <div className="err">{error}</div>}
          </div>
        </section>
      )}

      {phase !== 'done' && (
        <section className="how">
          <div className="how-item">
            <h3>Загрузите запись</h3>
            <p>Сессия, встреча, лекция или интервью. Файл уходит только в выбранный сервис.</p>
          </div>
          <div className="how-item">
            <h3>Получите текст</h3>
            <p>Расшифровка по репликам с разделением голосов и привязкой ко времени.</p>
          </div>
          <div className="how-item">
            <h3>Сделайте результат</h3>
            <p>Саммари, протокол встречи, заметка сессии или свой промт. Готовым можно поделиться ссылкой.</p>
          </div>
        </section>
      )}

      {phase === 'done' && result && (
        <section className="work">
          <div className="work-head">
            <h2>{fileName}</h2>
            <div className="work-actions">
              <button
                className="btn"
                onClick={() => download(fileName.replace(/\.[^.]+$/, '') + '.txt', transcriptText())}
              >
                Скачать текст
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (!window.confirm('Закрыть эту расшифровку и начать новую?')) return
                  setPhase('idle')
                  setResult(null)
                  setAiText('')
                }}
              >
                Новая запись
              </button>
            </div>
          </div>

          <div className="cols">
            <div className="transcript">
              {result.turns.map((t) => (
                <div className="turn" key={t.id}>
                  <div className="turn-head">
                    <span className="spk" style={{ color: spkColor(t.spk) }}>
                      {spkName(t.spk)}
                    </span>
                    <span className="time">{fmtTime(t.startSec)}</span>
                  </div>
                  <p>
                    {t.words.map((w) => (
                      <span
                        key={w.id}
                        className="w"
                        onClick={() => {
                          if (w.s !== undefined && audioRef.current) {
                            audioRef.current.currentTime = w.s + 0.01
                            void audioRef.current.play()
                          }
                        }}
                      >
                        {w.t}{' '}
                      </span>
                    ))}
                  </p>
                </div>
              ))}
            </div>

            <aside className="make">
              <h2>Сделать из текста</h2>
              <div className="field">
                <span className="label">Модель для текста</span>
                <div className="seg">
                  <button
                    className={'seg-btn' + (aiEngine === 'claude' ? ' on' : '')}
                    onClick={() => {
                      setAiEngine('claude')
                      store.set('aiEngine', 'claude')
                    }}
                  >
                    Claude
                  </button>
                  <button
                    className={'seg-btn' + (aiEngine === 'openrouter' ? ' on' : '')}
                    onClick={() => {
                      setAiEngine('openrouter')
                      store.set('aiEngine', 'openrouter')
                    }}
                  >
                    OpenRouter
                  </button>
                </div>
              </div>
              {aiEngine === 'claude' ? (
                <>
                  <div className="field">
                    <span className="label">Ключ Claude (console.anthropic.com)</span>
                    <input
                      type="password"
                      placeholder="для промтов нужен ключ Claude"
                      value={claudeKey}
                      onChange={(e) => setClaudeKey(e.target.value)}
                      onBlur={() => store.set('claudeKey', claudeKey.trim())}
                    />
                  </div>
                  <div className="field">
                    <span className="label">Модель</span>
                    <div className="seg">
                      {CLAUDE_MODELS.map((m) => (
                        <button
                          key={m.id}
                          className={'seg-btn' + (model === m.id ? ' on' : '')}
                          onClick={() => {
                            setModel(m.id)
                            store.set('model', m.id)
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <span className="label">Ключ OpenRouter (openrouter.ai/keys)</span>
                    <input
                      type="password"
                      placeholder="sk-or-…"
                      value={orKey}
                      onChange={(e) => setOrKey(e.target.value)}
                      onBlur={() => store.set('orKey', orKey.trim())}
                    />
                  </div>
                  <div className="field">
                    <span className="label">Модель (id с openrouter.ai/models)</span>
                    <input
                      list="or-models"
                      placeholder="anthropic/claude-sonnet-5"
                      value={orModel}
                      onChange={(e) => setOrModel(e.target.value)}
                      onBlur={() => store.set('orModel', orModel.trim())}
                    />
                    <datalist id="or-models">
                      {OPENROUTER_MODELS.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                </>
              )}

              {custom.length > 0 && (
                <div className="cat">
                  <span className="label">Мои</span>
                  <div className="cards">
                    {custom.map((c) => (
                      <span className="card-wrap" key={c.id}>
                        <button
                          className="card"
                          disabled={aiBusy !== null}
                          onClick={() => void runPrompt(c.system, c.name, c.id)}
                        >
                          {aiBusy === c.id ? 'Делаю…' : c.name}
                        </button>
                        <button className="card-edit" title="Редактировать" onClick={() => editCard(c)}>
                          ✎
                        </button>
                        <button className="card-del" title="Удалить карточку" onClick={() => delCard(c.id)}>
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {CATEGORY_ORDER.map((cat) => {
                const items = BUILTIN_PROMPTS.filter((p) => p.category === cat)
                if (items.length === 0) return null
                return (
                  <div className="cat" key={cat}>
                    <span className="label">{CATEGORY_LABELS[cat]}</span>
                    <div className="cards">
                      {items.map((p) => (
                        <button
                          key={p.id}
                          className="card"
                          disabled={aiBusy !== null}
                          onClick={() => void runPrompt(p.system, p.name, p.id)}
                        >
                          {aiBusy === p.id ? 'Делаю…' : p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}

              <div className="cat">
                <span className="label">Свой промт</span>
                <textarea
                  placeholder="Например: вытащи все договорённости и сроки списком"
                  value={ownPrompt}
                  onChange={(e) => setOwnPrompt(e.target.value)}
                />
                <div className="own-row">
                  <button
                    className="btn primary"
                    disabled={aiBusy !== null || ownPrompt.trim() === ''}
                    onClick={() => void runPrompt(OWN_BASE + ownPrompt.trim(), 'Свой промт', 'own')}
                  >
                    {aiBusy === 'own' ? 'Делаю…' : 'Запустить'}
                  </button>
                  <input
                    placeholder="имя карточки"
                    value={ownName}
                    onChange={(e) => setOwnName(e.target.value)}
                  />
                  <button
                    className="btn"
                    disabled={ownName.trim() === '' || ownPrompt.trim() === ''}
                    onClick={saveCard}
                  >
                    {editingId ? 'Сохранить изменения' : 'Сохранить'}
                  </button>
                </div>
              </div>

              {error && <div className="err">{error}</div>}

              {aiText && (
                <div className="ai-result" ref={resultRef}>
                  <div className="ai-head">
                    <span className="label">{aiTitle}</span>
                    <div className="work-actions">
                      <button
                        className="btn"
                        onClick={() => {
                          void navigator.clipboard.writeText(aiText)
                          setCopied(true)
                        }}
                      >
                        {copied ? 'Скопировано' : 'Копировать'}
                      </button>
                      <button className="btn" onClick={() => download(aiTitle + '.md', aiText)}>
                        Скачать
                      </button>
                      <button className="btn" onClick={() => void shareResult()}>
                        {linkCopied ? 'Ссылка скопирована' : 'Поделиться ссылкой'}
                      </button>
                    </div>
                  </div>
                  <div className="ai-body md" dangerouslySetInnerHTML={{ __html: mdToHtml(aiText) }} />
                </div>
              )}
            </aside>
          </div>

          {audioUrl && (
            <div className="player">
              <audio ref={audioRef} src={audioUrl} controls />
            </div>
          )}
        </section>
      )}

      <footer className="foot">
        <p>
          Страница статическая: без сервера и без аккаунта. Ключи хранятся только в вашем браузере,
          запись уходит только в выбранный вами сервис. Для полностью локальной работы и записей
          длиннее часа есть <a href={RELEASES}>приложение для Windows</a>.
        </p>
        <a href={REPO}>Открытый код на GitHub</a>
      </footer>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*,.m4a,.mp3,.wav,.mp4,.mov,.webm"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
