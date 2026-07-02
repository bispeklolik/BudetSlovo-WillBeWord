import type { SttEngine } from './types'

// Метаданные движков расшифровки — чистые данные, общие для UI (список в
// настройках) и main (подписи в ошибках/прогрессе). Сами вызовы API живут в
// main/stt/* и подключаются по id (см. main/stt/index.ts).
export interface SttEngineMeta {
  id: SttEngine
  label: string
  cloud: boolean
  diarize: boolean // разделяет говорящих (Психолог/Клиент)?
  price: string
  keyHint?: string // где взять ключ
  tier?: 'max' | 'value' // основной режим: макс. точность / цена-качество
  advanced?: boolean // прячем за «показать все движки»
}

// Два основных режима + локально; остальные три — «продвинутые» (за тумблером).
export const STT_ENGINES: SttEngineMeta[] = [
  { id: 'local', label: 'Локально (Whisper)', cloud: false, diarize: true, price: 'бесплатно, на вашем ПК' },
  { id: 'elevenlabs', label: 'ElevenLabs Scribe', cloud: true, diarize: true, price: '≈ $0.004 / мин', keyHint: 'elevenlabs.io', tier: 'max' },
  { id: 'deepgram', label: 'Deepgram', cloud: true, diarize: true, price: '≈ $0.004 / мин', keyHint: 'console.deepgram.com', tier: 'value' },
  { id: 'assemblyai', label: 'AssemblyAI', cloud: true, diarize: true, price: '≈ $0.0035 / мин', keyHint: 'assemblyai.com', advanced: true },
  { id: 'openai', label: 'OpenAI Whisper', cloud: true, diarize: false, price: '≈ $0.006 / мин', keyHint: 'platform.openai.com', advanced: true },
  { id: 'groq', label: 'Groq Whisper', cloud: true, diarize: false, price: '≈ $0.0007 / мин', keyHint: 'console.groq.com', advanced: true }
]

// Подпись основного режима для выпадающего списка.
export function sttModeLabel(m: SttEngineMeta): string {
  if (m.tier === 'max') return `Максимальная точность — ${m.label}`
  if (m.tier === 'value') return `Цена/качество — ${m.label}`
  return m.label
}

export const sttMeta = (id: string): SttEngineMeta | undefined => STT_ENGINES.find((e) => e.id === id)
