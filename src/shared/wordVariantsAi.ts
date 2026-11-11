// Слой ИИ для вариантов неуверенного слова (волна 7): запрос, схема ответа, разбор,
// защита от выдумок и сбор фрагмента фразы (с обезличиванием для облака).
// Чистые функции: сеть и ключи — в main/ai.

import type { Turn } from './types'
import { phoneticKey } from './phonetic'
import { editDistance } from './learn'
import { coreOf, normCore, isNear, type Variant, MAX_VARIANTS } from './wordVariants'

/** Сколько слов фразы слева и справа от слова видит ИИ. */
export const CONTEXT_WORDS = 12

/** Одно слово в запросе к ИИ. */
export interface AiItem {
  id: number
  left: string
  word: string
  right: string
  /** Уверенность движка, проценты (если известна). */
  conf?: number
  /** Слова словаря пользователя, близкие по звучанию. */
  dict: string[]
  /** Варианты слоя «по звучанию» — подсказки. */
  hints: string[]
}

/** Сырой ответ ИИ про одно слово. */
export interface AiRawItem {
  id: number
  ok: boolean
  variants: { text: string; basis?: string }[]
}

export const AI_SYSTEM = [
  'Ты помогаешь править ошибки распознавания русской речи.',
  'Тебе дают слова, в которых движок не уверен. Каждое стоит во фразе в рамке ⟦ ⟧.',
  'Для каждого слова в рамке предложи до 5 русских слов, которые ЗВУЧАТ похоже на него и подходят по смыслу и грамматике фразы.',
  'Правила:',
  '1. Меняй только слово в рамке. Другие слова фразы не трогай.',
  '2. Вариант — одно русское слово, которое звучит похоже на слово в рамке. Слово, которое подходит по смыслу, но звучит иначе, не предлагай.',
  '3. Ничего не выдумывай. Не предлагай несуществующих слов.',
  '4. Сначала реши: слово в рамке есть в русском языке и подходит по смыслу и грамматике фразы? Если да, верни ok: true и пустой список вариантов, даже если движок не уверен. Варианты предлагай, только если слово в рамке не существует или не подходит фразе.',
  '5. Нет хороших вариантов — верни пустой список.',
  '6. Лучший вариант ставь первым.',
  'Строка «словарь» — слова пользователя; если одно из них подходит по звучанию, проверь его первым.',
  'Строка «по звучанию» — подсказки: бери оттуда или предложи своё.',
  'В поле basis пиши sound, если вариант выбран по звучанию, или context, если решил смысл фразы.',
  'Верни JSON по схеме. В поле id повтори номер слова.'
].join('\n')

export const AI_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          ok: { type: 'boolean' },
          variants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                basis: { type: 'string', enum: ['sound', 'context'] }
              },
              required: ['text', 'basis'],
              additionalProperties: false
            }
          }
        },
        required: ['id', 'ok', 'variants'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
} as const

/** Запрос: по строке-блоку на слово. */
export function aiItemsText(items: AiItem[]): string {
  return items
    .map((it) => {
      const lines = [`#${it.id}: ${it.left ? it.left + ' ' : ''}⟦${it.word}⟧${it.right ? ' ' + it.right : ''}`]
      if (it.conf !== undefined) lines.push(`уверенность движка: ${it.conf}%`)
      if (it.dict.length) lines.push(`словарь: ${it.dict.join(', ')}`)
      if (it.hints.length) lines.push(`по звучанию: ${it.hints.join(', ')}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** Достаёт JSON из ответа (модели иногда оборачивают его в ```-блок) и приводит к виду AiRawItem[]. */
export function parseAiReply(raw: string): AiRawItem[] {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  let data: unknown
  try {
    data = JSON.parse((m ? m[1] : raw).trim())
  } catch {
    return []
  }
  const arr = Array.isArray(data) ? data : (data as { items?: unknown } | null)?.items
  if (!Array.isArray(arr)) return []
  const out: AiRawItem[] = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const o = it as { id?: unknown; ok?: unknown; variants?: unknown }
    const id = Number(o.id)
    if (!Number.isFinite(id)) continue
    const variants: AiRawItem['variants'] = []
    if (Array.isArray(o.variants)) {
      for (const v of o.variants) {
        if (typeof v === 'string') variants.push({ text: v })
        else if (v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string')
          variants.push({ text: (v as { text: string }).text, basis: (v as { basis?: string }).basis })
      }
    }
    out.push({ id, ok: o.ok === true, variants })
  }
  return out
}

// ---------------------------------------------------------------- защита от выдумок

/** Насколько ключ варианта может отличаться от ключа слова: 40 % длины, минимум 1. */
export function keyLimit(keyLen: number): number {
  return Math.max(1, Math.round(keyLen * 0.4))
}

/**
 * Оставляет варианты ИИ, которые годятся: одно русское слово, не то же самое слово,
 * не повтор и звучит похоже (расстояние между звуковыми ключами в пределах keyLimit).
 * Слова из словаря пользователя не выбрасываем. Результат — не больше MAX_VARIANTS.
 */
export function filterAiVariants(token: string, raw: { text: string; basis?: string }[], vocabWords: string[] = []): Variant[] {
  const word = normCore(token)
  const key = phoneticKey(word)
  const vocab = new Set(vocabWords.map((w) => w.trim().toLowerCase()))
  const seen = new Set<string>([word])
  const out: Variant[] = []
  for (const r of raw) {
    const text = coreOf(String(r.text ?? '').trim())
    if (!text || /\s/.test(text) || !/^[а-яёА-ЯЁ]+(?:-[а-яёА-ЯЁ]+)*$/.test(text)) continue
    const n = text.toLowerCase()
    if (seen.has(n)) continue
    const fromVocab = vocab.has(n)
    if (!fromVocab && key) {
      const k = phoneticKey(n)
      if (!k) continue
      const lim = keyLimit(key.length)
      if (Math.abs(k.length - key.length) > lim || editDistance(k, key, lim) > lim) continue
    }
    seen.add(n)
    out.push({ text, basis: 'meaning' })
    if (out.length >= MAX_VARIANTS) break
  }
  return out
}

/** Слова словаря, близкие к слову по звучанию (до limit штук) — подсказка для ИИ. */
export function closeDict(token: string, words: string[] | undefined, limit = 20): string[] {
  const word = normCore(token)
  if (!word) return []
  const out: string[] = []
  for (const w of words ?? []) {
    const t = w.trim()
    if (!t || /\s/.test(t)) continue
    if (isNear(t.toLowerCase(), word)) out.push(t)
    if (out.length >= limit) break
  }
  return out
}

// ---------------------------------------------------------------- фрагмент фразы

export interface Fragment {
  left: string
  word: string
  right: string
}

/**
 * Фраза вокруг слова: по CONTEXT_WORDS слов с каждой стороны в пределах реплики.
 * overlay — обезличивание (id слова → замена, '' = скрыть): для облака слова
 * фрагмента подменяются. Если само слово закрыто обезличиванием — null (не спрашиваем).
 */
export function buildFragment(turn: Turn, wordId: number, overlay?: Map<number, string>, n = CONTEXT_WORDS): Fragment | null {
  const idx = turn.words.findIndex((w) => w.id === wordId)
  if (idx < 0) return null
  if (overlay?.has(wordId)) return null
  const text = (i: number): string => {
    const w = turn.words[i]
    const ov = overlay?.get(w.id)
    return (ov !== undefined ? ov : w.t).trim()
  }
  const pick = (from: number, to: number): string => {
    const parts: string[] = []
    for (let i = from; i < to; i++) {
      const s = text(i)
      if (s) parts.push(s)
    }
    return parts.join(' ')
  }
  return {
    left: pick(Math.max(0, idx - n), idx),
    word: coreOf(turn.words[idx].t),
    right: pick(idx + 1, Math.min(turn.words.length, idx + 1 + n))
  }
}
