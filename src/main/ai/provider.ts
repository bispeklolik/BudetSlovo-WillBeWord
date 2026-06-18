// Провайдер-агностичная точка расширения ИИ-слоя: локально (llama.cpp/Ollama)
// сейчас, облако (Claude) — позже, выбор за пользователем. Сырой diff и наложение
// правок делает вызывающий код (diff.ts / apply.ts); провайдер лишь возвращает
// причёсанный текст реплики.
//
// Примечание по спайку (2026-06-16): пометка неуверенных слов «(?)» сбивала
// модель (уверенность Whisper ≠ смысловая верность), поэтому в контракт она не
// входит — делаем КОНСЕРВАТИВНУЮ чистку, а правки ИИ всегда подсвечены и
// откатываемы.

export interface CleanupOptions {
  /** Свой системный промт пользователя; если не задан — используется дефолтный. */
  systemPrompt?: string
}

// Уровни краткого содержания: формальная заметка → средняя с тезисами →
// подробное содержание (выкинуто только лишнее).
export type SummaryLevel = 'note' | 'medium' | 'detailed'

// Тип записи — задаёт рамку выжимки (что выделять).
export type SummaryDomain = 'therapy' | 'business' | 'general'

export interface CleanupResult {
  /** Причёсанный текст реплики. */
  cleaned: string
  /**
   * Слова/короткие фразы (дословно из текста), которые модель считает вероятными
   * ошибками распознавания или бессмыслицей в контексте — для гарантированной
   * подсветки, даже если ИИ не стал их менять.
   */
  suspect: string[]
}

export interface AiProvider {
  id: 'local-llama' | 'claude'
  /** Человекочитаемое имя для UI (напр. «Локально» / «Claude (облако)»). */
  name: string
  /** true — обработка на устройстве (для пометки приватности в UI). */
  isLocal: boolean
  /** Готов ли провайдер: модель скачана / сервер жив / ключ задан. */
  isAvailable(): Promise<boolean>
  /** Причёсывает реплику и помечает подозрительные слова (смысловой анализ). */
  cleanupTurn(text: string, opts: CleanupOptions): Promise<CleanupResult>
  /** Краткое содержание всей расшифровки на выбранном уровне детализации и под тип записи. */
  summarize(text: string, level: SummaryLevel, domain: SummaryDomain): Promise<string>
  /** Самые ценные мысли/моменты — дословные цитаты из текста (для подсветки). */
  highlights(text: string): Promise<string[]>
}

const providers = new Map<string, AiProvider>()

export function registerProvider(p: AiProvider): void {
  providers.set(p.id, p)
}

export function getProvider(id: string): AiProvider | undefined {
  return providers.get(id)
}

export function listProviders(): AiProvider[] {
  return [...providers.values()]
}
