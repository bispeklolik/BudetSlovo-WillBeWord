import { describe, it, expect } from 'vitest'
import { handleMessage, callTool, type Store } from './core'
import type { Note, ProjectMeta, Settings, Turn } from '../shared/types'

let wid = 0
const turn = (spk: string, startSec: number, text: string): Turn => ({
  id: 't' + wid,
  spk,
  startSec,
  words: text.split(' ').map((t) => ({ id: wid++, t }))
})

function project(slug: string, turns: Turn[], extra: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    version: 1,
    id: slug,
    slug,
    title: 'Сессия с Евой ' + slug,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    audio: { file: 'audio.m4a', originalPath: '', durationSec: 125, repairedPrefixBytes: 0, peaks: { file: '', perSec: 1 } },
    speakers: [{ id: 'S1', engineLabel: 'S1', name: 'Клиент', colorKey: 'b' }],
    turns,
    ...extra
  }
}

const ANON = [{ find: 'Ева', replace: '[Имя]', kind: 'name' as const }]
const anonP = project('a', [turn('S1', 5, 'Ева скучает по маме')], { anon: ANON, folder: 'Ева' })
const rawP = project('b', [turn('S1', 7, 'Ева злится на маму')])
const notes: Note[] = [
  { id: 'n1', title: 'Динамика: Ева', body: 'Ева стала спать лучше', kind: 'summary', createdAt: '2026-10-02', updatedAt: '2026-10-02' }
]

function store(settings: Partial<Settings> = {}): Store {
  return { projects: () => [anonP, rawP], notes: () => notes, settings: () => settings }
}

const txt = (r: { content: { text: string }[] }): string => r.content[0].text

describe('MCP: политика «только обезличенные»', () => {
  it('список: у каждой записи видно, можно ли читать; названия обезличены', () => {
    const t = txt(callTool(store(), 'list_recordings', {}))
    expect(t).toContain('slug: a | название: Сессия с [Имя] a | папка: Ева')
    expect(t).toContain('текст доступен')
    expect(t).toContain('текст закрыт (не обезличена)')
  })
  it('обезличенную запись отдаёт с заменами и временем', () => {
    const t = txt(callTool(store(), 'get_transcript', { slug: 'a' }))
    expect(t).toContain('[0:05] Клиент: [Имя] скучает по маме')
    expect(t).not.toMatch(/Ева скучает/)
  })
  it('необезличенную — не отдаёт', () => {
    const r = callTool(store(), 'get_transcript', { slug: 'b' })
    expect(r.isError).toBe(true)
    expect(txt(r)).toContain('не обезличена')
  })
  it('поиск только по обезличенным', () => {
    const t = txt(callTool(store(), 'search_recordings', { query: 'мама маме маму' }))
    expect(t).toContain('[Имя] скучает')
    expect(t).not.toContain('злится')
  })
  it('конспекты — с правилами всех записей', () => {
    expect(txt(callTool(store(), 'get_note', { id: 'n1' }))).toBe('# Динамика: [Имя]\n\n[Имя] стала спать лучше')
  })
})

describe('MCP: политика «все записи»', () => {
  it('отдаёт и необезличенную, как есть', () => {
    expect(txt(callTool(store({ mcpPolicy: 'all' }), 'get_transcript', { slug: 'b' }))).toContain('Ева злится')
    expect(txt(callTool(store({ mcpPolicy: 'all' }), 'get_note', { id: 'n1' }))).toContain('Ева стала')
  })
  it('фильтр по папке', () => {
    const t = txt(callTool(store({ mcpPolicy: 'all' }), 'list_recordings', { folder: 'Ева' }))
    expect(t).toContain('slug: a')
    expect(t).not.toContain('slug: b')
  })
})

describe('MCP: протокол', () => {
  it('initialize: версия клиента, если знаем её', () => {
    const r = handleMessage(store(), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
    expect((r!.result as { protocolVersion: string }).protocolVersion).toBe('2024-11-05')
    const r2 = handleMessage(store(), { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999' } })
    expect((r2!.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18')
  })
  it('уведомления без ответа, неизвестный метод — ошибка', () => {
    expect(handleMessage(store(), { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    const r = handleMessage(store(), { jsonrpc: '2.0', id: 3, method: 'resources/list' })
    expect((r!.error as { code: number }).code).toBe(-32601)
  })
  it('tools/call неизвестного инструмента — isError, а не падение', () => {
    const r = handleMessage(store(), { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'rm_rf', arguments: {} } })
    expect((r!.result as { isError: boolean }).isError).toBe(true)
  })
})
