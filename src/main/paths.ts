import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import {
  resolveDataDir,
  resolveOllamaExe,
  pointerFile,
  appHome,
  LEGACY_OLLAMA_EXE,
  LEGACY_DATA_DIR
} from './pathsResolve'

// Где лежат данные — решается один раз при старте (смена папки = перезапуск).
// Логика и порядок — в pathsResolve.ts (там же тесты). Движок и ffmpeg —
// в engine/location.ts: они могут появиться во время работы (докачались).

function readPointer(): string | null {
  try {
    const d = JSON.parse(readFileSync(pointerFile(process.env), 'utf8')) as { dataDir?: string }
    return d.dataDir ?? null
  } catch {
    return null
  }
}

export const DATA_DIR = resolveDataDir({ env: process.env, exists: existsSync, pointer: readPointer() })
export const PROJECTS_DIR = join(DATA_DIR, 'projects')
/** Временные файлы (перекодировка клипов и аудио для облака). */
export const TEMP_DIR = join(DATA_DIR, 'temp')
/** Служебная папка приложения: указатель на данные. */
export const APP_HOME = appHome(process.env)

/** Записать указатель «данные теперь здесь» (вступает в силу после перезапуска). */
export function writeDataPointer(dataDir: string): void {
  const f = pointerFile(process.env)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify({ dataDir }, null, 2), 'utf8')
}

// Локальный ИИ (Ollama). Остаёмся на qwen2.5:7b-instruct: проверено, что она
// корректно обрабатывает тяжёлый/чувствительный контент (саммари сессии про
// насилие — без отказов), расцензуренная не нужна.
export const OLLAMA_ADDR = '127.0.0.1:11434'

export function ollamaExe(): string | null {
  return resolveOllamaExe({ env: process.env, exists: existsSync })
}

/** Свою папку моделей задаём только старой установке владельца (модели лежат в
 *  slovo-data\models). Обычной Ollama с ollama.com оставляем её родную папку —
 *  иначе модели, скачанные через «Слово», не увидит сама Ollama. */
export function ollamaModelsOverride(exe: string): string | null {
  return exe === LEGACY_OLLAMA_EXE ? join(LEGACY_DATA_DIR, 'models') : null
}
