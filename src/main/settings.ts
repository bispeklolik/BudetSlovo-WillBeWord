import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import type { Settings } from '../shared/types'
import { defaultSettings } from '../shared/types'

export const DATA_DIR = 'D:\\Apps\\slovo-data'
const FILE = join(DATA_DIR, 'settings.json')

export function loadSettings(): Settings {
  try {
    return { ...defaultSettings, ...JSON.parse(readFileSync(FILE, 'utf8')) }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(s: Settings): void {
  mkdirSync(DATA_DIR, { recursive: true })
  const tmp = FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8')
  renameSync(tmp, FILE)
}
