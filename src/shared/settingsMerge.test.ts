import { describe, it, expect } from 'vitest'
import { mergeStoredSettings } from './settingsMerge'
import { defaultSettings } from './types'

describe('значения по умолчанию для движков', () => {
  it('новый человек (файла нет) получает облачные движки', () => {
    const s = mergeStoredSettings(null, false)
    expect(s.sttEngine).toBe('deepgram')
    expect(s.aiEngine).toBe('claude')
    expect(defaultSettings.sttEngine).not.toBe('local')
  })
  it('старый файл без полей движков остаётся на локальных', () => {
    const s = mergeStoredSettings({ theme: 'dark', onboarded: true }, true)
    expect(s.sttEngine).toBe('local')
    expect(s.aiEngine).toBe('local-llama')
    expect(s.theme).toBe('dark')
  })
  it('явный выбор сохраняется', () => {
    const s = mergeStoredSettings({ sttEngine: 'elevenlabs', aiEngine: 'openrouter' }, true)
    expect(s.sttEngine).toBe('elevenlabs')
    expect(s.aiEngine).toBe('openrouter')
    expect(mergeStoredSettings({ sttEngine: 'local', aiEngine: 'local-llama' }, true).sttEngine).toBe('local')
  })
  it('битый файл не переключает человека на облако', () => {
    expect(mergeStoredSettings(null, true).sttEngine).toBe('local')
    expect(mergeStoredSettings([1, 2], true).aiEngine).toBe('local-llama')
  })
  it('прочие поля по умолчанию дополняются', () => {
    expect(mergeStoredSettings({}, true).pauseMarkSec).toBe(defaultSettings.pauseMarkSec)
  })
})
