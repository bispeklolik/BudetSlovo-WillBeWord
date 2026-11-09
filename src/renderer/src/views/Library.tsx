import { useEffect, useRef, useState } from 'react'
import { AudioLines, Pencil, FolderInput, X, Search, TriangleAlert } from 'lucide-react'
import type { ProjectMeta, Note } from '../../../shared/types'
import { searchProjects } from '../../../shared/search'
import { api } from '../api'
import { showToast, humanError } from '../toast'
import { onActivate } from '../activate'
import { useLibrary, folderPaths, folderCount, SLUG_TYPE } from '../library'
import EngineStatus from '../components/EngineStatus'
import QueueStrip from '../components/QueueStrip'
import InputModal from '../components/InputModal'
import MoveModal from '../components/MoveModal'
import NoteViewer from '../components/NoteViewer'
import AddMenu from '../components/AddMenu'
import { Skeleton } from '../components/Skeleton'
import { useSectionHints } from '../tour/TourProvider'

// Страница «Записи» (бывший Home): панель кнопок, поиск, очередь, карточки
// выбранной папки. Дерево папок переехало в боковое меню (AppShell).

function fmtDuration(sec: number): string {
  const t = Math.floor(sec)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}



type Modal =
  | { kind: 'renameRecord'; p: ProjectMeta }
  | { kind: 'moveRecord'; p: ProjectMeta }
  | null

export default function Library({
  onOpen,
  onOpenWelcome,
  onRecordCall,
  onImport,
  importBusy,
  onAdd,
  onAsk
}: {
  onOpen: (slug: string, search?: string, sec?: number) => void
  onOpenWelcome: () => void
  onRecordCall: () => void
  onImport: () => void
  importBusy: string | null
  onAdd: (kind: 'phone' | 'link' | 'watch') => void
  onAsk: (folder: string | null) => void
}): React.JSX.Element {
  const projects = useLibrary((s) => s.projects)
  const error = useLibrary((s) => s.error)
  const folder = useLibrary((s) => s.folder)
  const folderList = useLibrary((s) => s.folderList)
  const refresh = useLibrary((s) => s.refresh)
  const refreshNotes = useLibrary((s) => s.refreshNotes)
  const moveRecord = useLibrary((s) => s.moveRecord)

  const [gq, setGq] = useState('') // глобальный поиск
  const [modal, setModal] = useState<Modal>(null)
  const [dyn, setDyn] = useState<{ phase: string } | null>(null)
  const [resultNote, setResultNote] = useState<Note | null>(null)
  // Ушли со страницы, пока ИИ считал динамику, — результат не теряем молча (ревью волны 7).
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const list = projects ?? []
  const count = (path: string): number => folderCount(list, path)

  const records = list
    .filter((p) => (p.folder ?? '') === folder)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const hits = gq.trim() ? searchProjects(list, gq) : null

  // Динамика клиента: выжимка каждой сессии папки → что меняется от сессии к сессии.
  const runDynamics = async (): Promise<void> => {
    if (dyn) return
    setDyn({ phase: 'Готовлю' })
    const off = api.onAiProgress((p) => setDyn({ phase: p.phase }))
    try {
      const note = await api.clientDynamics(folder)
      refreshNotes()
      if (mounted.current) setResultNote(note)
      else showToast('Динамика клиента готова — она в «Конспектах».', 'info')
    } catch (e) {
      showToast('Динамика не получилась: ' + humanError(e))
    } finally {
      off()
      setDyn(null)
    }
  }

  const renameRecord = async (slug: string, name: string): Promise<void> => {
    await api.renameProject(slug, name)
    await refresh()
    setModal(null)
  }
  const doMove = async (slug: string, dest: string): Promise<void> => {
    await moveRecord(slug, dest)
    setModal(null)
  }

  useSectionHints('library', !!projects && projects.length > 0)

  // Пока список не пришёл — скелетон, а не «Добро пожаловать» (мерцание первого кадра).
  if (projects === null) {
    return (
      <main className="home" aria-busy={!error}>
        {error ? (
          <div className="empty">
            <TriangleAlert size={28} aria-hidden="true" />
            <div className="empty-title">Не удалось загрузить записи</div>
            <div>{error}</div>
            <button className="btn btn-primary" onClick={() => void refresh()}>
              Повторить
            </button>
          </div>
        ) : (
          <div className="page-skeleton" aria-label="Загружаю записи">
            <Skeleton height={36} width={320} />
            <div className="project-grid" style={{ padding: 0 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} height={92} radius={12} />
              ))}
            </div>
          </div>
        )}
      </main>
    )
  }

  // Первый запуск: ни одной записи — приветствие.
  if (projects.length === 0) {
    return (
      <main className="home">
        <div className="empty welcome">
          <div className="welcome-badge">
            <AudioLines size={32} />
          </div>
          <div className="empty-title">Добро пожаловать в «Слово»</div>
          <div className="welcome-sub">
            Превращаю запись разговора в текст и готовые результаты: конспект, заметку, письмо.
          </div>
          <EngineStatus onOpenWelcome={onOpenWelcome} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={onImport}
              disabled={importBusy !== null}
              data-testid="import-btn"
            >
              {importBusy ?? 'Импортировать запись'}
            </button>
            <button className="btn" onClick={onRecordCall}>
              Записать звонок
            </button>
            <AddMenu
              onPhone={() => onAdd('phone')}
              onLink={() => onAdd('link')}
              onWatch={() => onAdd('watch')}
            />
          </div>
          <div className="welcome-hint">или перетащите файл аудио/видео прямо в это окно</div>
        </div>
      </main>
    )
  }

  const folderTitle = folder === '' ? 'Все записи' : folder.split('/').pop()

  return (
    <main className="home">
      <div className="home-toolbar">
        <button
          className="btn btn-primary"
          onClick={onImport}
          disabled={importBusy !== null}
          data-testid="import-btn"
          data-tour="lib-import"
        >
          {importBusy ?? 'Импортировать запись'}
        </button>
        <button className="btn" onClick={onRecordCall}>
          Записать звонок
        </button>
        <AddMenu
          onPhone={() => onAdd('phone')}
          onLink={() => onAdd('link')}
          onWatch={() => onAdd('watch')}
        />
        <button
          className="btn"
          data-tour="lib-ask"
          onClick={() => onAsk(folder || null)}
          title="Вопрос по всем записям — ответ со ссылками"
        >
          Спросить записи
        </button>
        <div className="global-search" data-tour="lib-search">
          <Search size={16} aria-hidden="true" />
          <input
            className="global-search-input"
            placeholder="Поиск по всем записям…"
            aria-label="Поиск по всем записям"
            value={gq}
            onChange={(e) => setGq(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setGq('')
            }}
          />
          {gq && (
            <button className="btn-icon" onClick={() => setGq('')} title="Очистить" aria-label="Очистить">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <EngineStatus onOpenWelcome={onOpenWelcome} />
      <QueueStrip />

      <div className="home-body">
        <section className="records-pane">
          {hits ? (
            <>
              <div className="pane-head">Найдено записей: {hits.length}</div>
              {hits.length === 0 ? (
                <div className="empty">
                  <div className="empty-title">Ничего не найдено</div>
                  <div>Попробуйте другое слово</div>
                </div>
              ) : (
                <div className="result-list">
                  {hits.map((h) => (
                    <button
                      key={h.slug}
                      className="result-item"
                      onClick={() => onOpen(h.slug, gq.trim())}
                    >
                      <div className="result-item-title">
                        <span>{h.title}</span>
                        <span className="result-count">{h.count}</span>
                      </div>
                      <div className="result-snippet">{h.snippet}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="pane-head">
                {folderTitle} <span className="pane-count">{records.length}</span>
                {folder !== '' && (
                  <button
                    className="btn btn-sm"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => void runDynamics()}
                    disabled={!!dyn || count(folder) < 2}
                    title={
                      count(folder) < 2
                        ? 'Нужны хотя бы две записи в папке'
                        : 'Что меняется у клиента от сессии к сессии — по всем записям папки'
                    }
                  >
                    {dyn ? dyn.phase + '…' : 'Динамика клиента'}
                  </button>
                )}
              </div>
              {records.length === 0 ? (
                <div className="empty">
                  <div className="empty-title">В этой папке пока нет записей</div>
                  <div>Перетащите сюда запись или переместите её кнопкой «папка» на карточке</div>
                </div>
              ) : (
                <div className="project-grid" data-tour="lib-cards">
                  {records.map((p) => (
                    <div
                      key={p.slug}
                      className="project-card"
                      role="button"
                      tabIndex={0}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(SLUG_TYPE, p.slug)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onClick={() => onOpen(p.slug)}
                      onKeyDown={onActivate(() => onOpen(p.slug))}
                    >
                      <div className="project-card-title">{p.title}</div>
                      <div className="project-card-meta">
                        {fmtDuration(p.audio.durationSec)} · {fmtDate(p.createdAt)}
                      </div>
                      <div className="card-actions">
                        <button
                          title="Переименовать"
                          aria-label="Переименовать запись"
                          onClick={(e) => {
                            e.stopPropagation()
                            setModal({ kind: 'renameRecord', p })
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          title="Переместить в папку"
                          aria-label="Переместить в папку"
                          onClick={(e) => {
                            e.stopPropagation()
                            setModal({ kind: 'moveRecord', p })
                          }}
                        >
                          <FolderInput size={15} />
                        </button>
                        <button
                          title="Удалить запись"
                          aria-label="Удалить запись"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (
                              window.confirm(
                                `Удалить запись «${p.title}»? Она переедет в Корзину — можно восстановить.`
                              )
                            ) {
                              api.deleteProject(p.slug).then(() => void refresh())
                            }
                          }}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {resultNote && (
        <NoteViewer note={resultNote} onClose={() => setResultNote(null)} onChanged={refreshNotes} />
      )}
      {modal?.kind === 'renameRecord' && (
        <InputModal
          title="Переименовать запись"
          initial={modal.p.title}
          submitLabel="Сохранить"
          onSubmit={(n) => void renameRecord(modal.p.slug, n)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'moveRecord' && (
        <MoveModal
          folders={folderPaths(list, folderList)}
          current={modal.p.folder}
          onPick={(d) => void doMove(modal.p.slug, d)}
          onClose={() => setModal(null)}
        />
      )}
    </main>
  )
}
