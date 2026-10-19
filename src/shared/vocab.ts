// Словарь пользователя (волна 5): слова, которые движок должен знать (имена,
// термины), точные замены после распознавания и сниппеты — «скажи фразу —
// вставится готовый текст». Чистые функции — под тестами.

export interface Replacement {
  from: string
  to: string
}

export interface Snippet {
  trigger: string
  text: string
}

export interface Vocab {
  /** Слова и фразы, которые движок распознавания должен знать. */
  words: string[]
  replacements: Replacement[]
  snippets: Snippet[]
}

export const emptyVocab: Vocab = { words: [], replacements: [], snippets: [] }

/** Слова словаря без пустых и повторов; не больше 100 (лимит облачных подсказок). */
export function cleanWords(words: string[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words ?? []) {
    const t = w.replace(/\s+/g, ' ').trim()
    if (!t || t.length > 60 || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out.slice(0, 100)
}

/**
 * Затравка для Whisper (локальный и OpenAI/Groq): модель подражает затравке,
 * поэтому слова из неё пишет так же. Затравка у Whisper ограничена ~224
 * токенами — держим её короткой.
 */
export function glossaryPrompt(words: string[] | undefined, maxChars = 500): string {
  const list = cleanWords(words)
  if (!list.length) return ''
  let out = ''
  for (const w of list) {
    const next = out ? out + ', ' + w : w
    if (next.length > maxChars) break
    out = next
  }
  return out ? `Глоссарий: ${out}.` : ''
}

/** Затравка целиком: «дословно» (с «э-э») + глоссарий — что из этого включено. */
export function sttPrompt(verbatimPrompt: string | null, words: string[] | undefined): string {
  return [verbatimPrompt ?? '', glossaryPrompt(words)].filter(Boolean).join(' ')
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Фраза → регулярка: слова через любые пробелы/знаки, границы — не буквы и не цифры. */
function phraseRe(phrase: string): RegExp | null {
  const words = phrase.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.map(esc).join('[\\s,.!?;:—–-]+')}(?![\\p{L}\\p{N}])`, 'giu')
}

/**
 * Точные замены: «кэпэтэ» → «КПТ». Регистр при поиске не важен; заменяем ровно
 * на то, что написал человек. Если найденное начинало предложение с большой
 * буквы, а замена с маленькой — поднимаем первую букву.
 */
export function applyReplacements(text: string, reps: Replacement[] | undefined): string {
  let out = text
  const list = [...(reps ?? [])].filter((r) => r.from.trim()).sort((a, b) => b.from.length - a.from.length)
  for (const r of list) {
    const re = phraseRe(r.from)
    if (!re) continue
    if (!r.to.trim()) {
      // Пустая замена = удалить слово вместе с запятой и пробелом после него.
      out = out.replace(new RegExp(re.source + '(?:\\s*[,;:])?[ \\t]*', re.flags), '')
      continue
    }
    out = out.replace(re, (m, ...rest) => {
      const offset = rest[rest.length - 2] as number
      const whole = rest[rest.length - 1] as string
      const to = r.to
      // Заглавную ставим, только если найденное начинало предложение (ревью волны 5:
      // «Иван» → «клиент» посреди фразы не должно становиться «Клиент»).
      const sentenceStart = /^\s*$|[.!?…]\s+$|\n\s*$/.test(whole.slice(0, offset))
      const first = m.charAt(0)
      return sentenceStart && first !== first.toLowerCase() && to.charAt(0) === to.charAt(0).toLowerCase()
        ? to.charAt(0).toUpperCase() + to.slice(1)
        : to
    })
  }
  // После удалений: двойные пробелы и запятая в начале строки.
  return out.replace(/[ \t]{2,}/g, ' ').replace(/(^|\n)[ \t]*[,;:][ \t]*/g, '$1').trim()
}

/**
 * Сниппеты: сказал «мой адрес» — вставился адрес. Вся надиктовка — это одна
 * фраза-триггер (с точкой или без) → только текст сниппета. Иначе фраза внутри
 * текста заменяется на сниппет.
 */
export function expandSnippets(text: string, snippets: Snippet[] | undefined): string {
  const list = [...(snippets ?? [])].filter((s) => s.trigger.trim() && s.text).sort((a, b) => b.trigger.length - a.trigger.length)
  const bare = text.trim().replace(/[\s.,!?…;:]+$/u, '')
  for (const s of list) {
    const re = phraseRe(s.trigger)
    if (re && bare.replace(re, '') === '' && bare) return s.text
  }
  let out = text
  for (const s of list) {
    const re = phraseRe(s.trigger)
    if (re) out = out.replace(re, () => s.text)
  }
  return out
}

/** Готовый текст диктовки: замены, затем сниппеты. */
export function finishDictation(text: string, vocab: Vocab | undefined): string {
  if (!vocab) return text
  return expandSnippets(applyReplacements(text, vocab.replacements), vocab.snippets)
}
