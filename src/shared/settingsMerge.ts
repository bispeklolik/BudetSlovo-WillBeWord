import type { Settings } from './types'
import { defaultSettings } from './types'

// Значения по умолчанию для движков стали облачными (с версии волны 7). Но у
// тех, кто пользовался программой раньше, поле могло не быть записано явно, и
// тогда они молча получили бы облако без ключа. Поэтому для уже существующих
// настроек недостающие поля движков берут ПРЕЖНИЕ значения — локальные.
export const LEGACY_ENGINE_DEFAULTS: Pick<Settings, 'sttEngine' | 'aiEngine'> = {
  sttEngine: 'local',
  aiEngine: 'local-llama'
}

/**
 * stored — разобранное содержимое settings.json (null — не прочиталось).
 * fileExisted — файл на диске был. Нет файла = новый человек = облако.
 * Файл есть, но битый = не новый человек = прежние локальные значения.
 */
export function mergeStoredSettings(stored: unknown, fileExisted: boolean): Settings {
  if (!fileExisted) return { ...defaultSettings }
  const obj = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Partial<Settings>) : {}
  return { ...defaultSettings, ...LEGACY_ENGINE_DEFAULTS, ...obj }
}
