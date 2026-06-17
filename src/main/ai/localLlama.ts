import type { AiProvider, CleanupOptions } from './provider'

// Локальный провайдер через Ollama (HTTP на 127.0.0.1:11434). Движок и модель
// живут на F (см. [[slovo-app]] memory). Модель по умолчанию — Qwen2.5-7B
// (база; бережная чистка). Делаем КОНСЕРВАТИВНУЮ редактуру: убрать паразиты,
// расставить пунктуацию, СОХРАНИТЬ слова и стиль; не перефразировать.
const OLLAMA_URL = 'http://127.0.0.1:11434'
const MODEL = 'qwen2.5:7b-instruct'

const DEFAULT_SYSTEM =
  'Ты — редактор расшифровок устной речи. Тебе дают одну реплику из диалога, ' +
  'распознанную автоматически. Приведи её к чистому читаемому виду: убери ' +
  'слова-паразиты (ну, вот, как бы, типа, э-э, значит), повторы и оговорки, ' +
  'расставь знаки препинания. ВАЖНО: сохрани манеру и слова говорящего — это ' +
  'по-прежнему его живая речь, только аккуратнее. НЕ перефразируй, не сокращай ' +
  'смысл и не добавляй ничего от себя; если сомневаешься — оставь как есть. ' +
  'Верни ТОЛЬКО причёсанный текст реплики, без пояснений и без кавычек.'

export const localLlamaProvider: AiProvider = {
  id: 'local-llama',
  name: 'Локально (Ollama)',
  isLocal: true,

  async isAvailable(): Promise<boolean> {
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`)
      if (!r.ok) return false
      const d = (await r.json()) as { models?: { name: string }[] }
      return !!d.models?.some((m) => m.name === MODEL)
    } catch {
      return false
    }
  },

  async cleanupTurn(text: string, opts: CleanupOptions): Promise<string> {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: opts.systemPrompt || DEFAULT_SYSTEM },
          { role: 'user', content: text }
        ],
        stream: false,
        options: { temperature: 0.3 }
      })
    })
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`)
    const d = (await r.json()) as { message?: { content?: string } }
    return (d.message?.content || '').trim()
  }
}
