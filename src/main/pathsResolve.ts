import { join } from 'path'

// Чистая логика «где что лежит» — без electron и без fs, чтобы покрыть тестами.
// Всё, что нужно, приходит параметрами: переменные окружения и проверка существования.
//
// Порядок для данных:
//   1) SLOVO_DATA_DIR (разовые прогоны и тесты),
//   2) указатель location.json (пользователь перенёс данные),
//   3) старая папка владельца D:\Apps\slovo-data (если есть — ничего не ломаем),
//   4) по умолчанию %LOCALAPPDATA%\Slovo\data. Не «Документы»: их часто синхронизирует
//      OneDrive, а записи консультаций не должны уезжать в облако без спроса.

export const LEGACY_DATA_DIR = 'D:\\Apps\\slovo-data'
export const LEGACY_ENGINE_DIR = 'D:\\STT\\tool\\Faster-Whisper-XXL'
export const LEGACY_MODELS_DIR = 'D:\\STT\\models'
export const LEGACY_STT_TEMP = 'D:\\STT\\temp'
export const LEGACY_OLLAMA_EXE = 'D:\\Apps\\ollama\\ollama.exe'
export const ENGINE_EXE_NAME = 'faster-whisper-xxl.exe'

/** SLOVO_NO_LEGACY=1 — вести себя как на чужом ПК: не видеть старых папок D:\ (живые прогоны). */
function legacyOk(env: Record<string, string | undefined>): boolean {
  return !env.SLOVO_NO_LEGACY
}

export interface ResolveEnv {
  env: Record<string, string | undefined>
  exists: (p: string) => boolean
}

/** Корень служебных файлов приложения (указатель, загрузки). */
export function appHome(env: Record<string, string | undefined>): string {
  const base = env.LOCALAPPDATA || join(env.USERPROFILE || 'C:\\', 'AppData', 'Local')
  return join(base, 'Slovo')
}

export function pointerFile(env: Record<string, string | undefined>): string {
  return join(appHome(env), 'location.json')
}

export function resolveDataDir(o: ResolveEnv & { pointer?: string | null }): string {
  const forced = o.env.SLOVO_DATA_DIR?.trim()
  if (forced) return forced
  if (o.pointer && o.exists(o.pointer)) return o.pointer
  if (legacyOk(o.env) && o.exists(LEGACY_DATA_DIR)) return LEGACY_DATA_DIR
  return join(appHome(o.env), 'data')
}

export interface EnginePaths {
  dir: string
  exe: string
  modelsDir: string
  temp: string
  ffmpeg: string
  installed: boolean
  /** откуда взяли: настройка / старая папка владельца / наша папка данных */
  source: 'custom' | 'legacy' | 'default'
}

export function resolveEngine(
  o: ResolveEnv & { dataDir: string; customDir?: string }
): EnginePaths {
  const mk = (dir: string, modelsDir: string, temp: string, source: EnginePaths['source']): EnginePaths => {
    const exe = join(dir, ENGINE_EXE_NAME)
    return { dir, exe, modelsDir, temp, ffmpeg: join(dir, 'ffmpeg.exe'), installed: o.exists(exe), source }
  }
  const custom = o.customDir?.trim()
  if (custom && o.exists(join(custom, ENGINE_EXE_NAME))) {
    const root = join(o.dataDir, 'engine')
    return mk(custom, join(root, 'models'), join(root, 'temp'), 'custom')
  }
  if (legacyOk(o.env) && o.exists(join(LEGACY_ENGINE_DIR, ENGINE_EXE_NAME))) {
    return mk(LEGACY_ENGINE_DIR, LEGACY_MODELS_DIR, LEGACY_STT_TEMP, 'legacy')
  }
  const root = join(o.dataDir, 'engine')
  return mk(join(root, 'Faster-Whisper-XXL'), join(root, 'models'), join(root, 'temp'), 'default')
}

/** ffmpeg: встроенный в установщик → из движка → из PATH (по имени). */
export function resolveFfmpeg(o: { bundled?: string | null; engineFfmpeg: string; exists: (p: string) => boolean }): string {
  if (o.bundled && o.exists(o.bundled)) return o.bundled
  if (o.exists(o.engineFfmpeg)) return o.engineFfmpeg
  return 'ffmpeg'
}

/** Ollama: старая папка владельца → стандартная установка с ollama.com → нет. */
export function resolveOllamaExe(o: ResolveEnv): string | null {
  if (legacyOk(o.env) && o.exists(LEGACY_OLLAMA_EXE)) return LEGACY_OLLAMA_EXE
  const local = o.env.LOCALAPPDATA
  if (local) {
    const std = join(local, 'Programs', 'Ollama', 'ollama.exe')
    if (o.exists(std)) return std
  }
  return null
}

/** Кэши движка (HF, torch, pyannote) — рядом с моделями, а не на системном диске. */
export function engineCacheEnv(modelsDir: string, temp: string): Record<string, string> {
  return {
    HF_HOME: join(modelsDir, 'hf'),
    HUGGINGFACE_HUB_CACHE: join(modelsDir, 'hf', 'hub'),
    TORCH_HOME: join(modelsDir, 'torch'),
    XDG_CACHE_HOME: join(modelsDir, 'cache'),
    PYANNOTE_CACHE: join(modelsDir, 'pyannote'),
    TEMP: temp,
    TMP: temp
  }
}
