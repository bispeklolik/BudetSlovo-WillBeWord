// Проверка ключа одним бесплатным запросом (список моделей / данные ключа) —
// как кнопка «Test connection» у OpenWhispr. Никакой расшифровки, денег не тратит.

export interface KeyVerdict {
  ok: boolean
  message: string
}

/** Что сказать человеку по коду ответа сервиса. */
export function verdictFor(status: number): KeyVerdict {
  if (status >= 200 && status < 300) return { ok: true, message: 'Ключ работает.' }
  if (status === 401 || status === 403) return { ok: false, message: 'Сервис не принял ключ. Проверьте, что скопировали его целиком.' }
  if (status === 402) return { ok: true, message: 'Ключ верный, но на счету сервиса нет денег. Пополните баланс.' }
  if (status === 429) return { ok: true, message: 'Ключ верный. Сервис просит подождать: превышен лимит запросов.' }
  if (status >= 500) return { ok: false, message: `Сервис сейчас не отвечает (ошибка ${status}). Попробуйте позже.` }
  return { ok: false, message: `Сервис ответил ошибкой ${status}.` }
}

interface Probe {
  url: string
  headers: (key: string) => Record<string, string>
}

const bearer = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}` })

export const KEY_PROBES: Record<string, Probe> = {
  deepgram: { url: 'https://api.deepgram.com/v1/projects', headers: (k) => ({ Authorization: `Token ${k}` }) },
  elevenlabs: { url: 'https://api.elevenlabs.io/v1/models', headers: (k) => ({ 'xi-api-key': k }) },
  assemblyai: { url: 'https://api.assemblyai.com/v2/transcript?limit=1', headers: (k) => ({ Authorization: k }) },
  openai: { url: 'https://api.openai.com/v1/models', headers: bearer },
  groq: { url: 'https://api.groq.com/openai/v1/models', headers: bearer },
  claude: {
    url: 'https://api.anthropic.com/v1/models',
    headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' })
  },
  // /models у OpenRouter открыт без ключа — проверяем именно ключ.
  openrouter: { url: 'https://openrouter.ai/api/v1/key', headers: bearer }
}

export async function checkKey(service: string, key: string): Promise<KeyVerdict> {
  const probe = KEY_PROBES[service]
  if (!probe) return { ok: false, message: 'Неизвестный сервис.' }
  const k = key.trim()
  if (!k) return { ok: false, message: 'Вставьте ключ.' }
  try {
    const res = await fetch(probe.url, { headers: probe.headers(k), signal: AbortSignal.timeout(15000) })
    await res.body?.cancel().catch(() => {})
    return verdictFor(res.status)
  } catch {
    return { ok: false, message: 'Нет связи с сервисом. Проверьте интернет.' }
  }
}
