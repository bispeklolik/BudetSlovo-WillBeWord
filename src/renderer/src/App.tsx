import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { Settings, Theme } from '../../shared/types'
import { api } from './api'
import { showToast, humanError } from './toast'
import { useLibrary } from './library'
import Home from './views/Home'
import Library from './views/Library'
import Editor from './views/Editor'
import Welcome from './views/Welcome'
import SettingsModal from './components/SettingsModal'
import DictationRecorder from './components/DictationRecorder'
import DictOverlay from './components/DictOverlay'
import CallRecorder from './components/CallRecorder'
import AppSidebar, { type NavPage } from './components/AppSidebar'
import NotesPane from './components/NotesPane'
import AskPanel from './components/AskPanel'
import VocabHost from './components/VocabHost'
import PhoneModal from './components/PhoneModal'
import LinkModal from './components/LinkModal'
import WatchModal from './components/WatchModal'
import { TipProvider } from './components/Tip'

type View =
  | { page: 'home' }
  | { page: 'library' }
  | { page: 'notes' }
  | { page: 'editor'; slug: string; search?: string; sec?: number; from: NavPage }

const COLLAPSED_KEY = 'slovo.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export default function App(): React.JSX.Element {
  // Окно-оверлей диктовки грузит тот же бандл с #overlay — рендерим только плашку.
  if (window.location.hash === '#overlay') return <DictOverlay />
  return <MainApp />
}

function MainApp(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [view, setView] = useState<View>({ page: 'home' })
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState<string | null>(null) // перетаскивание файла
  const [importBusy, setImportBusy] = useState<string | null>(null) // диалог «Импорт»
  const [settingsOpen, setSettingsOpen] = useState<{ section?: 'dictation' } | null>(null)
  // Мастер «С чего начнём?»: сам — при первом запуске, вручную — из настроек.
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  // Запись звонка: окно записи и полоса-подсказка «похоже, идёт звонок».
  const [callRec, setCallRec] = useState<{ app?: { appId: string; name: string } } | null>(null)
  const [callPrompt, setCallPrompt] = useState<{ appId: string; name: string } | null>(null)
  const [addModal, setAddModal] = useState<'phone' | 'link' | 'watch' | null>(null)
  const [ask, setAsk] = useState<{ folder: string | null } | null>(null)
  const [vocab, setVocab] = useState<'words' | 'modes' | null>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const refresh = useLibrary((s) => s.refresh)
  const refreshNotes = useLibrary((s) => s.refreshNotes)
  const loadFolders = useLibrary((s) => s.loadFolders)
  const watchJobs = useLibrary((s) => s.watchJobs)
  // Главная перечитывает настройки диктовки после закрытия окна настроек.
  const [settingsRev, setSettingsRev] = useState(0)
  const projects = useLibrary((s) => s.projects)

  // Библиотека: первая загрузка и фоновые обновления (телефон, папка-наблюдатель, ссылки).
  useEffect(() => {
    void refresh()
    refreshNotes()
    loadFolders()
    return api.onProjectsChanged(() => void refresh())
  }, [refresh, refreshNotes, loadFolders])

  // Очередь расшифровок — одна подписка на всё приложение.
  useEffect(() => watchJobs(), [watchJobs])

  // Конспекты сохраняют из записи, мастера, панели «Спросить» — счётчик в меню
  // освежаем при каждой смене страницы (ревью волны 7).
  useEffect(() => {
    refreshNotes()
  }, [view.page, refreshNotes])

  useEffect(
    () => api.onImportProgress((p) => setImportBusy(p.phase === 'done' ? null : p.message)),
    []
  )

  useEffect(() => {
    const off1 = api.onCallPrompt((p) => {
      if (p.open) {
        setCallPrompt(null)
        setCallRec({ app: { appId: p.appId, name: p.name } })
      } else setCallPrompt({ appId: p.appId, name: p.name })
    })
    const off2 = api.onCallRecovered((n) => {
      showToast(`Восстановлено записей звонков: ${n}. Они в списке записей.`)
      void refresh()
    })
    const off3 = api.onCallPromptGone(() => setCallPrompt(null))
    const off4 = api.onAppNotice((m) => showToast(m, 'info'))
    return () => {
      off1()
      off2()
      off3()
      off4()
    }
  }, [refresh])

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s)
      document.documentElement.dataset.theme = s.theme
    })
  }, [])

  // Название записи — в заголовке окна («Сессия 14 октября — Слово»).
  const editorSlug = view.page === 'editor' ? view.slug : null
  const editorTitle = editorSlug ? projects?.find((p) => p.slug === editorSlug)?.title : undefined
  useEffect(() => {
    document.title = editorTitle ? `${editorTitle} — Слово` : 'Слово'
  }, [editorTitle])

  const toggleCollapsed = (): void => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, v ? '0' : '1')
      } catch {
        /* без localStorage меню просто не запомнит состояние */
      }
      return !v
    })
  }

  const openRecord = (slug: string, search?: string, sec?: number): void =>
    setView((v) => ({
      page: 'editor',
      slug,
      search,
      sec,
      from: v.page === 'editor' ? v.from : v.page
    }))

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
        if (meta) {
          void refresh()
          openRecord(meta.slug)
        }
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
  }, [refresh])

  // «Импортировать запись» / «Добавить запись → Файл»: системный диалог выбора файла.
  const doImport = async (): Promise<void> => {
    setImportBusy('Открываю диалог…')
    try {
      const metas = await api.importAudio()
      if (metas && metas.length === 1) {
        void refresh()
        openRecord(metas[0].slug)
      } else if (metas && metas.length > 1) {
        void refresh()
        showToast(
          `Импортировано записей: ${metas.length}. Расшифровка запущена — записи будут готовы по очереди.`,
          'info'
        )
      }
    } catch (err) {
      showToast('Не удалось импортировать: ' + humanError(err))
    } finally {
      setImportBusy(null)
    }
  }

  const toggleTheme = async (): Promise<void> => {
    if (!settings) return
    const theme: Theme = settings.theme === 'light' ? 'dark' : 'light'
    const next = await api.setSettings({ theme })
    setSettings(next)
    document.documentElement.dataset.theme = next.theme
  }

  const showWelcome = !!settings && (welcomeOpen || !settings.onboarded)
  const navPage: NavPage = view.page === 'editor' ? view.from : view.page
  const goBack = (): void => {
    if (view.page === 'editor') setView({ page: view.from })
  }

  // Окна «Добавить запись»: живут здесь, а не на странице — первая запись с телефона
  // переключает страницу, и окно (с сервером приёма) не должно пересоздаваться
  // (ревью волны 5: телефон терял файлы 2..N).
  const openAdded = (slug: string): void => {
    setAddModal(null)
    void refresh()
    openRecord(slug)
  }

  const crumbFolder =
    view.page === 'editor' ? (projects?.find((p) => p.slug === view.slug)?.folder ?? '') : ''

  return (
    <TipProvider>
      <div className="app shell">
        <DictationRecorder />
        {!showWelcome && (
          <AppSidebar
            page={navPage}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onNavigate={(p) => setView({ page: p })}
            onRecordCall={() => setCallRec({})}
            onImport={() => void doImport()}
            importBusy={importBusy}
            onAdd={setAddModal}
            onAsk={() => setAsk({ folder: null })}
            onDictation={() => setSettingsOpen({ section: 'dictation' })}
            onVocab={setVocab}
            onSettings={() => setSettingsOpen({})}
          />
        )}
        <div className="shell-main">
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
          {showWelcome ? (
            <Welcome
              onDone={async () => {
                setSettings(await api.getSettings())
                setWelcomeOpen(false)
                setView({ page: 'home' })
                void refresh()
              }}
              onOpenProject={async (slug) => {
                setSettings(await api.getSettings())
                setWelcomeOpen(false)
                void refresh()
                setView({ page: 'editor', slug, from: 'library' })
              }}
            />
          ) : view.page === 'home' ? (
            <Home
              key={'home-' + settingsRev}
              onOpen={(slug) => openRecord(slug)}
              onOpenWelcome={() => setWelcomeOpen(true)}
              onRecordCall={() => setCallRec({})}
              onImport={() => void doImport()}
              importBusy={importBusy}
              onDictation={() => setSettingsOpen({ section: 'dictation' })}
            />
          ) : view.page === 'library' ? (
            <Library
              onOpen={openRecord}
              onOpenWelcome={() => setWelcomeOpen(true)}
              onRecordCall={() => setCallRec({})}
              onImport={() => void doImport()}
              importBusy={importBusy}
              onAdd={setAddModal}
              onAsk={(folder) => setAsk({ folder })}
            />
          ) : view.page === 'notes' ? (
            <main className="home">
              <section className="records-pane">
                <NotesPane onCountChange={refreshNotes} />
              </section>
            </main>
          ) : (
            <>
              <nav className="crumbs" aria-label="Где вы">
                <button className="btn btn-sm" onClick={goBack}>
                  <ChevronLeft size={14} aria-hidden="true" /> Назад
                </button>
                <button className="crumb-link" onClick={goBack}>
                  {view.from === 'notes' ? 'Конспекты' : view.from === 'home' ? 'Главная' : 'Записи'}
                </button>
                {view.from === 'library' && crumbFolder && (
                  <>
                    <span className="crumb-sep">/</span>
                    <button
                      className="crumb-link"
                      onClick={() => {
                        useLibrary.getState().setFolder(crumbFolder)
                        setView({ page: 'library' })
                      }}
                    >
                      {crumbFolder.split('/').join(' / ')}
                    </button>
                  </>
                )}
                {editorTitle && (
                  <>
                    <span className="crumb-sep">/</span>
                    <span className="crumb-here">{editorTitle}</span>
                  </>
                )}
              </nav>
              <Editor
                key={view.slug + ':' + (view.sec ?? '')}
                slug={view.slug}
                initialSearch={view.search}
                initialSec={view.sec}
                pauseMinSec={settings?.pauseMarkSec ?? 3}
              />
            </>
          )}
        </div>
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
              void refresh()
              openRecord(slug)
            }}
          />
        )}
        {addModal === 'phone' && <PhoneModal onOpen={openAdded} onClose={() => setAddModal(null)} />}
        {addModal === 'link' && <LinkModal onOpen={openAdded} onClose={() => setAddModal(null)} />}
        {addModal === 'watch' && <WatchModal onClose={() => setAddModal(null)} />}
        {ask && (
          <AskPanel
            mode="all"
            folder={ask.folder}
            onOpen={(slug, sec) => {
              setAsk(null)
              openRecord(slug, undefined, sec)
            }}
            onClose={() => setAsk(null)}
          />
        )}
        {vocab && <VocabHost tab={vocab} onClose={() => setVocab(null)} />}
        {settingsOpen && (
          <SettingsModal
            theme={settings?.theme ?? 'light'}
            initialSection={settingsOpen.section}
            onToggleTheme={toggleTheme}
            onClose={() => {
              setSettingsOpen(null)
              setSettingsRev((r) => r + 1)
              // Настройки могли поменять порог пауз и т.п. — подтянуть в редактор.
              void api.getSettings().then(setSettings)
            }}
            onOpenWelcome={() => {
              setSettingsOpen(null)
              setWelcomeOpen(true)
            }}
          />
        )}
      </div>
    </TipProvider>
  )
}
