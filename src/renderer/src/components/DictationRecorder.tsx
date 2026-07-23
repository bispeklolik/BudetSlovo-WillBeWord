import { useEffect, useRef } from 'react'
import { api } from '../api'

// Невидимый рекордер системной диктовки: main говорит start/stop/cancel,
// мы пишем микрофон и отдаём клип. AGC выключен: на Windows он физически
// крутит системную громкость микрофона (грабли OpenWhispr #476).

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

export default function DictationRecorder(): null {
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const soundsRef = useRef(true)

  useEffect(() => {
    return api.onDictRecord((cmd, opts) => {
      if (cmd === 'start') {
        soundsRef.current = opts?.sounds !== false
        void (async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
              }
            })
            const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
            chunksRef.current = []
            rec.ondataavailable = (e) => {
              if (e.data.size > 0) chunksRef.current.push(e.data)
            }
            recRef.current = rec
            rec.start(250) // таймслайс: даже полсекунды речи содержит кадры
            if (soundsRef.current) chirp([523, 659])
          } catch {
            /* нет микрофона — main покажет ошибку по таймауту пустого аудио */
          }
        })()
      } else {
        const rec = recRef.current
        if (!rec) return
        recRef.current = null
        rec.onstop = async () => {
          rec.stream.getTracks().forEach((t) => t.stop())
          if (cmd === 'cancel') return
          if (soundsRef.current) chirp([587, 440])
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
          await api.sendDictAudio(await blob.arrayBuffer())
        }
        rec.stop()
      }
    })
  }, [])

  return null
}
