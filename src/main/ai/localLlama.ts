import type {
  AiProvider,
  CleanupOptions,
  CleanupResult,
  SummaryLevel,
  SummaryDomain
} from './provider'
import type { AnonRule } from '../../shared/anon'

// Локальный провайдер через Ollama (HTTP на 127.0.0.1:11434). Модель по
// умолчанию — Qwen2.5-7B. За ОДИН проход модель и причёсывает реплику
// (консервативно: паразиты/пунктуация, без пересказа), и помечает слова,
// которые считает ошибками распознавания / бессмыслицей в контексте — для
// гарантированной подсветки, даже если не стала их менять. Формат — строгий
// JSON (Ollama format:'json'), чтобы надёжно разобрать ответ.
const OLLAMA_URL = 'http://127.0.0.1:11434'
const MODEL = 'qwen2.5:7b-instruct'

export const DEFAULT_SYSTEM =
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

export const SUMMARY_BASE =
  'Ты помогаешь специалисту структурировать запись разговора. Опирайся ТОЛЬКО на текст, ' +
  'ничего не выдумывай. Пиши по-русски, нейтрально и профессионально, без обращений и воды.'

export const SUMMARY_DOMAIN: Record<SummaryDomain, string> = {
  therapy:
    ' Это психологическая консультация (реплики Психолога и Клиента); выделяй запрос/тему, ' +
    'состояние и динамику клиента, ключевые моменты и что дальше.',
  business:
    ' Это деловой разговор/переговоры; обязательно выдели договорённости и итог, конкретные ' +
    'задачи (что сделать) и открытые вопросы (что обдумать).',
  general: ' Это разговор; выдели суть, ключевые моменты и итог.'
}

export const SUMMARY_LEVEL: Record<SummaryLevel, string> = {
  note: ' Формат: ОЧЕНЬ КРАТКАЯ формальная заметка, 4–7 пунктов, сухо и по делу.',
  medium:
    ' Формат: краткое, но полное содержание — 2–4 абзаца пересказа, затем список ключевых тезисов.',
  detailed:
    ' Формат: подробное содержание — передай ход и смысл, убрав только лишнее, повторы и паразиты.'
}

export const HIGHLIGHTS_SYSTEM =
  'Выдели САМЫЕ ценные мысли/моменты разговора: сильные формулировки, ключевые выводы, ' +
  'поворотные и инсайтные фразы. Число НЕ ограничивай искусственно — столько, сколько ' +
  'действительно ценно (обычно от нескольких до ~15), но только по-настоящему важное, не ' +
  'проходное. Верни СТРОГО JSON {"highlights": string[]}: каждая цитата ДОСЛОВНО из текста ' +
  '(3–15 слов, точно как в тексте), без изменений, без повторов, без пояснений.'

export const ANON_SYSTEM =
  'Ты — фильтр приватности для расшифровки разговора. Найди в тексте ВСЁ, по чему можно ' +
  'опознать человека: имена и прозвища людей; географию (города, районы, улицы, заведения); ' +
  'организации и учреждения (ВУЗы, компании, школы); прочие явные идентификаторы (телефоны, ' +
  'адреса, точные даты рождения, уникальные приметы). Верни СТРОГО JSON {"rules": [{"find": ' +
  'string, "replace": string, "kind": "name"|"place"|"org"|"other"}]}.\n' +
  '- find: подстрока ТОЧНО как в тексте. Для каждого человека верни КАЖДУЮ встретившуюся форму ' +
  'ОТДЕЛЬНЫМ правилом (Ева, Евы, Еве, Еву, Евой) — все формы одного человека на ОДНУ и ту же замену.\n' +
  '- replace: нейтральная замена. Люди → «Клиент»/«Клиентка» (по полу); если людей несколько — ' +
  '«Клиент 2», «Коллега», «Имя» и т.п.; города/места → «город»/«место»; учебные заведения → «вуз»; ' +
  'организации → «организация».\n' +
  '- kind: name | place | org | other.\n' +
  'НЕ трогай обычные слова, общие понятия и профессии без привязки к конкретному человеку. ' +
  'Если опознаваемого нет — {"rules": []}.'

const ANON_KINDS = new Set(['name', 'place', 'org', 'other'])

export function parseAnon(raw: string): AnonRule[] {
  try {
    const o = JSON.parse(raw || '{}') as { rules?: unknown }
    if (!Array.isArray(o.rules)) return []
    const out: AnonRule[] = []
    for (const r of o.rules) {
      if (!r || typeof r !== 'object') continue
      const rec = r as Record<string, unknown>
      const find = typeof rec.find === 'string' ? rec.find.trim() : ''
      const replace = typeof rec.replace === 'string' ? rec.replace.trim() : ''
      if (!find || !replace) continue
      const kind = ANON_KINDS.has(rec.kind as string) ? (rec.kind as AnonRule['kind']) : 'other'
      out.push({ find, replace, kind })
    }
    return out
  } catch {
    return []
  }
}

export function parseHighlights(raw: string): string[] {
  try {
    const o = JSON.parse(raw || '{}') as { highlights?: unknown }
    return Array.isArray(o.highlights)
      ? o.highlights
          .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          .map((x) => x.trim())
      : []
  } catch {
    return []
  }
}

export function parseResult(raw: string, original: string): CleanupResult {
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

// Один system+user чат к Ollama (num_ctx под длинную расшифровку). Общий для
// summarize и generate (библиотека промтов).
async function ollamaChat(system: string, text: string): Promise<string> {
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
    return ollamaChat(SUMMARY_BASE + SUMMARY_DOMAIN[domain] + SUMMARY_LEVEL[level], text)
  },

  async generate(system: string, text: string): Promise<string> {
    return ollamaChat(system, text)
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
        options: { temperature: 0.2, num_ctx: 16384, num_predict: 2000 }
      })
    })
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`)
    const d = (await r.json()) as { message?: { content?: string } }
    return parseHighlights(d.message?.content || '{}')
  },

  async anonymize(text: string): Promise<AnonRule[]> {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: ANON_SYSTEM },
          { role: 'user', content: text }
        ],
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_ctx: 32768, num_predict: 2000 }
      })
    })
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`)
    const d = (await r.json()) as { message?: { content?: string } }
    return parseAnon(d.message?.content || '{}')
  }
}
