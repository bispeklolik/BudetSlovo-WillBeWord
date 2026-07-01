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
}

export const STT_ENGINES: SttEngineMeta[] = [
  { id: 'local', label: 'Локально (Whisper)', cloud: false, diarize: true, price: 'бесплатно, на вашем ПК' },
  { id: 'deepgram', label: 'Deepgram', cloud: true, diarize: true, price: '≈ $0.004 / мин', keyHint: 'console.deepgram.com' },
  { id: 'assemblyai', label: 'AssemblyAI', cloud: true, diarize: true, price: '≈ $0.0035 / мин', keyHint: 'assemblyai.com' },
  { id: 'elevenlabs', label: 'ElevenLabs Scribe', cloud: true, diarize: true, price: '≈ $0.004 / мин', keyHint: 'elevenlabs.io' },
  { id: 'openai', label: 'OpenAI Whisper', cloud: true, diarize: false, price: '≈ $0.006 / мин', keyHint: 'platform.openai.com' },
  { id: 'groq', label: 'Groq Whisper', cloud: true, diarize: false, price: '≈ $0.0007 / мин', keyHint: 'console.groq.com' }
]

export const sttMeta = (id: string): SttEngineMeta | undefined => STT_ENGINES.find((e) => e.id === id)
