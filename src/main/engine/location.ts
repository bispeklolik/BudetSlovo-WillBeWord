import { existsSync } from 'fs'
import { sep } from 'path'
import { DATA_DIR } from '../paths'
import { loadSettings } from '../settings'
import { resolveEngine, resolveFfmpeg, engineCacheEnv, type EnginePaths } from '../pathsResolve'

// Где сейчас локальный движок расшифровки и ffmpeg. Считаем при каждом вызове:
// движок мог только что докачаться, а пользователь — сменить папку в настройках.

let bundledFfmpeg: string | null | undefined

function bundled(): string | null {
  if (bundledFfmpeg !== undefined) return bundledFfmpeg
  try {
    // В установщике бинарник распакован рядом с app.asar (asarUnpack).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static') as string | null
    bundledFfmpeg = p ? p.replace('app.asar' + sep, 'app.asar.unpacked' + sep) : null
  } catch {
    bundledFfmpeg = null
  }
  return bundledFfmpeg
}

export function enginePaths(): EnginePaths {
  return resolveEngine({
    env: process.env,
    exists: existsSync,
    dataDir: DATA_DIR,
    customDir: loadSettings().engineDir
  })
}

export function ffmpegPath(): string {
  return resolveFfmpeg({ bundled: bundled(), engineFfmpeg: enginePaths().ffmpeg, exists: existsSync })
}

export function engineEnv(): NodeJS.ProcessEnv {
  const e = enginePaths()
  return { ...process.env, ...engineCacheEnv(e.modelsDir, e.temp) }
}
