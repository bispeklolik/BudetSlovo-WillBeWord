import { useEffect, useState } from 'react'
import type { Settings, Theme } from '../../shared/types'
import { api } from './api'
import Home from './views/Home'
import Editor from './views/Editor'
import Icon from './components/Icon'
import SettingsModal from './components/SettingsModal'

type View = { page: 'home' } | { page: 'editor'; slug: string; search?: string }

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [view, setView] = useState<View>({ page: 'home' })
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s)
      document.documentElement.dataset.theme = s.theme
    })
  }, [])

  // Перетаскивание файла в окно → импорт и сразу расшифровка (без диалога).
  useEffect(() => {
    // Реагируем только на перетаскивание файлов из ОС, а не на внутренние
    // перетаскивания карточек (у тех нет типа 'Files').
    const isFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types?.includes('Files')
    const onDragOver = (e: DragEvent): void => {
      if (!isFiles(e)) return
      e.preventDefault()
      setDragging(true)
    }
    const onDragLeave = (e: DragEvent): void => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const onDrop = async (e: DragEvent): Promise<void> => {
      if (!isFiles(e)) return
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      const path = api.getPathForFile(file)
      if (!path) {
        alert('Не удалось определить путь к файлу.')
        return
      }
      setImporting('Импортирую…')
      try {
        const meta = await api.importPath(path)
        // Открываем редактор — там панель выбора параметров расшифровки (диалог),
        // после которой пользователь сам запускает расшифровку.
        if (meta) setView({ page: 'editor', slug: meta.slug })
      } catch (err) {
        alert('Не удалось импортировать: ' + String(err))
      } finally {
        setImporting(null)
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
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
        <span className="app-brand">
          <span className="app-logo" aria-hidden="true">
            <Icon name="wave" size={17} />
          </span>
          <span className="app-title">Слово</span>
        </span>
        <span className="app-sub">локальные расшифровки</span>
        <div style={{ marginLeft: 'auto' }}>
          <button
            className="btn btn-icon"
            onClick={() => setSettingsOpen(true)}
            title="Настройки"
            data-testid="settings-btn"
          >
            <Icon name="settings" size={18} />
          </button>
        </div>
      </header>
      {view.page === 'home' ? (
        <Home onOpen={(slug, search) => setView({ page: 'editor', slug, search })} />
      ) : (
        <Editor slug={view.slug} initialSearch={view.search} />
      )}
      {(dragging || importing) && (
        <div className="drop-overlay">
          <div className="drop-overlay-box">
            {importing ?? 'Отпустите файл, чтобы импортировать'}
          </div>
        </div>
      )}
      {settingsOpen && (
        <SettingsModal
          theme={settings?.theme ?? 'light'}
          onToggleTheme={toggleTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
