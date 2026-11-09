import { useEffect, useRef, useState } from 'react'
import * as Switch from '@radix-ui/react-switch'
import { Mic } from 'lucide-react'
import type { DictationSettings } from '../../../shared/types'
import { defaultDictation } from '../../../shared/types'
import { api } from '../api'
import { useLibrary } from '../library'
import { hotkeyLabel } from '../dictKeys'
import DictationHistory, { MicSelect } from '../components/DictationHistory'
import { Skeleton } from '../components/Skeleton'
import { useSectionHints } from '../tour/TourProvider'

// Страница «Диктовка»: включить, проверить микрофон, посмотреть статистику и
// историю. История видна и при выключенной диктовке. Остальные настройки
// диктовки (режимы, вставка, ИИ-чистка) остаются в «Настройки → Диктовка».

type MicState = { kind: 'idle' } | { kind: 'listening'; level: number } | { kind: 'ok' } | { kind: 'quiet' } | { kind: 'fail'; text: string }

const CHECK_MS = 4000
// Пик громче этого значения — микрофон слышит голос (в рекордере диктовки порог тишины 0.003).
const HEARD_PEAK = 0.02

function MicCheck({ micId }: { micId: string }): React.JSX.Element {
  const [state, setState] = useState<MicState>({ kind: 'idle' })
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  const start = async (): Promise<void> => {
    stopRef.current?.()
    setState({ kind: 'listening', level: 0 })
    let stream: MediaStream
    try {
      const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micId ? { ...base, deviceId: { exact: micId } } : base
        })
      } catch (err) {
        if (!micId || (err instanceof DOMException && err.name === 'NotAllowedError')) throw err
        stream = await navigator.mediaDevices.getUserMedia({ audio: base }) // выбранного микрофона нет
      }
    } catch (err) {
      setState({
        kind: 'fail',
        text: err instanceof DOMException && err.name === 'NotAllowedError' ? 'Нет доступа к микрофону.' : 'Микрофон не найден.'
      })
      return
    }
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 2048
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Float32Array(an.fftSize)
    let peak = 0
    const t0 = Date.now()
    const done = (): void => {
      window.clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
      stopRef.current = null
    }
    const timer = window.setInterval(() => {
      an.getFloatTimeDomainData(buf)
      let p = 0
      for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]))
      peak = Math.max(peak, p)
      if (Date.now() - t0 >= CHECK_MS) {
        done()
        setState(peak >= HEARD_PEAK ? { kind: 'ok' } : { kind: 'quiet' })
      } else setState({ kind: 'listening', level: Math.min(1, p * 4) })
    }, 80)
    stopRef.current = done
  }

  return (
    <div className="dp-mic">
      <button
        className="btn"
        onClick={() => void start()}
        disabled={state.kind === 'listening'}
        data-testid="mic-check"
        data-tour="mic-check"
      >
        {state.kind === 'listening' ? 'Слушаю…' : 'Проверить'}
      </button>
      <div className="dp-meter" aria-hidden="true">
        <div className="dp-meter-bar" style={{ width: state.kind === 'listening' ? `${Math.round(state.level * 100)}%` : '0%' }} />
      </div>
      <span className="settings-status" role="status">
        {state.kind === 'idle' && 'Скажите что-нибудь — полоса покажет голос.'}
        {state.kind === 'listening' && 'Скажите что-нибудь.'}
        {state.kind === 'ok' && 'Микрофон слышит вас.'}
        {state.kind === 'quiet' && 'Тихо. Проверьте микрофон и громкость.'}
        {state.kind === 'fail' && state.text}
      </span>
    </div>
  )
}

function Stat({ value, label }: { value: React.ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="dp-stat">
      <div className="dp-stat-num">{value}</div>
      <div className="dp-stat-label">{label}</div>
    </div>
  )
}

/** «1 день», «2 дня», «5 дней». */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export default function Dictation({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  const [dict, setDict] = useState<DictationSettings | null>(null)
  const stats = useLibrary((s) => s.setup?.stats)
  const refreshSetup = useLibrary((s) => s.refreshSetup)
  useSectionHints('dictation')

  useEffect(() => {
    api.getSettings().then((s) => setDict({ ...defaultDictation, ...s.dictation }))
    void refreshSetup()
    return api.onDictLogged(() => void refreshSetup())
  }, [refreshSetup])

  // Как в настройках: берём свежую диктовку из файла (окно «Режимы» могло изменить свои части).
  const save = (patch: Partial<DictationSettings>): void => {
    setDict((d) => (d ? { ...d, ...patch } : d))
    void api
      .getSettings()
      .then((s) => api.setSettings({ dictation: { ...defaultDictation, ...s.dictation, ...patch } }))
      .then(() => refreshSetup())
  }

  return (
    <main className="start-page" data-testid="dictation-page">
      <div className="start-inner dp">
        <h1 className="start-title">Диктовка</h1>
        <p className="dp-lead">Зажмите клавишу и говорите — текст появится там, где стоит курсор.</p>

        <section className="dp-card" aria-label="Состояние диктовки" data-tour="dict-state">
          {dict ? (
            <>
              <div className="dp-row">
                <span className={'status-dot' + (dict.enabled ? ' is-on' : '')} aria-hidden="true" />
                <label className="dp-row-main" htmlFor="dp-enabled">
                  <strong>{dict.enabled ? 'Диктовка включена' : 'Диктовка выключена'}</strong>
                  <span className="st-hint">
                    {dict.enabled ? 'Работает в любой программе.' : 'Включите, чтобы диктовать в любое окно.'}
                  </span>
                </label>
                <span className="st-sw-state" aria-hidden="true">
                  {dict.enabled ? 'Вкл' : 'Выкл'}
                </span>
                <Switch.Root
                  id="dp-enabled"
                  className="sw"
                  checked={dict.enabled}
                  onCheckedChange={(v) => save({ enabled: v })}
                  data-testid="dict-switch"
                  data-tour="dict-switch"
                >
                  <Switch.Thumb className="sw-thumb" />
                </Switch.Root>
              </div>
              <div className="dp-row" data-tour="dict-key">
                <Mic size={16} className="dp-ico" aria-hidden="true" />
                <span className="dp-row-line">
                  Клавиша: <kbd className="dp-kbd">{hotkeyLabel(dict.hotkey)}</kbd>
                </span>
                <button className="text-link" onClick={onOpenSettings} data-testid="dict-change-key">
                  Изменить
                </button>
              </div>
              <div className="dp-row dp-row-col">
                <span className="dp-row-main">Микрофон</span>
                <div className="dp-mic-pick">
                  <MicSelect value={dict.micId ?? ''} onChange={(id) => save({ micId: id })} />
                </div>
                <MicCheck micId={dict.micId ?? ''} />
              </div>
            </>
          ) : (
            <Skeleton height={120} radius={10} />
          )}
        </section>

        <section className="dp-card" aria-label="Статистика" data-tour="dict-stats">
          <div className="dp-stats">
            <Stat value={stats ? stats.wordsWeek : '—'} label="слов за 7 дней" />
            <Stat
              value={stats ? stats.streak : '—'}
              label={stats ? `${plural(stats.streak, 'день', 'дня', 'дней')} подряд` : 'дней подряд'}
            />
            <Stat value={stats ? stats.total : '—'} label={stats ? plural(stats.total, 'диктовка', 'диктовки', 'диктовок') + ' всего' : 'диктовок всего'} />
            {stats?.wpm != null && <Stat value={stats.wpm} label="слов в минуту" />}
          </div>
        </section>

        <div data-tour="dict-history">
          <h2 className="feed-h dp-h">История</h2>
          <DictationHistory />
        </div>
      </div>
    </main>
  )
}
