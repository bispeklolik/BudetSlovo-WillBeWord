import Anthropic from '@anthropic-ai/sdk'
import type {
  AiProvider,
  CleanupOptions,
  CleanupResult,
  SummaryLevel,
  SummaryDomain
} from './provider'
import type { AnonRule } from '../../shared/types'
import { AI_SYSTEM, AI_SCHEMA, aiItemsText, parseAiReply, type AiItem, type AiRawItem } from '../../shared/wordVariantsAi'
import { DEFAULT_CLAUDE_MODEL, FAST_CLAUDE_MODEL, currentClaudeModel } from '../../shared/claudeModels'
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

// Облачный провайдер Claude (Anthropic API, официальная библиотека). Ключ задаёт
// пользователь в настройках, хранится локально; обработка идёт на серверах Anthropic.
//
// Две «скорости» (решение 09.11.2026, волна 7):
//  - быстрая — Claude Haiku 5.5 с effort low: чистка диктовки и правка голосом,
//    где важна задержка (на простом тексте модель почти не думает);
//  - умная — модель из настроек (Sonnet 5.5 по умолчанию, Opus 5.5 — «максимум»)
//    с effort high: итоги, карточки, вопросы к записям, обезличивание.
// У новых моделей мышление считается в max_tokens — поэтому лимиты с запасом,
// а длинные ответы идут потоком (без таймаутов HTTP).

let client: Anthropic | null = null
let model = DEFAULT_CLAUDE_MODEL

export function setClaudeConfig(key: string | undefined, mdl: string | undefined): void {
  const apiKey = (key ?? '').trim()
  client = apiKey ? new Anthropic({ apiKey, timeout: 300_000, maxRetries: 2 }) : null
  model = currentClaudeModel(mdl)
}

// Claude иногда оборачивает JSON в ```-блок — достаём содержимое.
function jsonText(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (m ? m[1] : s).trim()
}

type Tier = 'fast' | 'smart'

// Серверный запасной ход при отказе модели есть у Sonnet 5.5 и Opus 5.5 (у Haiku нет).
const supportsFallback = (m: string): boolean => /^claude-(sonnet|opus)-5-5$/.test(m)

function textOf(content: { type: string }[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

function finish(stop: string | null | undefined, text: string): string {
  // Отказ модели — не ошибка сети: говорим об этом прямо, текст не подменяем.
  if (stop === 'refusal') throw new Error('AI_REFUSED')
  if (stop === 'max_tokens') return text + '\n\n…[ответ обрезан по лимиту — попробуйте ещё раз]'
  return text
}

async function ask(system: string, user: string, maxTokens: number, tier: Tier = 'smart'): Promise<string> {
  if (!client) throw new Error('AI_MODEL_MISSING')
  try {
    if (tier === 'fast') {
      const r = await client.messages.create({
        model: FAST_CLAUDE_MODEL,
        max_tokens: maxTokens,
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: user }]
      })
      return finish(r.stop_reason, textOf(r.content))
    }
    const base = {
      model,
      max_tokens: maxTokens,
      output_config: { effort: 'high' as const },
      system,
      messages: [{ role: 'user' as const, content: user }]
    }
    if (supportsFallback(model)) {
      const r = await client.beta.messages
        .stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        .finalMessage()
      return finish(r.stop_reason, textOf(r.content))
    }
    const r = await client.messages.stream(base).finalMessage()
    return finish(r.stop_reason, textOf(r.content))
  } catch (err) {
    throw mapError(err)
  }
}

function mapError(err: unknown): unknown {
  if (err instanceof Anthropic.AuthenticationError) return new Error('AI_KEY_INVALID')
  // Тексты, которые узнаёт humanError (toast.ts): «не ответил вовремя» и т.п.
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new Error('TimeoutError: Claude не ответил вовремя')
  if (err instanceof Anthropic.APIConnectionError) return new Error('Нет связи с Claude — проверьте интернет.')
  if (err instanceof Anthropic.APIError) return new Error(`Claude: ${err.message.slice(0, 300)}`)
  return err
}

// Расход токенов быстрых запросов вариантов слова (для замеров цены: живой прогон, scripts/).
type Usage = { input: number; output: number }
let usageSink: ((u: Usage) => void) | null = null
export function onWordVariantsUsage(cb: ((u: Usage) => void) | null): void {
  usageSink = cb
}

export const claudeProvider: AiProvider = {
  id: 'claude',
  name: 'Claude (облако)',
  isLocal: false,

  async isAvailable(): Promise<boolean> {
    return !!client
  },

  async cleanupTurn(text: string, opts: CleanupOptions): Promise<CleanupResult> {
    const raw = await ask(opts.systemPrompt || DEFAULT_SYSTEM, text, 4096, 'fast')
    return parseResult(jsonText(raw), text)
  },

  async summarize(text: string, level: SummaryLevel, domain: SummaryDomain): Promise<string> {
    return ask(SUMMARY_BASE + SUMMARY_DOMAIN[domain] + SUMMARY_LEVEL[level], text, 32000)
  },

  async generate(system: string, text: string): Promise<string> {
    return ask(system, text, 32000)
  },

  async generateFast(system: string, text: string): Promise<string> {
    return ask(system, text, 4096, 'fast')
  },

  // Варианты неуверенных слов: быстрая модель, строгий JSON по схеме (maxItems схема не
  // поддерживает — число вариантов обрезает код). Таймаут короткий: человек ждёт у окошка.
  async wordVariants(items: AiItem[], opts?: { timeoutMs?: number }): Promise<AiRawItem[]> {
    if (!client) throw new Error('AI_MODEL_MISSING')
    if (!items.length) return []
    try {
      const r = await client.messages.create(
        {
          model: FAST_CLAUDE_MODEL,
          max_tokens: 400 + items.length * 260,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: AI_SCHEMA as unknown as Record<string, unknown> } },
          system: AI_SYSTEM,
          messages: [{ role: 'user', content: aiItemsText(items) }]
        },
        { timeout: opts?.timeoutMs ?? 8000, maxRetries: 0 }
      )
      usageSink?.({ input: r.usage.input_tokens, output: r.usage.output_tokens })
      if (r.stop_reason === 'refusal') throw new Error('AI_REFUSED')
      return parseAiReply(textOf(r.content))
    } catch (err) {
      throw mapError(err)
    }
  },

  async highlights(text: string): Promise<string[]> {
    return parseHighlights(jsonText(await ask(HIGHLIGHTS_SYSTEM, text, 16000)))
  },

  async anonymize(text: string): Promise<AnonRule[]> {
    return parseAnon(jsonText(await ask(ANON_SYSTEM, text, 16000)))
  }
}
