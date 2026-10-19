import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { humanError } from '../toast'
import { useEscClose } from '../useEscClose'

// Запись звонка (Zoom, Telegram, WhatsApp, Meet…): две дорожки — микрофон («Я»)
// и звук компьютера («Собеседник», loopback Windows). Каждую потом
// расшифровываем отдельно — путаницы «кто сказал» нет (идея Wispr Flow / OpenWhispr).
// Куски летят в main каждые 2 с: сбой посреди звонка не теряет разговор.
// Звуковых сигналов здесь нет — loopback записал бы и их.

type Phase = 'setup' | 'starting' | 'recording' | 'saving'

interface Track {
  rec: MediaRecorder
  stream: MediaStream
  stopMeter: () => void
  done: Promise<void>
}

const SILENCE = 0.003

function meter(stream: MediaStream, onLevel: (v: number) => void): () => void {
  const ctx = new AudioContext()
  const an = ctx.createAnalyser()
  an.fftSize = 1024
  // Только анализ: НЕ подключаем к выходу — иначе звук собеседника проигрался бы
  // заново и попал в ту же запись (петля).
  ctx.createMediaStreamSource(stream).connect(an)
  const buf = new Float32Array(an.fftSize)
  const t = window.setInterval(() => {
    an.getFloatTimeDomainData(buf)
    let peak = 0
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
    onLevel(peak)
  }, 120)
  return () => {
    clearInterval(t)
    void ctx.close()
  }
}

function startTrack(id: string, kind: 'mic' | 'sys', stream: MediaStream, onLevel: (v: number) => void): Track {
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 })
  // Цепочка, чтобы куски уходили строго по порядку.
  let queue = Promise.resolve()
  rec.ondataavailable = (e) => {
    if (!e.data.size) return
    const blob = e.data
    queue = queue.then(async () => api.callChunk(id, kind, await blob.arrayBuffer()))
  }
  const done = new Promise<void>((resolve) => {
    rec.onstop = () => void queue.then(() => resolve())
  })
  rec.start(2000)
  return { rec, stream, stopMeter: meter(stream, onLevel), done }
}

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const h = Math.floor(m / 60)
  return (h ? `${h}:${String(m % 60).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0')
}

function Level({ v, label }: { v: number; label: string }): React.JSX.Element {
  const pct = Math.min(100, Math.round(Math.sqrt(v) * 140))
  return (
    <div className="call-level">
      <span className="call-level-label">{label}</span>
      <span className="call-level-bar">
        <span style={{ width: pct + '%' }} />
      </span>
    </div>
  )
}

export default function CallRecorder({
  app,
  onClose,
  onDone
}: {
  app?: { appId: string; name: string }
  onClose: () => void
  onDone: (slug: string) => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('setup')
  const [names, setNames] = useState<[string, string]>(['Я', 'Собеседник'])
  const [err, setErr] = useState<string | null>(null)
  // Постоянные предупреждения (пропал микрофон/звук, ошибка диска) — отдельно от
  // сторожа тишины: тот гаснет сам, когда собеседник снова заговорил.
  const [notice, setNotice] = useState<string | null>(null)
  const [silent, setSilent] = useState(false)
  const [levels, setLevels] = useState({ mic: 0, sys: 0 })
  const [elapsed, setElapsed] = useState(0)
  const idRef = useRef('')
  const tracksRef = useRef<{ mic?: Track; sys?: Track }>({})
  const lastSysSound = useRef(0)
  const startedAt = useRef(0)
  const startingRef = useRef(false)

  useEffect(() => api.onCallWriteError((m) => setNotice(m)), [])

  useEscClose(() => {
    if (phase === 'setup') onClose()
  })

  useEffect(() => {
    api.getSettings().then((s) => s.callNames && setNames(s.callNames))
  }, [])

  // Таймер и сторож «собеседника не слышно».
  useEffect(() => {
    if (phase !== 'recording') return
    const t = window.setInterval(() => {
      setElapsed((Date.now() - startedAt.current) / 1000)
      setSilent(!!tracksRef.current.sys && Date.now() - lastSysSound.current > 30_000)
    }, 500)
    return () => clearInterval(t)
  }, [phase])

  const stopAll = (): Promise<void[]> => {
    const t = tracksRef.current
    const list = [t.mic, t.sys].filter((x): x is Track => !!x)
    for (const x of list) {
      x.stopMeter()
      if (x.rec.state !== 'inactive') x.rec.stop()
      x.stream.getTracks().forEach((tr) => tr.stop())
    }
    return Promise.all(list.map((x) => x.done))
  }

  // Окно закрыли посреди записи — дорожки остановить; куски уже на диске,
  // main соберёт запись при следующем запуске.
  useEffect(() => () => void stopAll(), [])

  const start = async (): Promise<void> => {
    // Повторный клик, пока включаются микрофон и звук компьютера, второй записи
    // не начинает (ревью волны 3: первая оставалась невидимой с включённым микрофоном).
    if (startingRef.current || phase !== 'setup') return
    startingRef.current = true
    setPhase('starting')
    setErr(null)
    setNotice(null)
    setSilent(false)
    tracksRef.current = {}
    const id = 'call' + Date.now().toString(36)
    idRef.current = id
    let mic: MediaStream
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      })
    } catch (e) {
      setErr(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Нет доступа к микрофону. Разрешите его в «Параметры Windows → Конфиденциальность → Микрофон».'
          : 'Микрофон не найден.'
      )
      setPhase('setup')
      startingRef.current = false
      return
    }
    try {
      await api.callOpen(id)
    } catch (e) {
      mic.getTracks().forEach((t) => t.stop())
      setErr('Не получилось начать запись: ' + humanError(e))
      setPhase('setup')
      startingRef.current = false
      return
    }
    // Гарнитуру вынули или Bluetooth переподключился — дорожка микрофона кончилась.
    mic.getAudioTracks()[0].onended = () =>
      setNotice('Микрофон отключился — ваш голос больше не пишется. Подключите микрофон, остановите запись и начните новую.')
    tracksRef.current.mic = startTrack(id, 'mic', mic, (v) => setLevels((l) => ({ ...l, mic: v })))
    try {
      // Звук компьютера: Windows отдаёт его вместе с «экраном» — картинку сразу глушим.
      // Обработку выключаем: по умолчанию Chromium включает на loopback подавление
      // эха/шума и автогромкость — эхоподавитель может «съесть» самого собеседника,
      // а автогромкость клиппировала (живой прогон: пик 0 дБ против −4 дБ без неё).
      const disp = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      })
      disp.getVideoTracks().forEach((t) => t.stop())
      const audio = disp.getAudioTracks()
      if (!audio.length) throw new Error('нет звука компьютера')
      audio[0].onended = () => setNotice('Звук компьютера пропал (сменилось устройство вывода?). Микрофон пишется дальше.')
      lastSysSound.current = Date.now()
      tracksRef.current.sys = startTrack(id, 'sys', new MediaStream(audio), (v) => {
        setLevels((l) => ({ ...l, sys: v }))
        if (v > SILENCE) lastSysSound.current = Date.now()
      })
    } catch {
      setNotice('Звук компьютера недоступен — пишу только микрофон. Собеседник попадёт в запись, только если слышен в комнате.')
    }
    startedAt.current = Date.now()
    startingRef.current = false
    setPhase('recording')
  }

  const finish = async (): Promise<void> => {
    setPhase('saving')
    try {
      await stopAll()
      const d = new Date()
      const when = d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      const title = `Звонок${app ? ' в ' + app.name : ''} — ${when}`
      const meta = await api.callFinish(idRef.current, {
        title,
        names: [names[0].trim() || 'Я', names[1].trim() || 'Собеседник'],
        app: app?.name
      })
      onDone(meta.slug)
    } catch (e) {
      setErr('Не получилось собрать запись: ' + humanError(e) + ' Файлы дорожек сохранены — «Слово» соберёт их при следующем запуске.')
      setPhase('setup')
    }
  }

  const discard = async (): Promise<void> => {
    if (!window.confirm('Удалить эту запись звонка? Восстановить её будет нельзя.')) return
    await stopAll()
    await api.callCancel(idRef.current)
    onClose()
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-sm call-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Запись звонка{app ? ` в ${app.name}` : ''}</span>
        </div>

        {phase === 'setup' && (
          <>
            <div className="call-names">
              <label>
                <span className="input-label">Вы (микрофон)</span>
                <input className="text-input" value={names[0]} onChange={(e) => setNames([e.target.value, names[1]])} />
              </label>
              <label>
                <span className="input-label">Собеседник (звук компьютера)</span>
                <input className="text-input" value={names[1]} onChange={(e) => setNames([names[0], e.target.value])} />
              </label>
            </div>
            <div className="call-note">Предупредите собеседника, что разговор записывается.</div>
            <div className="panel-note">
              Лучше в наушниках: тогда голос собеседника не попадёт в ваш микрофон. Запись остаётся на этом
              компьютере.
            </div>
            {err && <div className="key-bad">{err}</div>}
            <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
              {app ? (
                <button
                  className="link-btn"
                  onClick={async () => {
                    await api.callMute(app.appId)
                    onClose()
                  }}
                >
                  Не предлагать запись для {app.name === 'браузере' ? 'браузера' : app.name}
                </button>
              ) : (
                <span />
              )}
              <span style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={onClose}>
                  Отмена
                </button>
                <button className="btn btn-primary" onClick={start}>
                  Начать запись
                </button>
              </span>
            </div>
          </>
        )}

        {phase === 'recording' && (
          <>
            <div className="call-live">
              <span className="redict-dot" />
              <span>Идёт запись · {fmtClock(elapsed)}</span>
            </div>
            <Level label={names[0] || 'Вы'} v={levels.mic} />
            {tracksRef.current.sys && <Level label={names[1] || 'Собеседник'} v={levels.sys} />}
            {notice && <div className="key-bad">{notice}</div>}
            {silent && (
              <div className="key-bad">
                Не слышу собеседника 30 секунд. Звук звонка должен идти на устройство вывода по умолчанию.
              </div>
            )}
            <div className="panel-note">Можно свернуть «Слово» — запись идёт. Если окно закрыть, запись сохранится и соберётся при следующем запуске.</div>
            <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
              <button className="btn" onClick={discard}>
                Удалить запись
              </button>
              <button className="btn btn-primary" onClick={finish}>
                Остановить и сохранить
              </button>
            </div>
          </>
        )}

        {phase === 'starting' && <div className="call-live">Включаю микрофон и звук компьютера…</div>}
        {phase === 'saving' && <div className="call-live">Собираю запись…</div>}
      </div>
    </div>
  )
}
