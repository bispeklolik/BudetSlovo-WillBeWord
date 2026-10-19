import { useEffect, useState } from 'react'
import type { Settings, Theme } from '../../shared/types'
import { api } from './api'
import { showToast, humanError } from './toast'
import Home from './views/Home'
import Editor from './views/Editor'
import Welcome from './views/Welcome'
import Icon from './components/Icon'
import SettingsModal from './components/SettingsModal'
import DictationRecorder from './components/DictationRecorder'
import DictOverlay from './components/DictOverlay'
import CallRecorder from './components/CallRecorder'

type View = { page: 'home' } | { page: 'editor'; slug: string; search?: string; sec?: number }

export default function App(): React.JSX.Element {
  // Окно-оверлей диктовки грузит тот же бандл с #overlay — рендерим только плашку.
  if (window.location.hash === '#overlay') return <DictOverlay />
  return <MainApp />
}

function MainApp(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [view, setView] = useState<View>({ page: 'home' })
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Мастер «С чего начнём?»: сам — при первом запуске, вручную — из настроек.
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  // Запись звонка: окно записи и полоса-подсказка «похоже, идёт звонок».
  const [callRec, setCallRec] = useState<{ app?: { appId: string; name: string } } | null>(null)
  const [callPrompt, setCallPrompt] = useState<{ appId: string; name: string } | null>(null)
  const [homeKey, setHomeKey] = useState(0)

  useEffect(() => {
    const off1 = api.onCallPrompt((p) => {
      if (p.open) {
        setCallPrompt(null)
        setCallRec({ app: { appId: p.appId, name: p.name } })
      } else setCallPrompt({ appId: p.appId, name: p.name })
    })
    const off2 = api.onCallRecovered((n) => {
      showToast(`Восстановлено записей звонков: ${n}. Они в списке записей.`)
      setHomeKey((k) => k + 1)
    })
    const off3 = api.onCallPromptGone(() => setCallPrompt(null))
    const off4 = api.onAppNotice((m) => showToast(m, 'info'))
    return () => {
      off1()
      off2()
      off3()
      off4()
    }
  }, [])

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
        showToast('Не удалось определить путь к файлу.')
        return
      }
      setImporting('Импортирую…')
      try {
        const meta = await api.importPath(path)
        // Открываем редактор — там панель выбора параметров расшифровки (диалог),
        // после которой пользователь сам запускает расшифровку.
        if (meta) setView({ page: 'editor', slug: meta.slug })
      } catch (err) {
        showToast('Не удалось импортировать: ' + humanError(err))
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
      <DictationRecorder />
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
        <span className="app-sub">разговор → результат</span>
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
      {callPrompt && !callRec && (
        <div className="call-prompt">
          <span>Похоже, идёт звонок в {callPrompt.name}. Записать разговор?</span>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              setCallRec({ app: callPrompt })
              setCallPrompt(null)
            }}
          >
            Записать
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              setCallPrompt(null)
              void api.callSnooze()
            }}
          >
            Не сейчас
          </button>
        </div>
      )}
      {settings && (welcomeOpen || !settings.onboarded) ? (
        <Welcome
          onDone={async () => {
            setSettings(await api.getSettings())
            setWelcomeOpen(false)
            setView({ page: 'home' })
          }}
          onOpenProject={async (slug) => {
            setSettings(await api.getSettings())
            setWelcomeOpen(false)
            setView({ page: 'editor', slug })
          }}
        />
      ) : view.page === 'home' ? (
        <Home
          key={homeKey}
          onOpen={(slug, search, sec) => setView({ page: 'editor', slug, search, sec })}
          onOpenWelcome={() => setWelcomeOpen(true)}
          onRecordCall={() => setCallRec({})}
        />
      ) : (
        <Editor
          key={view.slug + ':' + (view.sec ?? '')}
          slug={view.slug}
          initialSearch={view.search}
          initialSec={view.sec}
          pauseMinSec={settings?.pauseMarkSec ?? 3}
        />
      )}
      {(dragging || importing) && (
        <div className="drop-overlay">
          <div className="drop-overlay-box">
            {importing ?? 'Отпустите файл, чтобы импортировать'}
          </div>
        </div>
      )}
      {callRec && (
        <CallRecorder
          app={callRec.app}
          onClose={() => setCallRec(null)}
          onDone={(slug) => {
            setCallRec(null)
            setView({ page: 'editor', slug })
          }}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          theme={settings?.theme ?? 'light'}
          onToggleTheme={toggleTheme}
          onClose={() => {
            setSettingsOpen(false)
            // Настройки могли поменять порог пауз и т.п. — подтянуть в редактор.
            void api.getSettings().then(setSettings)
          }}
          onOpenWelcome={() => {
            setSettingsOpen(false)
            setWelcomeOpen(true)
          }}
        />
      )}
    </div>
  )
}
