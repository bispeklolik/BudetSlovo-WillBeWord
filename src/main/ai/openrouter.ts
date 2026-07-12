import type {
  AiProvider,
  CleanupOptions,
  CleanupResult,
  SummaryLevel,
  SummaryDomain
} from './provider'
import type { AnonRule } from '../../shared/types'
// Промты и парсеры общие с локальным провайдером — единый «контракт» задач.
import {
  DEFAULT_SYSTEM,
  SUMMARY_BASE,
  SUMMARY_DOMAIN,
  SUMMARY_LEVEL,
  HIGHLIGHTS_SYSTEM,
  ANON_SYSTEM,
  parseResult,
  parseAnon,
  parseHighlights
} from './localLlama'

// OpenRouter: один ключ — сотни моделей (Claude/Gemini/DeepSeek/…) через
// OpenAI-совместимый chat completions. Ключ задаёт пользователь в настройках,
// хранится локально. Только текстовые задачи (STT у OpenRouter нет).
let apiKey = ''
let model = 'anthropic/claude-sonnet-5'

export function setOpenrouterConfig(key: string | undefined, mdl: string | undefined): void {
  apiKey = (key ?? '').trim()
  if (mdl && mdl.trim()) model = mdl.trim()
}

// Модели любят оборачивать JSON в ```-блок — достаём содержимое.
function jsonText(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (m ? m[1] : s).trim()
}

async function ask(system: string, user: string, maxTokens: number): Promise<string> {
  if (!apiKey) throw new Error('AI_MODEL_MISSING')
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }),
    signal: AbortSignal.timeout(300_000)
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    if (r.status === 401) throw new Error('AI_KEY_INVALID')
    if (r.status === 404) throw new Error(`OpenRouter: модель «${model}» не найдена`)
    throw new Error(`OpenRouter HTTP ${r.status} ${t.slice(0, 200)}`)
  }
  const d = (await r.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
  }
  const c = d.choices?.[0]
  let out = (c?.message?.content ?? '').trim()
  if (c?.finish_reason === 'length') out += '\n\n…[ответ обрезан по лимиту — попробуйте ещё раз или другую модель]'
  return out
}

export const openrouterProvider: AiProvider = {
  id: 'openrouter',
  name: 'OpenRouter (облако)',
  isLocal: false,

  async isAvailable(): Promise<boolean> {
    return !!apiKey
  },

  async cleanupTurn(text: string, opts: CleanupOptions): Promise<CleanupResult> {
    const raw = await ask(opts.systemPrompt || DEFAULT_SYSTEM, text, 2048)
    return parseResult(jsonText(raw), text)
  },

  async summarize(text: string, level: SummaryLevel, domain: SummaryDomain): Promise<string> {
    return ask(SUMMARY_BASE + SUMMARY_DOMAIN[domain] + SUMMARY_LEVEL[level], text, 8000)
  },

  async generate(system: string, text: string): Promise<string> {
    return ask(system, text, 8000)
  },

  async highlights(text: string): Promise<string[]> {
    return parseHighlights(jsonText(await ask(HIGHLIGHTS_SYSTEM, text, 4000)))
  },

  async anonymize(text: string): Promise<AnonRule[]> {
    return parseAnon(jsonText(await ask(ANON_SYSTEM, text, 4000)))
  }
}
