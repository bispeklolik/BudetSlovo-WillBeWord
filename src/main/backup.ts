import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'

// Резервная копия всех данных одной кнопкой (как «скопируй одну папку» у
// Superwhisper, но одним файлом .zip). Внутрь идёт всё из папки данных, КРОМЕ
// тяжёлого и восстановимого: модели ИИ, движок, профиль браузера, временные.
// Архиватор — встроенный в Windows 10/11 tar.exe (bsdtar умеет zip), без
// лишних зависимостей. Берём его по полному пути: tar из Git в PATH zip не умеет.

const SKIP = new Set(['electron', 'models', 'engine', 'temp', 'download'])
const SKIP_PREFIX = ['_before-restore-', '.restore-tmp']

/** Что из папки данных кладём в копию. */
export function backupItems(names: string[]): string[] {
  return names.filter(
    (n) => !SKIP.has(n) && !SKIP_PREFIX.some((p) => n.startsWith(p)) && !n.endsWith('.tmp')
  )
}

function tarExe(): string {
  const sys = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  if (!existsSync(sys)) throw new Error('В Windows не найден архиватор tar.exe (нужна Windows 10 1803 или новее).')
  return sys
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tarExe(), args, { windowsHide: true })
    let err = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (s: string) => (err += s))
    child.on('error', (e) => reject(e))
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Архиватор завершился с ошибкой (${code}). ${err.slice(0, 300)}`))
    )
  })
}

export async function createBackup(dataDir: string, dest: string): Promise<{ items: number; bytes: number }> {
  const items = backupItems(existsSync(dataDir) ? readdirSync(dataDir) : [])
  if (!items.length) throw new Error('В папке данных пока нечего сохранять.')
  rmSync(dest, { force: true })
  // -a: формат по расширению (.zip); -C: пути внутри архива — относительно папки данных.
  await runTar(['-a', '-c', '-f', dest, '-C', dataDir, ...items])
  return { items: items.length, bytes: statSync(dest).size }
}

/**
 * Восстановить из копии. Текущие версии тех же файлов не удаляются, а
 * откладываются в _before-restore-<время> — ошибку можно откатить руками.
 */
export async function restoreBackup(dataDir: string, zip: string): Promise<{ restored: string[]; savedTo: string }> {
  const tmp = join(dataDir, '.restore-tmp')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  try {
    await runTar(['-x', '-f', zip, '-C', tmp])
    const names = backupItems(readdirSync(tmp))
    if (!names.includes('settings.json') && !names.includes('projects') && !names.includes('notes.json')) {
      throw new Error('Это не похоже на копию «Слова»: внутри нет записей, конспектов и настроек.')
    }
    // Местное время в имени папки: «_before-restore-2026-10-20 00-08-02».
    const stamp = new Date().toLocaleString('sv-SE').replace(/:/g, '-')
    const savedTo = join(dataDir, `_before-restore-${stamp}`)
    mkdirSync(savedTo, { recursive: true })
    for (const n of names) {
      const cur = join(dataDir, n)
      if (existsSync(cur)) renameSync(cur, join(savedTo, n))
      renameSync(join(tmp, n), cur)
    }
    return { restored: names, savedTo }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
