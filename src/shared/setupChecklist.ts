import type { Settings } from './types'

// Чек-лист «Настройка» на Главной: пункты считаются по настройкам и данным,
// а не по ручным галочкам. Чистая функция — её проверяют тесты.

export type ChecklistId = 'stt' | 'dictation' | 'record' | 'ai' | 'vocab'

export interface ChecklistFacts {
  settings: Pick<Settings, 'sttKeys' | 'anthropicKey' | 'openrouterKey' | 'vocab'> & Partial<Pick<Settings, 'sttEngine'>>
  /** Установлен локальный движок расшифровки. */
  localSttInstalled: boolean
  /** Установлен локальный ИИ (Ollama с хотя бы одной моделью). */
  localAiInstalled: boolean
  /** Удачных диктовок за всё время. */
  dictations: number
  /** Записей, кроме примера. */
  ownRecords: number
}

export interface ChecklistItem {
  id: ChecklistId
  label: string
  done: boolean
}

export const MIN_VOCAB_WORDS = 3

const hasKey = (v: string | undefined): boolean => !!v && v.trim().length > 0

export function buildChecklist(f: ChecklistFacts): ChecklistItem[] {
  const s = f.settings
  // По выбранному движку, а не по любому сохранённому ключу: иначе чек-лист
  // говорит «готово», а статус движка — «нужен ключ» (ревью шага 7).
  const keys = (s.sttKeys ?? {}) as Record<string, string | undefined>
  const sttDone = !s.sttEngine
    ? Object.values(keys).some(hasKey) || f.localSttInstalled
    : s.sttEngine === 'local'
      ? f.localSttInstalled
      : hasKey(keys[s.sttEngine])
  return [
    { id: 'stt', label: 'Подключить распознавание', done: sttDone },
    { id: 'dictation', label: 'Попробовать диктовку', done: f.dictations > 0 },
    { id: 'record', label: 'Добавить свою запись', done: f.ownRecords > 0 },
    { id: 'ai', label: 'Подключить ИИ', done: hasKey(s.anthropicKey) || hasKey(s.openrouterKey) || f.localAiInstalled },
    { id: 'vocab', label: 'Добавить слова в словарь', done: (s.vocab?.words?.length ?? 0) >= MIN_VOCAB_WORDS }
  ]
}

export const doneCount = (items: ChecklistItem[]): number => items.filter((i) => i.done).length
