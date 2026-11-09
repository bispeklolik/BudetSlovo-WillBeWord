import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SETTING_ENTRIES,
  SETTINGS_SECTIONS,
  searchSettings,
  isSettingsSection
} from './settingsIndex'

describe('оглавление настроек', () => {
  it('id уникальны, у каждого раздела есть настройки', () => {
    const ids = SETTING_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SETTINGS_SECTIONS) {
      expect(SETTING_ENTRIES.some((e) => e.section === s.id)).toBe(true)
    }
  })

  it('поиск: слова в любом порядке, ё = е, пустой запрос — пусто', () => {
    expect(searchSettings('')).toEqual([])
    expect(searchSettings('   ')).toEqual([])
    expect(searchSettings('ключ').map((e) => e.id)).toEqual(
      expect.arrayContaining(['stt-key', 'ai-key'])
    )
    expect(searchSettings('тёмная').map((e) => e.id)).toContain('theme')
    expect(searchSettings('тема темная').map((e) => e.id)).toContain('theme')
    expect(searchSettings('резервная копия').map((e) => e.id)).toContain('backup')
    expect(searchSettings('zzzz')).toEqual([])
  })

  it('isSettingsSection', () => {
    expect(isSettingsSection('dictation')).toBe(true)
    expect(isSettingsSection('nope')).toBe(false)
  })

  it('каждая настройка из списка есть на странице, и наоборот', () => {
    const src = readFileSync(join(__dirname, '../renderer/src/views/Settings.tsx'), 'utf8')
    const onPage = new Set(
      [
        ...src.matchAll(/<(?:Row|SwitchRow|Block)\s+id="([a-z0-9-]+)"/g),
        ...src.matchAll(/id="set-([a-z0-9-]+)"/g)
      ].map((m) => m[1])
    )
    for (const e of SETTING_ENTRIES) expect(onPage.has(e.id), 'нет на странице: ' + e.id).toBe(true)
    for (const id of onPage) {
      expect(
        SETTING_ENTRIES.some((e) => e.id === id),
        'нет в оглавлении: ' + id
      ).toBe(true)
    }
  })
})
