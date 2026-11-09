import { describe, it, expect } from 'vitest'
import { currentClaudeModel, DEFAULT_CLAUDE_MODEL } from './claudeModels'

describe('модели Claude', () => {
  it('пусто — Sonnet 5.5, старые — их замена 5.5, новые как есть', () => {
    expect(currentClaudeModel(undefined)).toBe(DEFAULT_CLAUDE_MODEL)
    expect(currentClaudeModel('claude-sonnet-4-6')).toBe('claude-sonnet-5-5')
    expect(currentClaudeModel('claude-opus-4-8')).toBe('claude-opus-5-5')
    expect(currentClaudeModel('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(currentClaudeModel('claude-haiku-4-5')).toBe('claude-haiku-5-5')
  })
})
