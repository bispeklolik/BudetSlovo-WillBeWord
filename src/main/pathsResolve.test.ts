import { describe, it, expect } from 'vitest'
import {
  resolveDataDir,
  resolveEngine,
  resolveFfmpeg,
  resolveOllamaExe,
  engineCacheEnv,
  LEGACY_DATA_DIR,
  LEGACY_ENGINE_DIR
} from './pathsResolve'

const env = { LOCALAPPDATA: 'C:\\Users\\Анна\\AppData\\Local', USERPROFILE: 'C:\\Users\\Анна' }
const none = (): boolean => false
const only = (...paths: string[]) => (p: string): boolean => paths.includes(p)

describe('resolveDataDir', () => {
  it('новый пользователь → LOCALAPPDATA\\Slovo\\data', () => {
    expect(resolveDataDir({ env, exists: none })).toBe('C:\\Users\\Анна\\AppData\\Local\\Slovo\\data')
  })
  it('у владельца старая папка D: продолжает работать', () => {
    expect(resolveDataDir({ env, exists: only(LEGACY_DATA_DIR) })).toBe(LEGACY_DATA_DIR)
  })
  it('указатель (перенос данных) главнее старой папки', () => {
    expect(resolveDataDir({ env, exists: only(LEGACY_DATA_DIR, 'E:\\Слово'), pointer: 'E:\\Слово' })).toBe('E:\\Слово')
  })
  it('указатель на исчезнувшую папку игнорируется', () => {
    expect(resolveDataDir({ env, exists: none, pointer: 'E:\\нет' })).toBe(
      'C:\\Users\\Анна\\AppData\\Local\\Slovo\\data'
    )
  })
  it('SLOVO_DATA_DIR побеждает всё (разовые прогоны)', () => {
    expect(
      resolveDataDir({ env: { ...env, SLOVO_DATA_DIR: 'C:\\tmp\\_smoke' }, exists: only(LEGACY_DATA_DIR) })
    ).toBe('C:\\tmp\\_smoke')
  })
  it('без LOCALAPPDATA собирает путь из профиля', () => {
    expect(resolveDataDir({ env: { USERPROFILE: 'C:\\Users\\X' }, exists: none })).toBe(
      'C:\\Users\\X\\AppData\\Local\\Slovo\\data'
    )
  })
})

describe('SLOVO_NO_LEGACY', () => {
  it('прячет старые папки владельца (прогон «как у чужого»)', () => {
    const ex = only(LEGACY_DATA_DIR, LEGACY_ENGINE_DIR + '\\faster-whisper-xxl.exe')
    const e2 = { ...env, SLOVO_NO_LEGACY: '1' }
    expect(resolveDataDir({ env: e2, exists: ex })).toBe('C:\\Users\\Анна\\AppData\\Local\\Slovo\\data')
    expect(resolveEngine({ env: e2, exists: ex, dataDir: 'C:\\d' }).source).toBe('default')
  })
})

describe('resolveEngine', () => {
  const dataDir = 'C:\\data'
  it('новый пользователь → движок в папке данных, не установлен', () => {
    const e = resolveEngine({ env, exists: none, dataDir })
    expect(e.source).toBe('default')
    expect(e.exe).toBe('C:\\data\\engine\\Faster-Whisper-XXL\\faster-whisper-xxl.exe')
    expect(e.modelsDir).toBe('C:\\data\\engine\\models')
    expect(e.installed).toBe(false)
  })
  it('у владельца — старый D:\\STT с его моделями', () => {
    const e = resolveEngine({ env, exists: only(LEGACY_ENGINE_DIR + '\\faster-whisper-xxl.exe'), dataDir })
    expect(e.source).toBe('legacy')
    expect(e.modelsDir).toBe('D:\\STT\\models')
    expect(e.installed).toBe(true)
  })
  it('своя папка из настроек главнее, если там есть exe', () => {
    const e = resolveEngine({
      env,
      exists: only('F:\\XXL\\faster-whisper-xxl.exe', LEGACY_ENGINE_DIR + '\\faster-whisper-xxl.exe'),
      dataDir,
      customDir: 'F:\\XXL'
    })
    expect(e.source).toBe('custom')
    expect(e.ffmpeg).toBe('F:\\XXL\\ffmpeg.exe')
  })
  it('своя папка без exe игнорируется', () => {
    const e = resolveEngine({ env, exists: none, dataDir, customDir: 'F:\\пусто' })
    expect(e.source).toBe('default')
  })
})

describe('resolveFfmpeg', () => {
  it('встроенный → движок → PATH', () => {
    expect(resolveFfmpeg({ bundled: 'B:\\ff.exe', engineFfmpeg: 'E:\\ff.exe', exists: only('B:\\ff.exe', 'E:\\ff.exe') })).toBe('B:\\ff.exe')
    expect(resolveFfmpeg({ bundled: 'B:\\ff.exe', engineFfmpeg: 'E:\\ff.exe', exists: only('E:\\ff.exe') })).toBe('E:\\ff.exe')
    expect(resolveFfmpeg({ bundled: null, engineFfmpeg: 'E:\\ff.exe', exists: none })).toBe('ffmpeg')
  })
})

describe('resolveOllamaExe', () => {
  it('стандартная установка с ollama.com находится', () => {
    const std = 'C:\\Users\\Анна\\AppData\\Local\\Programs\\Ollama\\ollama.exe'
    expect(resolveOllamaExe({ env, exists: only(std) })).toBe(std)
  })
  it('нет Ollama → null', () => {
    expect(resolveOllamaExe({ env, exists: none })).toBeNull()
  })
})

describe('engineCacheEnv', () => {
  it('все кэши — внутри папки моделей', () => {
    const e = engineCacheEnv('C:\\m', 'C:\\t')
    expect(e.HF_HOME).toBe('C:\\m\\hf')
    expect(e.TEMP).toBe('C:\\t')
  })
})
