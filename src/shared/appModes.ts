// Режим диктовки по программе (волна 6): в Telegram — «Сообщение», в почте —
// «Письмо». Программу узнаём по имени процесса и заголовку окна на компьютере
// (как Superwhisper / Wispr Flow), без снимков экрана.

export interface ForegroundApp {
  /** Имя процесса без .exe, в нижнем регистре: telegram, outlook, chrome. */
  proc: string
  title: string
}

export interface AppModeRule {
  /** Что ищем: часть имени процесса или заголовка окна (без учёта регистра). */
  match: string
  /** id режима: clean | email | message | note | свой. */
  mode: string
}

export const DEFAULT_APP_RULES: AppModeRule[] = [
  { match: 'telegram', mode: 'message' },
  { match: 'whatsapp', mode: 'message' },
  { match: 'viber', mode: 'message' },
  { match: 'discord', mode: 'message' },
  { match: 'slack', mode: 'message' },
  { match: 'signal', mode: 'message' },
  { match: 'max', mode: 'message' },
  { match: 'outlook', mode: 'email' },
  { match: 'thunderbird', mode: 'email' },
  { match: 'gmail', mode: 'email' },
  { match: 'почта', mode: 'email' },
  { match: 'mail.ru', mode: 'email' }
]

/**
 * Первое правило, которое нашлось в имени процесса или в заголовке окна.
 * Правила длиной до 3 букв («max») сверяются только с именем процесса целиком,
 * иначе «max» нашлось бы в любом заголовке со словом «maximum».
 */
export function pickModeForApp(app: ForegroundApp | null | undefined, rules: AppModeRule[]): string | null {
  if (!app) return null
  const proc = app.proc.toLowerCase()
  const title = app.title.toLowerCase()
  for (const r of rules) {
    const m = r.match.trim().toLowerCase()
    if (!m || !r.mode) continue
    if (m.length <= 3 ? proc === m : proc.includes(m) || title.includes(m)) return r.mode
  }
  return null
}
