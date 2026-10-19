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
//  - нет доступа к микрофону → сразу ошибка, а не вечное «Распознаю…».

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

export default function DictationRecorder(): null {
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const soundsRef = useRef(true)
  const tailRef = useRef(300)
  const peakRef = useRef(0)
  const meterRef = useRef<{ ctx: AudioContext; timer: number } | null>(null)
  const failedRef = useRef<string | null>(null)

  useEffect(() => {
    const stopMeter = (): void => {
      const m = meterRef.current
      meterRef.current = null
      if (m) {
        clearInterval(m.timer)
        void m.ctx.close()
      }
    }

    return api.onDictRecord((cmd, opts) => {
      if (cmd === 'start') {
        soundsRef.current = opts?.sounds !== false
        tailRef.current = Math.max(0, Math.min(2000, opts?.tailMs ?? 300))
        failedRef.current = null
        peakRef.current = 0
        void (async () => {
          try {
            const stream = await openMic(opts?.micId ?? '')
            const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
            chunksRef.current = []
            rec.ondataavailable = (e) => {
              if (e.data.size > 0) chunksRef.current.push(e.data)
            }
            // Измеритель уровня: только пик, без записи — для «микрофон молчит».
            const ctx = new AudioContext()
            const an = ctx.createAnalyser()
            an.fftSize = 2048
            ctx.createMediaStreamSource(stream).connect(an)
            const buf = new Float32Array(an.fftSize)
            const timer = window.setInterval(() => {
              an.getFloatTimeDomainData(buf)
              for (let i = 0; i < buf.length; i++) {
                const v = Math.abs(buf[i])
                if (v > peakRef.current) peakRef.current = v
              }
            }, 100)
            meterRef.current = { ctx, timer }
            recRef.current = rec
            rec.start(250) // таймслайс: даже полсекунды речи содержит кадры
            if (soundsRef.current) chirp([523, 659])
          } catch (err) {
            failedRef.current =
              err instanceof DOMException && err.name === 'NotAllowedError'
                ? 'Нет доступа к микрофону'
                : 'Микрофон не найден'
          }
        })()
        return
      }

      const rec = recRef.current
      if (!rec) {
        // Запись так и не началась — сообщаем сразу, иначе плашка висела бы на «Распознаю…».
        if (cmd === 'stop')
          void api.sendDictAudio(new ArrayBuffer(0), { error: failedRef.current ?? 'Запись не началась' })
        return
      }
      recRef.current = null
      const finishRec = (): void => {
        rec.onstop = async () => {
          rec.stream.getTracks().forEach((t) => t.stop())
          const peak = peakRef.current
          stopMeter()
          if (cmd === 'cancel') return
          if (soundsRef.current) chirp([587, 440])
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
          await api.sendDictAudio(await blob.arrayBuffer(), { silent: peak < SILENCE_PEAK })
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
