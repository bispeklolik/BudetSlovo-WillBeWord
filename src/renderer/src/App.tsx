import { useEffect, useState } from 'react'
import type { Settings, Theme } from '../../shared/types'
import { api } from './api'

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s)
      document.documentElement.dataset.theme = s.theme
    })
  }, [])

  const toggleTheme = async (): Promise<void> => {
    if (!settings) return
    const theme: Theme = settings.theme === 'light' ? 'dark' : 'light'
    const next = await api.setSettings({ theme })
    setSettings(next)
    document.documentElement.dataset.theme = next.theme
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Слово</span>
        <span className="app-sub">локальные расшифровки</span>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn" onClick={toggleTheme} data-testid="theme-toggle">
            {settings?.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          </button>
        </div>
      </header>
      <main className="empty">
        <div className="empty-title">Пока пусто</div>
        <div>Импорт записей появится на следующем шаге (Фаза 1)</div>
      </main>
    </div>
  )
}
