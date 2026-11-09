// Модели Claude (волна 7, 09.11.2026): умная — Sonnet 5.5 по умолчанию, Opus 5.5 — «максимум»;
// быстрая (диктовка, правка голосом) — Haiku 5.5. Общий файл для main и окна настроек.

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5'
export const FAST_CLAUDE_MODEL = 'claude-haiku-5-5'

// Старые модели из прежних настроек → текущие (качество важнее, решение 22.10.2026).
const MIGRATE: Record<string, string> = {
  'claude-sonnet-4-5': DEFAULT_CLAUDE_MODEL,
  'claude-sonnet-4-6': DEFAULT_CLAUDE_MODEL,
  'claude-sonnet-5': DEFAULT_CLAUDE_MODEL,
  'claude-opus-4-6': 'claude-opus-5-5',
  'claude-opus-4-7': 'claude-opus-5-5',
  'claude-opus-4-8': 'claude-opus-5-5',
  'claude-opus-5': 'claude-opus-5-5'
}

/** Модель для умных задач: пусто — Sonnet 5.5, старая — её замена 5.5, остальное как есть. */
export function currentClaudeModel(mdl: string | undefined): string {
  const m = (mdl ?? '').trim()
  if (!m) return DEFAULT_CLAUDE_MODEL
  return MIGRATE[m] ?? m
}
