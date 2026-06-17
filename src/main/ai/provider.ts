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

export interface AiProvider {
  id: 'local-llama' | 'claude'
  /** Человекочитаемое имя для UI (напр. «Локально» / «Claude (облако)»). */
  name: string
  /** true — обработка на устройстве (для пометки приватности в UI). */
  isLocal: boolean
  /** Готов ли провайдер: модель скачана / сервер жив / ключ задан. */
  isAvailable(): Promise<boolean>
  /** Возвращает причёсанный текст одной реплики. */
  cleanupTurn(text: string, opts: CleanupOptions): Promise<string>
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
