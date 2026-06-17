import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { OLLAMA_EXE, OLLAMA_ADDR, OLLAMA_MODELS_DIR } from '../paths'

// Управление локальным движком ИИ (Ollama) как подпроцессом — тот же паттерн,
// что и движок расшифровки. Лениво поднимаем сервер при первом ИИ-вызове, если
// он ещё не запущен; глушим свой процесс при выходе. Чужой уже запущенный
// сервер не трогаем (только проверяем доступность).
let child: ChildProcess | null = null
const BASE = `http://${OLLAMA_ADDR}`

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

export async function ensureOllama(): Promise<boolean> {
  if (await reachable()) return true
  if (!existsSync(OLLAMA_EXE)) return false
  if (!child || child.exitCode !== null) {
    child = spawn(OLLAMA_EXE, ['serve'], {
      env: {
        ...process.env,
        OLLAMA_HOST: OLLAMA_ADDR,
        OLLAMA_MODELS: OLLAMA_MODELS_DIR,
        OLLAMA_FLASH_ATTENTION: '1'
      },
      windowsHide: true,
      stdio: 'ignore'
    })
    child.on('error', () => {
      child = null
    })
  }
  // ждём готовности до ~20с (первый старт + дискавери GPU)
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await reachable()) return true
  }
  return false
}

export function stopOllama(): void {
  if (child && child.exitCode === null) {
    try {
      child.kill()
    } catch {
      // ignore
    }
  }
  child = null
}
