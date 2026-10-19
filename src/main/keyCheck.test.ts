import { describe, it, expect } from 'vitest'
import { verdictFor, KEY_PROBES, checkKey } from './keyCheck'

describe('verdictFor', () => {
  it('200 — работает', () => expect(verdictFor(200).ok).toBe(true))
  it('401/403 — ключ не принят', () => {
    expect(verdictFor(401).ok).toBe(false)
    expect(verdictFor(403).message).toMatch(/не принял/)
  })
  it('402 — ключ верный, нет денег', () => {
    const v = verdictFor(402)
    expect(v.ok).toBe(true)
    expect(v.message).toMatch(/баланс/)
  })
  it('500 — сервис лежит, а не ключ плохой', () => expect(verdictFor(503).message).toMatch(/не отвечает/))
})

describe('KEY_PROBES', () => {
  it('есть проба для каждого облачного сервиса и обоих ИИ', () => {
    for (const s of ['deepgram', 'elevenlabs', 'assemblyai', 'openai', 'groq', 'claude', 'openrouter'])
      expect(KEY_PROBES[s]).toBeDefined()
  })
  it('пустой ключ не уходит в сеть', async () => {
    expect((await checkKey('deepgram', '  ')).message).toMatch(/Вставьте/)
  })
})
