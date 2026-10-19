import { existsSync, readFileSync } from 'fs'
import { resolveDataDir, pointerFile } from '../main/pathsResolve'
import { diskStore, handleMessage, type RpcMessage } from './core'

// Точка входа MCP-сервера «Слова»: JSON-RPC построчно через stdin/stdout.
// Запускается тем же exe «Слова» в режиме Node (ELECTRON_RUN_AS_NODE=1) —
// готовая строка для Claude Desktop есть в Настройках → «Claude (MCP)».
// В stdout — только протокол; всё прочее — в stderr.

function dataDir(): string {
  const env = process.env as Record<string, string | undefined>
  let pointer: string | null = null
  try {
    const f = pointerFile(env)
    if (existsSync(f)) pointer = (JSON.parse(readFileSync(f, 'utf8')) as { dataDir?: string }).dataDir ?? null
  } catch {
    pointer = null
  }
  return resolveDataDir({ env, exists: existsSync, pointer })
}

const store = diskStore(dataDir())
let buf = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buf += chunk
  let nl: number
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg: RpcMessage
    try {
      msg = JSON.parse(line) as RpcMessage
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n')
      continue
    }
    try {
      const out = handleMessage(store, msg)
      if (out) process.stdout.write(JSON.stringify(out) + '\n')
    } catch (err) {
      process.stderr.write('[slovo-mcp] ' + String(err) + '\n')
      if (msg.id !== undefined && msg.id !== null)
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err) } }) + '\n')
    }
  }
})
process.stdin.on('end', () => process.exit(0))
