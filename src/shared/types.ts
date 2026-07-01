export type Theme = 'light' | 'dark'

export type AiEngine = 'local-llama' | 'claude'

// Движок расшифровки: локальный Whisper (приватно, на этом компьютере) или
// один из облачных (быстрее, но аудио уходит на их серверы).
export type SttEngine = 'local' | 'deepgram' | 'assemblyai' | 'elevenlabs' | 'openai' | 'groq'

export interface Settings {
  theme: Theme
  folders?: string[] // явный список папок (включая пустые), чтобы они не исчезали
  aiEngine?: AiEngine // чем обрабатывать: локально или облачный Claude
  anthropicKey?: string // ключ Anthropic API (хранится локально), для движка Claude
  claudeModel?: string // модель Claude (по умолчанию sonnet)
  sttEngine?: SttEngine // чем расшифровывать: локально или облачный движок
  sttKeys?: Record<string, string> // ключи облачных STT по id движка (хранятся локально)
}

export const defaultSettings: Settings = {
  theme: 'light',
  folders: [],
  aiEngine: 'local-llama',
  claudeModel: 'claude-sonnet-4-6',
  sttEngine: 'local'
}

// Конспект — сохранённая текстовая выжимка (саммари, лучшие мысли, заметка).
export interface Note {
  id: string
  title: string
  body: string
  kind: 'summary' | 'thoughts' | 'note'
  sourceSlug?: string
  sourceTitle?: string
  createdAt: string
  updatedAt: string
}

export type NoteInput = {
  id?: string
  title: string
  body: string
  kind: Note['kind']
  sourceSlug?: string
  sourceTitle?: string
}

export interface ProjectAudio {
  file: string
  originalPath: string
  durationSec: number
  repairedPrefixBytes: number
  peaks: { file: string; perSec: number }
}

export interface Word {
  id: number
  /** Секунды начала/конца и уверенность — отсутствуют у вставленных слов. */
  s?: number
  e?: number
  p?: number
  t: string
  /** Исходный текст движка, если слово правили. */
  t0?: string
  /**
   * Пометка ИИ для подсветки:
   * 'ai' — слово изменено/вставлено ИИ-чисткой;
   * 'suspect' — ИИ считает слово вероятной ошибкой распознавания / бессмыслицей
   * (оставлено как есть, но требует проверки человеком).
   */
  src?: 'ai' | 'suspect'
  /** true — слово входит в «лучшую мысль», выделенную ИИ (для подсветки). */
  hl?: boolean
}

export interface Turn {
  id: string
  spk: string
  startSec: number
  words: Word[]
}

export interface SpeakerInfo {
  id: string
  engineLabel: string
  name: string
  colorKey: string
}

export interface ProjectMeta {
  version: 1
  id: string
  slug: string
  title: string
  createdAt: string
  updatedAt: string
  /** Папка для организации (напр. «Консультации/Ева»); пусто/нет = корень. */
  folder?: string
  audio: ProjectAudio
  transcription?: {
    numSpeakers: number
    enhance: boolean
  }
  engine?: {
    model: string
    completedAt: string
  }
  speakers?: SpeakerInfo[]
  turns?: Turn[]
  /** Правила обезличивания (ИИ нашёл имена/места/организации). Оригинал не меняется. */
  anon?: AnonRule[]
}

// Правило обезличивания: подстрока как в тексте → нейтральная замена.
export interface AnonRule {
  find: string
  replace: string
  kind: 'name' | 'place' | 'org' | 'other'
}

export type ImportProgress =
  | { phase: 'repair'; message: string }
  | { phase: 'peaks'; message: string }
  | { phase: 'done'; message: string }

export interface TranscribeOptions {
  numSpeakers: number
  enhance: boolean
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'interrupted'

export interface JobInfo {
  id: string
  kind: 'transcribe'
  slug: string
  options?: TranscribeOptions
  status: JobStatus
  phase: string
  percent: number | null
  error?: string
  cancelRequested?: boolean
  createdAt: string
  startedAt?: string
  endedAt?: string
}
