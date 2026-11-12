import { describe, it, expect } from 'vitest'
import { resolveAiEngine, commonAiEngine, aiEngineLabel, AI_TASKS } from './aiRouting'
import { mergeStoredSettings } from './settingsMerge'
import { searchSettings } from './settingsIndex'

describe('какой ИИ делает задачу', () => {
  it('без своего выбора берётся общий движок', () => {
    for (const t of AI_TASKS) {
      expect(resolveAiEngine({ aiEngine: 'claude' }, t.id)).toBe('claude')
      expect(resolveAiEngine({ aiEngine: 'claude', aiTasks: {} }, t.id)).toBe('claude')
    }
  })
  it('в старых настройках без движка общий — локальный', () => {
    expect(commonAiEngine({})).toBe('local-llama')
    expect(resolveAiEngine({}, 'notes')).toBe('local-llama')
  })
  it('свой выбор действует только для своей задачи', () => {
    const s = { aiEngine: 'claude' as const, aiTasks: { dictation: 'local-llama' as const } }
    expect(resolveAiEngine(s, 'dictation')).toBe('local-llama')
    expect(resolveAiEngine(s, 'notes')).toBe('claude')
    expect(resolveAiEngine(s, 'ask')).toBe('claude')
  })
  it('неизвестное значение в файле не ломает выбор', () => {
    const s = { aiEngine: 'openrouter' as const, aiTasks: { notes: 'gpt' } as never }
    expect(resolveAiEngine(s, 'notes')).toBe('openrouter')
  })
  it('шесть задач, id уникальны', () => {
    expect(new Set(AI_TASKS.map((t) => t.id)).size).toBe(6)
  })
  it('подпись берёт движок своей задачи', () => {
    const s = { aiEngine: 'claude' as const, aiTasks: { cleanup: 'local-llama' as const } }
    expect(aiEngineLabel(s, 'cleanup')).toBe('Локально')
    expect(aiEngineLabel(s, 'notes')).toBe('Claude (облако)')
  })
})

describe('настройки и поиск', () => {
  it('старый файл без aiTasks работает как раньше', () => {
    const s = mergeStoredSettings({ aiEngine: 'claude' }, true)
    expect(s.aiTasks).toBeUndefined()
    expect(resolveAiEngine(s, 'dictation')).toBe('claude')
  })
  it('сохранённые aiTasks доходят после слияния', () => {
    const s = mergeStoredSettings({ aiEngine: 'claude', aiTasks: { dictation: 'local-llama' } }, true)
    expect(resolveAiEngine(s, 'dictation')).toBe('local-llama')
    expect(resolveAiEngine(s, 'notes')).toBe('claude')
  })
  it('новый человек: без своих выборов, всё облако', () => {
    const s = mergeStoredSettings(null, false)
    expect(resolveAiEngine(s, 'dictation')).toBe('claude')
  })
  it('поиск «диктовка ии» находит блок задач', () => {
    expect(searchSettings('диктовка ии').map((e) => e.id)).toContain('ai-tasks')
    expect(searchSettings('отдельных задач').map((e) => e.id)).toContain('ai-tasks')
  })
})
