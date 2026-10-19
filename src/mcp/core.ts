import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type { AnonRule, Note, ProjectMeta, Settings } from '../shared/types'
import { buildPassages, rankPassages, terms, timedTranscript, clock } from '../shared/retrieval'
import { anonPlain } from '../shared/anon'

// MCP-сервер «Слова» (волна 5): Claude (Desktop, Code) читает записи и конспекты.
// Только чтение. Текст уходит в облако Anthropic вместе с разговором — поэтому
// по умолчанию Claude видит только ОБЕЗЛИЧЕННЫЕ записи (у которых есть правила
// обезличивания); «все записи» — только если человек сам так выбрал в настройках.
// Логика — здесь (под тестами), stdio-обвязка — в server.ts.

export const SERVER_INFO = { name: 'slovo', version: '1.0.0' }
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const TOOLS: Tool[] = [
  {
    name: 'list_recordings',
    description:
      'Список записей разговоров в «Слове»: название, папка, дата, длительность, можно ли читать текст. Папка — например «Консультации/Ева».',
    inputSchema: {
      type: 'object',
      properties: { folder: { type: 'string', description: 'Только эта папка (с вложенными). Необязательно.' } }
    }
  },
  {
    name: 'get_transcript',
    description: 'Текст расшифровки одной записи строками «[мм:сс] Имя: реплика». id — из list_recordings или search_recordings.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'search_recordings',
    description:
      'Поиск по словам во всех доступных записях. Возвращает фрагменты с названием записи и временем. Пишите в запросе слова так, как их говорят (мама, маме, мать).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        folder: { type: 'string', description: 'Только эта папка (с вложенными). Необязательно.' },
        limit: { type: 'number', description: 'Сколько фрагментов (по умолчанию 10, максимум 30).' }
      },
      required: ['query']
    }
  },
  {
    name: 'list_notes',
    description: 'Список конспектов (саммари, динамика клиента, заметки), сделанных в «Слове».',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_note',
    description: 'Текст одного конспекта по id из list_notes.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  }
]

export interface Store {
  projects: () => ProjectMeta[]
  notes: () => Note[]
  settings: () => Partial<Settings>
}

/** Хранилище «Слова» на диске (только чтение, каждый вызов — свежие данные). */
export function diskStore(dataDir: string): Store {
  const readJson = <T>(file: string): T | null => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T
    } catch {
      return null
    }
  }
  return {
    projects: () => {
      const dir = join(dataDir, 'projects')
      if (!existsSync(dir)) return []
      return readdirSync(dir)
        .map((slug) => readJson<ProjectMeta>(join(dir, slug, 'project.json')))
        .filter((m): m is ProjectMeta => !!m && !!m.slug)
    },
    notes: () => readJson<Note[]>(join(dataDir, 'notes.json')) ?? [],
    settings: () => readJson<Partial<Settings>>(join(dataDir, 'settings.json')) ?? {}
  }
}

const inFolder = (p: ProjectMeta, folder: string | undefined): boolean => {
  const f = (folder ?? '').trim().replace(/^\/+|\/+$/g, '')
  return !f || p.folder === f || (p.folder ?? '').startsWith(f + '/')
}

/** Можно ли Claude читать текст записи при текущей политике. */
function readable(p: ProjectMeta, policy: Settings['mcpPolicy']): boolean {
  if (!p.turns?.length) return false
  return policy === 'all' || !!p.anon?.length
}

const NOT_ANON =
  'Эта запись не обезличена. В настройках «Слова» Claude разрешено читать только обезличенные записи: ' +
  'откройте запись → «ИИ ▾» → «Обезличить», или разрешите чтение всех записей в Настройках → «Claude (MCP)».'

class ToolError extends Error {}

function text(s: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: s }] }
}

export function callTool(
  store: Store,
  name: string,
  args: Record<string, unknown>
): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  try {
    return text(runTool(store, name, args ?? {}))
  } catch (err) {
    return { ...text(err instanceof Error ? err.message : String(err)), isError: true }
  }
}

function runTool(store: Store, name: string, args: Record<string, unknown>): string {
  const policy = store.settings().mcpPolicy ?? 'anon'
  const anon = policy !== 'all'
  const str = (k: string): string | undefined => (typeof args[k] === 'string' ? (args[k] as string) : undefined)
  const projects = store.projects().filter((p) => !p.demo)

  // При «только обезличенные» наружу не уходит ничего, что может назвать клиента:
  // ни имя файла (slug), ни папка, ни название необезличенной записи (ревью волны 5).
  // Запись называем её id; папку и название — через правила этой записи.
  const titleOf = (p: ProjectMeta): string =>
    !anon ? p.title : readable(p, policy) ? anonPlain(p.title, p.anon) : '(название скрыто: запись не обезличена)'
  const folderOf = (p: ProjectMeta): string =>
    !p.folder ? '' : !anon ? p.folder : readable(p, policy) ? anonPlain(p.folder, p.anon) : ''
  const find = (key: string | undefined): ProjectMeta | undefined =>
    key ? projects.find((x) => x.id === key || x.slug === key) : undefined

  if (name === 'list_recordings') {
    const list = projects.filter((p) => inFolder(p, str('folder'))).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (!list.length) return 'Записей нет.'
    return list
      .map((p) =>
        [
          `id: ${p.id}`,
          `название: ${titleOf(p)}`,
          folderOf(p) ? `папка: ${folderOf(p)}` : '',
          `дата: ${p.createdAt.slice(0, 10)}`,
          `длительность: ${clock(p.audio?.durationSec ?? 0)}`,
          !p.turns?.length ? 'не расшифрована' : readable(p, policy) ? 'текст доступен' : 'текст закрыт (не обезличена)'
        ]
          .filter(Boolean)
          .join(' | ')
      )
      .join('\n')
  }

  if (name === 'get_transcript') {
    const key = str('id') ?? str('slug')
    const p = find(key)
    if (!p) throw new ToolError(`Запись «${key ?? ''}» не найдена. Список — list_recordings.`)
    if (!p.turns?.length) throw new ToolError('Запись ещё не расшифрована.')
    if (!readable(p, policy)) throw new ToolError(NOT_ANON)
    const folder = folderOf(p)
    return `# ${titleOf(p)}\n${folder ? `Папка: ${folder}\n` : ''}Дата: ${p.createdAt.slice(0, 10)}${anon ? '\nТекст обезличен.' : ''}\n\n${timedTranscript(p, anon)}`
  }

  if (name === 'search_recordings') {
    const q = (str('query') ?? '').trim()
    if (!q) throw new ToolError('Пустой запрос.')
    const limit = Math.min(30, Math.max(1, Math.round(Number(args.limit) || 10)))
    const pool = projects.filter((p) => inFolder(p, str('folder')) && readable(p, policy))
    if (!pool.length) return anon ? 'Нет обезличенных записей — искать не в чем. ' + NOT_ANON : 'Нет расшифрованных записей.'
    const found = rankPassages(
      pool.flatMap((p) => buildPassages(p, { anon })),
      terms(q),
      { limit, perDoc: 5 }
    )
    if (!found.length) return 'Ничего не нашлось. Попробуйте другие формы слов или синонимы.'
    return found
      .map((f) => {
        const p = pool.find((x) => x.slug === f.slug)!
        return `## ${titleOf(p)} (id ${p.id}), ${clock(f.startSec)}\n${f.text}`
      })
      .join('\n\n')
  }

  // Конспекты — свободный текст с именами. При «только обезличенные» конспект
  // виден, только если ВСЕ его записи обезличены (конспект записи — эта запись;
  // динамика — все записи её папки), и чистится их правилами (ревью волны 5).
  const noteRules = (n: Note): AnonRule[] | null => {
    if (!anon) return []
    if (n.sourceSlug) {
      const p = find(n.sourceSlug)
      return p && readable(p, policy) ? (p.anon ?? []) : null
    }
    const folder = (n.sourceTitle ?? '').trim()
    const inF = folder ? projects.filter((p) => p.turns?.length && inFolder(p, folder)) : []
    if (!inF.length || !inF.every((p) => readable(p, policy))) return null
    return inF.flatMap((p) => p.anon ?? [])
  }
  const scrub = (s: string, rules: AnonRule[]): string => (anon ? anonPlain(s, rules) : s)

  if (name === 'list_notes') {
    const notes = store.notes().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (!notes.length) return 'Конспектов нет.'
    const open = notes.map((n) => ({ n, rules: noteRules(n) })).filter((x) => x.rules !== null)
    const hidden = notes.length - open.length
    const lines = open.map(({ n, rules }) => `id: ${n.id} | ${scrub(n.title, rules!)} | ${n.createdAt.slice(0, 10)}`)
    if (hidden) lines.push(`Ещё конспектов скрыто: ${hidden} — их записи не обезличены.`)
    return lines.join('\n') || 'Доступных конспектов нет: их записи не обезличены.'
  }

  if (name === 'get_note') {
    const n = store.notes().find((x) => x.id === str('id'))
    if (!n) throw new ToolError('Конспект не найден. Список — list_notes.')
    const rules = noteRules(n)
    if (rules === null) throw new ToolError('Этот конспект закрыт: его записи не обезличены. ' + NOT_ANON)
    return `# ${scrub(n.title, rules)}\n\n${scrub(n.body, rules)}`
  }

  throw new ToolError(`Нет такого инструмента: ${name}`)
}

// ---------- JSON-RPC ----------
export interface RpcMessage {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

/** Один входящий JSON-RPC → ответ (или null для уведомлений). */
export function handleMessage(store: Store, msg: RpcMessage): Record<string, unknown> | null {
  const id = msg.id
  const isRequest = id !== undefined && id !== null
  const reply = (result: unknown): Record<string, unknown> => ({ jsonrpc: '2.0', id, result })
  const fail = (code: number, message: string): Record<string, unknown> => ({ jsonrpc: '2.0', id, error: { code, message } })

  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '')
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Записи разговоров и конспекты из приложения «Слово» (только чтение). Сначала list_recordings или search_recordings, потом get_transcript. Время в тексте — [мм:сс].'
      })
    }
    case 'ping':
      return isRequest ? reply({}) : null
    case 'tools/list':
      return reply({ tools: TOOLS })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      return reply(callTool(store, name, args))
    }
    default:
      if (!isRequest) return null // уведомления (notifications/initialized и т.п.) без ответа
      return fail(-32601, `Метод не поддерживается: ${msg.method}`)
  }
}
