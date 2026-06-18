import type {
  AiProvider,
  CleanupOptions,
  CleanupResult,
  SummaryLevel,
  SummaryDomain
} from './provider'

// Локальный провайдер через Ollama (HTTP на 127.0.0.1:11434). Модель по
// умолчанию — Qwen2.5-7B. За ОДИН проход модель и причёсывает реплику
// (консервативно: паразиты/пунктуация, без пересказа), и помечает слова,
// которые считает ошибками распознавания / бессмыслицей в контексте — для
// гарантированной подсветки, даже если не стала их менять. Формат — строгий
// JSON (Ollama format:'json'), чтобы надёжно разобрать ответ.
const OLLAMA_URL = 'http://127.0.0.1:11434'
const MODEL = 'qwen2.5:7b-instruct'

const DEFAULT_SYSTEM =
  'Ты — редактор расшифровок устной речи. Тебе дают одну реплику из диалога, ' +
  'распознанную автоматически (возможны ошибки распознавания). Верни СТРОГО JSON ' +
  'вида {"cleaned": string, "suspect": string[]}.\n' +
  '"cleaned": причёсанный текст реплики — убери слова-паразиты (ну, вот, как бы, ' +
  'типа, э-э, значит), повторы и оговорки, расставь пунктуацию. СОХРАНИ манеру и ' +
  'слова говорящего: это его живая речь, только аккуратнее. НЕ перефразируй, не ' +
  'сокращай смысл, ничего не выдумывай; сомневаешься — оставь как есть.\n' +
  '"suspect": список слов или коротких фраз ИЗ ТЕКСТА (дословно), которые НЕ ' +
  'существуют в русском языке ИЛИ бессмысленны в этом контексте — вероятные ошибки ' +
  'распознавания (например «коблит», «водопряжение»). Если таких нет — пустой список. ' +
  'Не вписывай в suspect нормальные слова.'

const SUMMARY_BASE =
  'Ты помогаешь специалисту структурировать запись разговора. Опирайся ТОЛЬКО на текст, ' +
  'ничего не выдумывай. Пиши по-русски, нейтрально и профессионально, без обращений и воды.'

const SUMMARY_DOMAIN: Record<SummaryDomain, string> = {
  therapy:
    ' Это психологическая консультация (реплики Психолога и Клиента); выделяй запрос/тему, ' +
    'состояние и динамику клиента, ключевые моменты и что дальше.',
  business:
    ' Это деловой разговор/переговоры; обязательно выдели договорённости и итог, конкретные ' +
    'задачи (что сделать) и открытые вопросы (что обдумать).',
  general: ' Это разговор; выдели суть, ключевые моменты и итог.'
}

const SUMMARY_LEVEL: Record<SummaryLevel, string> = {
  note: ' Формат: ОЧЕНЬ КРАТКАЯ формальная заметка, 4–7 пунктов, сухо и по делу.',
  medium:
    ' Формат: краткое, но полное содержание — 2–4 абзаца пересказа, затем список ключевых тезисов.',
  detailed:
    ' Формат: подробное содержание — передай ход и смысл, убрав только лишнее, повторы и паразиты.'
}

const HIGHLIGHTS_SYSTEM =
  'Найди НЕ БОЛЕЕ 6 самых ценных мыслей/моментов разговора (сильные формулировки, ключевые ' +
  'выводы, поворотные фразы). Верни СТРОГО JSON {"highlights": string[]}. Каждая цитата — ' +
  'ДОСЛОВНО из текста, 3–12 слов, без изменений и без пояснений. Не повторяйся. Опирайся ' +
  'только на текст; если ценного мало — верни меньше.'

function parseResult(raw: string, original: string): CleanupResult {
  try {
    const o = JSON.parse(raw) as { cleaned?: unknown; suspect?: unknown }
    const cleaned =
      typeof o.cleaned === 'string' && o.cleaned.trim() ? o.cleaned.trim() : original
    const suspect = Array.isArray(o.suspect)
      ? o.suspect.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
      : []
    return { cleaned, suspect }
  } catch {
    // Ответ не JSON — трактуем как причёсанный текст, без подозрительных слов.
    return { cleaned: raw || original, suspect: [] }
  }
}

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

  async cleanupTurn(text: string, opts: CleanupOptions): Promise<CleanupResult> {
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
        format: 'json',
        options: { temperature: 0.2 }
      })
    })
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`)
    const d = (await r.json()) as { message?: { content?: string } }
    return parseResult((d.message?.content || '').trim(), text)
  },

  async summarize(text: string, level: SummaryLevel, domain: SummaryDomain): Promise<string> {
    const system = SUMMARY_BASE + SUMMARY_DOMAIN[domain] + SUMMARY_LEVEL[level]
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: text }
        ],
        stream: false,
        options: { temperature: 0.3, num_ctx: 16384 }
      })
    })
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`)
    const d = (await r.json()) as { message?: { content?: string } }
    return (d.message?.content || '').trim()
  },

  async highlights(text: string): Promise<string[]> {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: HIGHLIGHTS_SYSTEM },
          { role: 'user', content: text }
        ],
        stream: false,
        format: 'json',
        options: { temperature: 0.2, num_ctx: 16384, num_predict: 800 }
      })
    })
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`)
    const d = (await r.json()) as { message?: { content?: string } }
    try {
      const o = JSON.parse(d.message?.content || '{}') as { highlights?: unknown }
      return Array.isArray(o.highlights)
        ? o.highlights
            .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
            .map((x) => x.trim())
        : []
    } catch {
      return []
    }
  }
}
