import type { AiEngine, AiTask, Settings } from './types'

// Какой ИИ делает какую задачу. Общий выбор — settings.aiEngine; для отдельной
// задачи можно выбрать свой в settings.aiTasks. Нет значения — «Как везде».

export const AI_TASKS: { id: AiTask; label: string; hint: string }[] = [
  { id: 'dictation', label: 'Диктовка', hint: 'чистка текста по клавише диктовки и правка голосом' },
  { id: 'cleanup', label: 'Причёсывание текста записи', hint: 'убрать паразиты и опечатки в готовой расшифровке' },
  { id: 'notes', label: 'Конспекты и «Сделать из текста»', hint: 'итоги, библиотека промтов, «Что я пропустил?», динамика клиента' },
  { id: 'ask', label: 'Вопросы к записям', hint: '«Спросить» по одной записи и по всем' },
  { id: 'highlights', label: 'Лучшие мысли', hint: 'выделение важных мест в записи' },
  { id: 'variants', label: 'Варианты для неуверенного слова', hint: 'подсказки, как могло звучать слово' }
]

export const AI_ENGINE_LABELS: Record<AiEngine, string> = {
  claude: 'Claude (облако)',
  openrouter: 'OpenRouter (облако)',
  'local-llama': 'На компьютере'
}

const isEngine = (x: unknown): x is AiEngine => x === 'claude' || x === 'openrouter' || x === 'local-llama'

/** Общий движок: то, что выбрано «на всё»; в старых настройках — локальный. */
export function commonAiEngine(settings: Pick<Settings, 'aiEngine'>): AiEngine {
  return settings.aiEngine ?? 'local-llama'
}

/** Движок для задачи: свой выбор, а если его нет (или он неизвестный) — общий. */
export function resolveAiEngine(settings: Pick<Settings, 'aiEngine' | 'aiTasks'>, task: AiTask): AiEngine {
  const own = settings.aiTasks?.[task]
  return isEngine(own) ? own : commonAiEngine(settings)
}

/** Подпись движка для кнопок вроде «Будет сделано: …». */
export function aiEngineLabel(
  settings: Pick<Settings, 'aiEngine' | 'aiTasks' | 'claudeModel' | 'openrouterModel'>,
  task: AiTask
): string {
  const e = resolveAiEngine(settings, task)
  if (e === 'claude') return 'Claude (облако)'
  if (e === 'openrouter') return `OpenRouter (${settings.openrouterModel ?? 'облако'})`
  return 'Локально'
}
