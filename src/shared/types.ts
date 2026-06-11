export type Theme = 'light' | 'dark'

export interface Settings {
  theme: Theme
}

export const defaultSettings: Settings = { theme: 'light' }
