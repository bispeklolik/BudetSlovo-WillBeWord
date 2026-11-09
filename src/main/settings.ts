import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import type { Settings } from '../shared/types'
import { mergeStoredSettings } from '../shared/settingsMerge'
import { DATA_DIR } from './paths'

export { DATA_DIR }
const FILE = join(DATA_DIR, 'settings.json')

export function loadSettings(): Settings {
  // Файла нет — новый человек (облачные значения по умолчанию). Файл есть —
  // прежний выбор сохраняется, см. mergeStoredSettings.
  if (!existsSync(FILE)) return mergeStoredSettings(null, false)
  try {
    return mergeStoredSettings(JSON.parse(readFileSync(FILE, 'utf8')), true)
  } catch {
    return mergeStoredSettings(null, true)
  }
}

export function saveSettings(s: Settings): void {
  mkdirSync(DATA_DIR, { recursive: true })
  const tmp = FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8')
  renameSync(tmp, FILE)
}
