import { useEffect, useState } from 'react'
import type { Settings, Theme } from '../../shared/types'
import { api } from './api'
import Home from './views/Home'
import Editor from './views/Editor'

type View = { page: 'home' } | { page: 'editor'; slug: string }

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [view, setView] = useState<View>({ page: 'home' })

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
        {view.page === 'editor' && (
          <button className="btn" onClick={() => setView({ page: 'home' })}>
            ← Назад
          </button>
        )}
        <span className="app-title">Слово</span>
        <span className="app-sub">локальные расшифровки</span>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn" onClick={toggleTheme} data-testid="theme-toggle">
            {settings?.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          </button>
        </div>
      </header>
      {view.page === 'home' ? (
        <Home onOpen={(slug) => setView({ page: 'editor', slug })} />
      ) : (
        <Editor slug={view.slug} />
      )}
    </div>
  )
}
