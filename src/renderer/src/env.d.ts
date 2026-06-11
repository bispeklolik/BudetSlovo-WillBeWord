/// <reference types="vite/client" />
import type { Settings } from '../../shared/types'

declare global {
  interface Window {
    api?: {
      getSettings: () => Promise<Settings>
      setSettings: (patch: Partial<Settings>) => Promise<Settings>
    }
  }
}

export {}
