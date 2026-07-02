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

// Облачный провайдер Claude (Anthropic API). Ключ задаёт пользователь в
// настройках, хранится локально; обработка идёт на серверах Anthropic — только
// для своего контента или ПОСЛЕ локального обезличивания.
let apiKey = ''
let model = 'claude-sonnet-4-6'

export function setClaudeConfig(key: string | undefined, mdl: string | undefined): void {
  apiKey = (key ?? '').trim()
  if (mdl) model = mdl
}

// Claude иногда оборачивает JSON в ```-блок — достаём содержимое.
function jsonText(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (m ? m[1] : s).trim()
}

async function ask(system: string, user: string, maxTokens: number): Promise<string> {
  if (!apiKey) throw new Error('AI_MODEL_MISSING')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    })
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    if (r.status === 401) throw new Error('AI_KEY_INVALID')
    throw new Error(`Claude HTTP ${r.status} ${t.slice(0, 200)}`)
  }
  const d = (await r.json()) as { content?: { type: string; text?: string }[] }
  return (d.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim()
}

export const claudeProvider: AiProvider = {
  id: 'claude',
  name: 'Claude (облако)',
  isLocal: false,

  async isAvailable(): Promise<boolean> {
    return !!apiKey
  },

  async cleanupTurn(text: string, opts: CleanupOptions): Promise<CleanupResult> {
    const raw = await ask(opts.systemPrompt || DEFAULT_SYSTEM, text, 1024)
    return parseResult(jsonText(raw), text)
  },

  async summarize(text: string, level: SummaryLevel, domain: SummaryDomain): Promise<string> {
    return ask(SUMMARY_BASE + SUMMARY_DOMAIN[domain] + SUMMARY_LEVEL[level], text, 2000)
  },

  async generate(system: string, text: string): Promise<string> {
    return ask(system, text, 4000)
  },

  async highlights(text: string): Promise<string[]> {
    return parseHighlights(jsonText(await ask(HIGHLIGHTS_SYSTEM, text, 2000)))
  },

  async anonymize(text: string): Promise<AnonRule[]> {
    return parseAnon(jsonText(await ask(ANON_SYSTEM, text, 2000)))
  }
}
