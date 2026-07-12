import { useEffect, useState } from 'react'
import type { ProjectMeta } from '../../../shared/types'
import { searchProjects } from '../../../shared/search'
import { buildFolderTree, ancestorPaths } from '../../../shared/folders'
import { api } from '../api'
import Icon from '../components/Icon'
import Sidebar, { NOTES_KEY } from '../components/Sidebar'
import InputModal from '../components/InputModal'
import MoveModal from '../components/MoveModal'
import NotesPane from '../components/NotesPane'

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

const SLUG_TYPE = 'text/slovo-slug'

type Modal =
  | { kind: 'createFolder' }
  | { kind: 'renameFolder'; path: string }
  | { kind: 'renameRecord'; p: ProjectMeta }
  | { kind: 'moveRecord'; p: ProjectMeta }
  | null

export default function Home({
  onOpen
}: {
  onOpen: (slug: string, search?: string) => void
}): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [folderList, setFolderList] = useState<string[]>([])
  const [notesCount, setNotesCount] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [folder, setFolder] = useState('') // '' = корень, '@notes' = конспекты, иначе путь
  const [gq, setGq] = useState('') // глобальный поиск
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>(null)

  const refresh = (): void => {
    api.listProjects().then(setProjects)
  }
  const refreshNotes = (): void => {
    api.listNotes().then((n) => setNotesCount(n.length))
  }
  useEffect(refresh, [])
  useEffect(refreshNotes, [])
  useEffect(() => {
    api.getSettings().then((s) => setFolderList(s.folders ?? []))
  }, [])
  useEffect(() => api.onImportProgress((p) => setBusy(p.phase === 'done' ? null : p.message)), [])

  const persistFolders = async (next: string[]): Promise<void> => {
    setFolderList(next)
    await api.setSettings({ folders: next })
  }

  const doImport = async (): Promise<void> => {
    setBusy('Открываю диалог…')
    try {
      const metas = await api.importAudio()
      if (metas && metas.length === 1) {
        refresh()
        onOpen(metas[0].slug)
      } else if (metas && metas.length > 1) {
        refresh()
        alert(
          `Импортировано записей: ${metas.length}. Расшифровка запущена — записи будут готовы по очереди.`
        )
      }
    } catch (err) {
      alert('Не удалось импортировать: ' + String(err))
    } finally {
      setBusy(null)
    }
  }

  // --- дерево папок: явные + выведенные из записей + все предки ---
  const allPaths = new Set<string>(folderList)
  for (const p of projects) if (p.folder) allPaths.add(p.folder)
  const withAnc = [...ancestorPaths([...allPaths])]
  const tree = buildFolderTree(withAnc)
  const count = (path: string): number =>
    projects.filter((p) => {
      const f = p.folder ?? ''
      return f === path || f.startsWith(path + '/')
    }).length

  const records = projects
    .filter((p) => (p.folder ?? '') === folder)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const hits = gq.trim() ? searchProjects(projects, gq) : null

  // --- действия с папками ---
  const createFolder = (name: string): void => {
    const base = folder && folder !== NOTES_KEY ? folder + '/' : ''
    const np = base + name
    if (!folderList.includes(np)) void persistFolders([...folderList, np])
    setFolder(np)
    setModal(null)
  }
  const renameFolder = async (oldPath: string, newName: string): Promise<void> => {
    const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/') + 1) : ''
    const np = parent + newName
    if (np === oldPath) {
      setModal(null)
      return
    }
    await api.renameFolder(oldPath, np) // переписывает префиксы у записей
    const nl = folderList.map((f) =>
      f === oldPath ? np : f.startsWith(oldPath + '/') ? np + f.slice(oldPath.length) : f
    )
    await persistFolders(nl)
    if (folder === oldPath || folder.startsWith(oldPath + '/')) setFolder(np + folder.slice(oldPath.length))
    refresh()
    setModal(null)
  }
  const deleteFolder = (path: string): void => {
    if (count(path) > 0) {
      alert('В папке есть записи. Сначала переместите их в другую папку.')
      return
    }
    void persistFolders(folderList.filter((f) => f !== path && !f.startsWith(path + '/')))
    if (folder === path || folder.startsWith(path + '/')) setFolder('')
  }

  // --- действия с записями ---
  const renameRecord = async (slug: string, name: string): Promise<void> => {
    await api.renameProject(slug, name)
    refresh()
    setModal(null)
  }
  const moveRecord = async (slug: string, dest: string): Promise<void> => {
    await api.setFolder(slug, dest)
    refresh()
    setModal(null)
  }

  // --- перетаскивание записи на папку дерева ---
  const allowDrop = (e: React.DragEvent, key: string): void => {
    if (e.dataTransfer.types.includes(SLUG_TYPE)) {
      e.preventDefault()
      if (dropKey !== key) setDropKey(key)
    }
  }
  const dropRecord = (e: React.DragEvent, dest: string): void => {
    e.preventDefault()
    setDropKey(null)
    const slug = e.dataTransfer.getData(SLUG_TYPE)
    if (slug) {
      const cur = projects.find((p) => p.slug === slug)
      if (cur && (cur.folder ?? '') !== dest) void moveRecord(slug, dest)
    }
  }

  // Первый запуск: ни одной записи — приветствие.
  if (projects.length === 0) {
    return (
      <main className="home">
        <div className="empty welcome">
          <div className="welcome-badge">
            <Icon name="wave" size={32} />
          </div>
          <div className="empty-title">Добро пожаловать в «Слово»</div>
          <div className="welcome-sub">
            Превращаю аудио и видео в текст — целиком на вашем компьютере. Записи никуда не
            загружаются, всё остаётся у вас.
          </div>
          <button
            className="btn btn-primary"
            onClick={doImport}
            disabled={busy !== null}
            data-testid="import-btn"
          >
            {busy ?? 'Импортировать запись'}
          </button>
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
          onClick={doImport}
          disabled={busy !== null}
          data-testid="import-btn"
        >
          {busy ?? 'Импортировать запись'}
        </button>
        <div className="global-search">
          <Icon name="search" size={16} />
          <input
            className="global-search-input"
            placeholder="Поиск по всем записям…"
            value={gq}
            onChange={(e) => setGq(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setGq('')
            }}
          />
          {gq && (
            <button className="btn-icon" onClick={() => setGq('')} title="Очистить">
              <Icon name="x" size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="home-body">
        <Sidebar
          tree={tree}
          selected={folder}
          totalCount={projects.length}
          notesCount={notesCount}
          count={count}
          dropKey={dropKey}
          onSelect={setFolder}
          onCreateFolder={() => setModal({ kind: 'createFolder' })}
          onRenameFolder={(path) => setModal({ kind: 'renameFolder', path })}
          onDeleteFolder={deleteFolder}
          onAllowDrop={allowDrop}
          onDragLeave={() => setDropKey(null)}
          onDropRecord={dropRecord}
        />

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
          ) : folder === NOTES_KEY ? (
            <NotesPane onCountChange={setNotesCount} />
          ) : (
            <>
              <div className="pane-head">
                {folderTitle} <span className="pane-count">{records.length}</span>
              </div>
              {records.length === 0 ? (
                <div className="empty">
                  <div className="empty-title">В этой папке пока нет записей</div>
                  <div>Перетащите сюда запись или переместите её кнопкой «папка» на карточке</div>
                </div>
              ) : (
                <div className="project-grid">
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
                      onDragEnd={() => setDropKey(null)}
                      onClick={() => onOpen(p.slug)}
                    >
                      <div className="project-card-title">{p.title}</div>
                      <div className="project-card-meta">
                        {fmtDuration(p.audio.durationSec)} · {fmtDate(p.createdAt)}
                      </div>
                      <div className="card-actions">
                        <button
                          title="Переименовать"
                          onClick={(e) => {
                            e.stopPropagation()
                            setModal({ kind: 'renameRecord', p })
                          }}
                        >
                          <Icon name="edit" />
                        </button>
                        <button
                          title="Переместить в папку"
                          onClick={(e) => {
                            e.stopPropagation()
                            setModal({ kind: 'moveRecord', p })
                          }}
                        >
                          <Icon name="folder" />
                        </button>
                        <button
                          title="Удалить запись"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (
                              window.confirm(
                                `Удалить запись «${p.title}»? Она переедет в Корзину — можно восстановить.`
                              )
                            ) {
                              api.deleteProject(p.slug).then(refresh)
                            }
                          }}
                        >
                          <Icon name="x" />
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

      {modal?.kind === 'createFolder' && (
        <InputModal
          title="Новая папка"
          label={folder && folder !== NOTES_KEY ? `Внутри «${folderTitle}»` : 'В корне'}
          placeholder="Название папки"
          submitLabel="Создать"
          onSubmit={createFolder}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'renameFolder' && (
        <InputModal
          title="Переименовать папку"
          initial={modal.path.split('/').pop()}
          submitLabel="Сохранить"
          onSubmit={(n) => void renameFolder(modal.path, n)}
          onClose={() => setModal(null)}
        />
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
          folders={withAnc}
          current={modal.p.folder}
          onPick={(d) => void moveRecord(modal.p.slug, d)}
          onClose={() => setModal(null)}
        />
      )}
    </main>
  )
}
