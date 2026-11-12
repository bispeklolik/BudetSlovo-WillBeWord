import { describe, it, expect } from 'vitest'
import { registerProvider, providerForTask, type AiProvider } from './provider'

const fake = (id: string, isLocal: boolean): AiProvider => ({ id, isLocal }) as unknown as AiProvider

describe('провайдер для задачи', () => {
  registerProvider(fake('local-llama', true))
  registerProvider(fake('claude', false))
  registerProvider(fake('openrouter', false))

  it('диктовка с aiTasks.dictation=local-llama берёт локальный, конспект — общий', () => {
    const s = { aiEngine: 'claude' as const, aiTasks: { dictation: 'local-llama' as const } }
    expect(providerForTask(s, 'dictation')?.isLocal).toBe(true)
    expect(providerForTask(s, 'notes')?.id).toBe('claude')
    expect(providerForTask(s, 'notes')?.isLocal).toBe(false)
  })
  it('без aiTasks все задачи идут на общий движок', () => {
    for (const t of ['dictation', 'cleanup', 'notes', 'ask', 'highlights', 'variants'] as const) {
      expect(providerForTask({ aiEngine: 'openrouter' }, t)?.id).toBe('openrouter')
    }
  })
  it('обезличивание для облака смотрит на провайдера задачи: облачный конспект — да, локальный — нет', () => {
    const s = { aiEngine: 'local-llama' as const, aiTasks: { ask: 'claude' as const } }
    expect(!providerForTask(s, 'ask')!.isLocal).toBe(true)
    expect(!providerForTask(s, 'notes')!.isLocal).toBe(false)
  })
})
