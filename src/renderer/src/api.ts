import type { Settings } from '../../shared/types'
import { defaultSettings } from '../../shared/types'

// В Electron window.api приходит из preload. В обычном браузере (превью UI)
// работаем на заглушке, чтобы интерфейс можно было открыть без Electron.
let memory: Settings = { ...defaultSettings }

export const api = window.api ?? {
  getSettings: async (): Promise<Settings> => memory,
  setSettings: async (patch: Partial<Settings>): Promise<Settings> => {
    memory = { ...memory, ...patch }
    return memory
  }
}
