export type Theme = 'light' | 'dark'

import type { CustomPrompt } from './prompts'
import type { Vocab } from './vocab'
import type { DictTone, CustomDictMode } from './dictModes'

export type AiEngine = 'local-llama' | 'claude' | 'openrouter'

// Движок расшифровки: локальный Whisper (приватно, на этом компьютере) или
// один из облачных (быстрее, но аудио уходит на их серверы).
export type SttEngine = 'local' | 'deepgram' | 'assemblyai' | 'elevenlabs' | 'openai' | 'groq'

export interface Settings {
  theme: Theme
  folders?: string[] // явный список папок (включая пустые), чтобы они не исчезали
  aiEngine?: AiEngine // чем обрабатывать: локально или облачный Claude
  anthropicKey?: string // ключ Anthropic API (хранится локально), для движка Claude
  claudeModel?: string // модель Claude (по умолчанию sonnet)
  openrouterKey?: string // ключ OpenRouter (хранится локально)
  openrouterModel?: string // id модели OpenRouter (например anthropic/claude-sonnet-5)
  sttEngine?: SttEngine // чем расшифровывать: локально или облачный движок
  sttKeys?: Record<string, string> // ключи облачных STT по id движка (хранятся локально)
  customPrompts?: CustomPrompt[] // пользовательские карточки-промты для библиотеки
  dictation?: DictationSettings // системная диктовка (глобальная горячая клавиша)
  onboarded?: boolean // первый запуск («три двери») пройден
  engineDir?: string // своя папка движка Faster-Whisper-XXL (если не по умолчанию)
  localModel?: string // модель локального Whisper: 'large-v3' | 'large-v3-turbo' | 'medium' | 'small'
  localDevice?: 'auto' | 'cuda' | 'cpu' // на чём считать локально (auto — видеокарта NVIDIA, если есть)
  pauseMarkSec?: number // отмечать паузы в тексте от N секунд (0 — не отмечать)
  pauseInExport?: boolean // паузы и в экспорте Word/txt/md (субтитры — никогда)
  callPrompt?: boolean // предлагать запись, когда начинается звонок
  callMuted?: string[] // программы, для которых подсказку о звонке не показывать (id из callDetect)
  callNames?: [string, string] // подписи дорожек звонка: микрофон / звук компьютера
  missedMinutes?: number // «Что я пропустил?» — за сколько последних минут пересказать
  consentText?: string // мой вариант согласия на запись (пусто — шаблон)
  vocab?: Vocab // словарь: слова для распознавания, точные замены, сниппеты
  mcpPolicy?: 'anon' | 'all' // что Claude (MCP) может читать: все записи (по умолчанию) или только обезличенные
  watchFolder?: { dir: string; autoTranscribe: boolean } // папка-наблюдатель: новые записи берутся сами
}

// Системная диктовка: зажал клавишу — говоришь (push-to-talk), быстрый
// двойной тап — запись до следующего нажатия. Всё настраивается.
export interface DictationSettings {
  enabled: boolean
  hotkey: string // e.code-имя клавиши (например 'F9', 'ControlRight')
  polish: boolean // LLM-чистка текста (паразиты/самоисправления/пунктуация)
  autoPaste: boolean // вставлять в активное окно (false = только в буфер)
  sounds: boolean // звуковые сигналы старта/стопа записи
  tailMs?: number // дописывать после отпускания клавиши, мс (чтобы не съесть последнее слово)
  pauseMedia?: boolean // ставить музыку/видео на паузу на время диктовки
  keepAudioDays?: number // сколько дней хранить аудио диктовок для «Повторить» (0 — не хранить)
  micId?: string // выбранный микрофон (deviceId); пусто — системный по умолчанию
  mode?: string // режим ИИ-чистки: clean | email | message | note | id своего режима
  tone?: DictTone // тон для режимов, которые переписывают текст
  customModes?: CustomDictMode[] // свои режимы: название + что сделать с текстом
}

// Запись журнала диктовок (dictation-history.jsonl) — для списка «Последние диктовки».
export interface DictationEntry {
  at: string
  raw: string
  polished: string | null
  error?: string
  audio?: string // имя файла клипа в папке dictation (если ещё хранится)
  text?: string // что вставлено: после чистки, замен и сниппетов
  mode?: string // режим, которым чистили
}

export const defaultDictation: DictationSettings = {
  enabled: false,
  hotkey: 'F9',
  polish: false,
  autoPaste: true,
  sounds: true,
  tailMs: 300,
  pauseMedia: true,
  keepAudioDays: 7,
  micId: ''
}

export const defaultSettings: Settings = {
  theme: 'light',
  folders: [],
  aiEngine: 'local-llama',
  claudeModel: 'claude-sonnet-4-6',
  openrouterModel: 'anthropic/claude-sonnet-5',
  sttEngine: 'local',
  pauseMarkSec: 3,
  pauseInExport: true,
  callPrompt: true,
  callNames: ['Я', 'Собеседник']
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
  /** Пример из первого запуска: без звука, с готовыми результатами. */
  demo?: boolean
  /** Мои заметки к разговору (пишутся во время или после) — из них ИИ делает конспект. */
  myNotes?: string
  /** Краткая выжимка сессии для «Динамики клиента» и хэш текста, по которому она сделана. */
  brief?: { text: string; hash: string }
  /** Запись звонка: две дорожки (файлы в папке записи) — говорящие известны заранее. */
  channels?: { mic: string; sys: string; names: [string, string]; app?: string }
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
  /** Имена говорящих по порядку появления (вводятся до расшифровки). */
  names?: string[]
  /** «Дословно»: сохранять «э-э», «ну», запинки (надёжно — только локальный движок). */
  verbatim?: boolean
  /** Расшифровать только кусок записи, секунды от начала. */
  range?: { startSec: number; endSec: number }
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

// ---------- первый запуск и локальный движок ----------
export type SetupStage = 'engine' | 'extract' | 'model' | 'done' | 'error' | 'stopped'

export interface SetupProgress {
  stage: SetupStage
  modelId: string
  label: string
  done: number
  total: number
  bytesPerSec: number
  error?: string
}

export interface SetupInfo {
  dataDir: string
  engine: { installed: boolean; source: 'custom' | 'legacy' | 'default'; dir: string; modelsDir: string }
  installedModels: string[]
  localModel: string
  gpu: { name: string; vramMb: number } | null
  freeBytes: number | null
  pending: { modelId: string } | null
  progress: SetupProgress | null
}

export interface OllamaStatus {
  installed: boolean
  running: boolean
  models: string[]
}

export interface KeyVerdict {
  ok: boolean
  message: string
}

// ---------- «Спросить запись» ----------
export interface AskSource {
  n: number // номер в ответе: [1], [2]…
  slug: string
  title: string
  startSec: number
  snippet: string
}

export interface AskAnswer {
  answer: string
  sources: AskSource[]
  /** По словам вопроса ничего не нашлось — можно «Искать внимательно». */
  notFound?: boolean
}

export interface AskTurn {
  q: string
  a: string
}
