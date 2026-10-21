import { useEffect, useRef } from 'react'
import { api } from '../api'

// Невидимый рекордер системной диктовки: main говорит start/stop/cancel,
// мы пишем микрофон и отдаём клип. AGC выключен: на Windows он физически
// крутит системную громкость микрофона (грабли OpenWhispr #476).
//
// Надёжность (уроки OpenWhispr/Handy):
//  - хвост: после отпускания клавиши пишем ещё tailMs — последнее слово не обрезается;
//  - выбранный микрофон пропал → берём системный по умолчанию;
//  - весь клип тишина → честно говорим «микрофон молчит», а не «ничего не расслышал»;
//  - нет доступа к микрофону → сразу ошибка, а не вечное «Распознаю…»;
//  - у каждой записи свой номер: клавишу отпустили, пока микрофон открывался, —
//    открытый позже микрофон сразу закрываем, а не пишем «призрачную» запись
//    (ревью волны 6).

// Порог «тишины»: пиковая амплитуда ниже ~-50 дБ на всём клипе.
const SILENCE_PEAK = 0.003

function chirp(freqs: number[]): void {
  try {
    const ctx = new AudioContext()
    let t = ctx.currentTime
    for (const f of freqs) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = f
      g.gain.value = 0.15
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 0.09)
      t += 0.115
    }
    setTimeout(() => void ctx.close(), 600)
  } catch {
    /* звук не критичен */
  }
}

async function openMic(micId: string): Promise<MediaStream> {
  const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  if (micId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: micId } } })
    } catch {
      /* выбранного микрофона нет (отключили) — пробуем системный */
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base })
}

interface Session {
  /** номер диктовки от main — возвращаем его вместе со звуком */
  id?: number
  rec: MediaRecorder
  chunks: Blob[]
  peak: number
  meter: { ctx: AudioContext; timer: number }
  live: boolean
  liveQueue: Promise<void>
}

export default function DictationRecorder(): null {
  const sessRef = useRef<Session | null>(null)
  const tokenRef = useRef(0)
  const openingRef = useRef(false)
  const soundsRef = useRef(true)
  const tailRef = useRef(300)
  const failedRef = useRef<string | null>(null)
  const idRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return api.onDictRecord((cmd, opts) => {
      if (cmd === 'start') {
        const token = ++tokenRef.current
        soundsRef.current = opts?.sounds !== false
        tailRef.current = Math.max(0, Math.min(2000, opts?.tailMs ?? 300))
        failedRef.current = null
        openingRef.current = true
        idRef.current = opts?.id
        void (async () => {
          try {
            const stream = await openMic(opts?.micId ?? '')
            if (token !== tokenRef.current) {
              // Остановили или отменили, пока микрофон открывался.
              stream.getTracks().forEach((t) => t.stop())
              return
            }
            const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
            // Измеритель уровня: только пик, без записи — для «микрофон молчит».
            const ctx = new AudioContext()
            const an = ctx.createAnalyser()
            an.fftSize = 2048
            ctx.createMediaStreamSource(stream).connect(an)
            const buf = new Float32Array(an.fftSize)
            const s: Session = {
              id: idRef.current,
              rec,
              chunks: [],
              peak: 0,
              meter: { ctx, timer: 0 },
              live: !!opts?.live,
              liveQueue: Promise.resolve()
            }
            s.meter.timer = window.setInterval(() => {
              an.getFloatTimeDomainData(buf)
              for (let i = 0; i < buf.length; i++) {
                const v = Math.abs(buf[i])
                if (v > s.peak) s.peak = v
              }
            }, 100)
            rec.ondataavailable = (e) => {
              if (e.data.size === 0) return
              s.chunks.push(e.data)
              // Текст в плашке: кусок сразу в поток распознавания (по порядку).
              if (s.live) {
                const blob = e.data
                s.liveQueue = s.liveQueue.then(async () => api.sendDictChunk(await blob.arrayBuffer()))
              }
            }
            sessRef.current = s
            rec.start(250) // таймслайс: даже полсекунды речи содержит кадры
            if (soundsRef.current) chirp([523, 659])
          } catch (err) {
            if (token === tokenRef.current)
              failedRef.current =
                err instanceof DOMException && err.name === 'NotAllowedError'
                  ? 'Нет доступа к микрофону'
                  : 'Микрофон не найден'
          } finally {
            if (token === tokenRef.current) openingRef.current = false
          }
        })()
        return
      }

      const s = sessRef.current
      if (!s) {
        const opening = openingRef.current
        tokenRef.current++ // недооткрытый микрофон закроется сам
        openingRef.current = false
        // Запись так и не началась — сообщаем сразу, иначе плашка висела бы на «Распознаю…».
        if (cmd === 'stop')
          void api.sendDictAudio(
            new ArrayBuffer(0),
            opening && !failedRef.current
              ? { tooShort: true, id: idRef.current }
              : { error: failedRef.current ?? 'Запись не началась', id: idRef.current }
          )
        return
      }
      sessRef.current = null
      tokenRef.current++
      const rec = s.rec
      const finishRec = (): void => {
        rec.onstop = async () => {
          rec.stream.getTracks().forEach((t) => t.stop())
          clearInterval(s.meter.timer)
          void s.meter.ctx.close()
          if (cmd === 'cancel') return
          if (soundsRef.current) chirp([587, 440])
          await s.liveQueue // последний кусок ушёл в поток раньше клипа
          const blob = new Blob(s.chunks, { type: 'audio/webm' })
          await api.sendDictAudio(await blob.arrayBuffer(), { silent: s.peak < SILENCE_PEAK, id: s.id })
        }
        rec.stop()
      }
      // Отмену — сразу; остановку — с хвостом, чтобы не съесть последнее слово.
      if (cmd === 'stop' && tailRef.current > 0) setTimeout(finishRec, tailRef.current)
      else finishRec()
    })
  }, [])

  return null
}
