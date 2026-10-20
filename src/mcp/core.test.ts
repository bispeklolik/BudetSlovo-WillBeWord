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
    id: 'id-' + slug,
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
const anonP = project('eva-ivanova', [turn('S1', 5, 'Ева скучает по маме')], { anon: ANON, folder: 'Ева', id: 'u1' })
const rawP = project('maria-petrova', [turn('S1', 7, 'Мария злится на маму')], { title: 'Мария Петрова', folder: 'Мария', id: 'u2' })
const notes: Note[] = [
  { id: 'n1', title: 'Динамика: Ева', body: 'Ева стала спать лучше', kind: 'summary', sourceTitle: 'Ева', createdAt: '2026-10-02', updatedAt: '2026-10-02' },
  { id: 'n2', title: 'Конспект: Мария Петрова', body: 'Мария плачет', kind: 'summary', sourceSlug: 'maria-petrova', createdAt: '2026-10-03', updatedAt: '2026-10-03' },
  { id: 'n3', title: 'Конспект: Ева', body: 'Евы не было', kind: 'summary', sourceSlug: 'eva-ivanova', createdAt: '2026-10-04', updatedAt: '2026-10-04' }
]

function store(settings: Partial<Settings> = {}): Store {
  return { projects: () => [anonP, rawP], notes: () => notes, settings: () => settings }
}

const txt = (r: { content: { text: string }[] }): string => r.content[0].text

describe('MCP: политика «только обезличенные»', () => {
  it('список: id вместо имени файла; папка и название обезличены; у необезличенной всё скрыто', () => {
    const t = txt(callTool(store({ mcpPolicy: 'anon' }), 'list_recordings', {}))
    expect(t).toContain('id: u1 | название: Сессия с [Имя] eva-ivanova | папка: [Имя]')
    expect(t).toContain('название: (название скрыто: запись не обезличена)')
    expect(t).not.toMatch(/Мария|maria|Петрова/)
    expect(t).toContain('текст закрыт (не обезличена)')
  })
  it('обезличенную запись отдаёт по id с заменами и временем', () => {
    const t = txt(callTool(store({ mcpPolicy: 'anon' }), 'get_transcript', { id: 'u1' }))
    expect(t).toContain('[0:05] Клиент: [Имя] скучает по маме')
    expect(t).toContain('Папка: [Имя]')
    expect(t).not.toMatch(/Ева/)
  })
  it('необезличенную — не отдаёт', () => {
    const r = callTool(store({ mcpPolicy: 'anon' }), 'get_transcript', { id: 'u2' })
    expect(r.isError).toBe(true)
    expect(txt(r)).toContain('не обезличена')
  })
  it('поиск только по обезличенным, в заголовке — id', () => {
    const t = txt(callTool(store({ mcpPolicy: 'anon' }), 'search_recordings', { query: 'мама маме маму' }))
    expect(t).toContain('[Имя] скучает')
    expect(t).toContain('(id u1)')
    expect(t).not.toContain('злится')
  })
  it('конспекты: только те, чьи записи обезличены; чистятся их правилами', () => {
    const list = txt(callTool(store({ mcpPolicy: 'anon' }), 'list_notes', {}))
    expect(list).toContain('id: n1 | Динамика: [Имя]')
    expect(list).toContain('id: n3 | Конспект: [Имя]')
    expect(list).not.toContain('Мария')
    expect(list).toContain('скрыто: 1')
    expect(txt(callTool(store({ mcpPolicy: 'anon' }), 'get_note', { id: 'n3' }))).toBe('# Конспект: [Имя]\n\n[Имя] не было')
    const r = callTool(store({ mcpPolicy: 'anon' }), 'get_note', { id: 'n2' })
    expect(r.isError).toBe(true)
    expect(txt(r)).not.toContain('Мария')
  })
})

describe('MCP: политика «все записи»', () => {
  it('без настройки — все записи (так решил владелец)', () => {
    expect(txt(callTool(store(), 'get_transcript', { id: 'u2' }))).toContain('Мария злится')
  })
  it('отдаёт и необезличенную, как есть; старый параметр slug тоже понимает', () => {
    expect(txt(callTool(store({ mcpPolicy: 'all' }), 'get_transcript', { slug: 'maria-petrova' }))).toContain('Мария злится')
    expect(txt(callTool(store({ mcpPolicy: 'all' }), 'get_note', { id: 'n2' }))).toContain('Мария плачет')
  })
  it('фильтр по папке', () => {
    const t = txt(callTool(store({ mcpPolicy: 'all' }), 'list_recordings', { folder: 'Ева' }))
    expect(t).toContain('id: u1')
    expect(t).not.toContain('u2')
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
