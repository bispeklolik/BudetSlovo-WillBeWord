import { useEffect, useState } from 'react'
import type { ProjectMeta } from '../../../shared/types'
import { api } from '../api'
import Icon from '../components/Icon'

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

export default function Home({ onOpen }: { onOpen: (slug: string) => void }): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [folder, setFolder] = useState('') // текущая папка; '' = корень
  const [dropKey, setDropKey] = useState<string | null>(null) // куда сейчас «целится» перетаскивание

  const refresh = (): void => {
    api.listProjects().then(setProjects)
  }

  useEffect(refresh, [])
  useEffect(() => api.onImportProgress((p) => setBusy(p.phase === 'done' ? null : p.message)), [])

  const doImport = async (): Promise<void> => {
    setBusy('Открываю диалог…')
    try {
      const meta = await api.importAudio()
      if (meta) {
        refresh()
        onOpen(meta.slug)
      }
    } catch (err) {
      alert('Не удалось импортировать: ' + String(err))
    } finally {
      setBusy(null)
    }
  }

  const rename = async (e: React.MouseEvent, p: ProjectMeta): Promise<void> => {
    e.stopPropagation()
    const name = window.prompt('Новое название записи:', p.title)
    if (name && name.trim() && name.trim() !== p.title) {
      await api.renameProject(p.slug, name.trim())
      refresh()
    }
  }

  const move = async (e: React.MouseEvent, p: ProjectMeta): Promise<void> => {
    e.stopPropagation()
    const f = window.prompt(
      'В какую папку положить? Например «Консультации/Ева». Пусто = в корень.',
      p.folder ?? ''
    )
    if (f !== null) {
      await api.setFolder(p.slug, f.trim())
      refresh()
    }
  }

  const renameFolder = async (e: React.MouseEvent, seg: string): Promise<void> => {
    e.stopPropagation()
    const name = window.prompt('Новое название папки:', seg)
    if (name && name.trim() && name.trim() !== seg) {
      const pfx = folder ? folder + '/' : ''
      await api.renameFolder(pfx + seg, pfx + name.trim())
      refresh()
    }
  }

  // --- Перетаскивание записи в папку/крошку ---
  const SLUG_TYPE = 'text/slovo-slug'
  const moveTo = async (slug: string, dest: string): Promise<void> => {
    setDropKey(null)
    const cur = projects.find((p) => p.slug === slug)
    if (!cur || (cur.folder ?? '') === dest) return
    await api.setFolder(slug, dest)
    refresh()
  }
  const allowDrop = (e: React.DragEvent, key: string): void => {
    if (e.dataTransfer.types.includes(SLUG_TYPE)) {
      e.preventDefault()
      if (dropKey !== key) setDropKey(key)
    }
  }
  const dropSlug = (e: React.DragEvent, dest: string): void => {
    e.preventDefault()
    const slug = e.dataTransfer.getData(SLUG_TYPE)
    if (slug) void moveTo(slug, dest)
  }

  // Текущий уровень: подпапки + записи прямо в этой папке.
  const prefix = folder ? folder + '/' : ''
  const records = projects
    .filter((p) => (p.folder ?? '') === folder)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const subSet = new Set<string>()
  for (const p of projects) {
    const f = p.folder ?? ''
    if (f !== folder && (folder === '' || f.startsWith(prefix))) {
      const seg = (folder === '' ? f : f.slice(prefix.length)).split('/')[0]
      if (seg) subSet.add(seg)
    }
  }
  const subfolders = [...subSet].sort((a, b) => a.localeCompare(b))
  const countUnder = (seg: string): number => {
    const full = prefix + seg
    return projects.filter((p) => {
      const f = p.folder ?? ''
      return f === full || f.startsWith(full + '/')
    }).length
  }
  const crumbs = folder ? folder.split('/') : []

  // Первый запуск: ни одной записи — показываем приветствие вместо пустой сетки.
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
      </div>

      <div className="breadcrumb">
        <button
          className={'crumb' + (dropKey === 'root' ? ' drop-hover' : '')}
          onClick={() => setFolder('')}
          onDragOver={(e) => allowDrop(e, 'root')}
          onDragLeave={() => setDropKey(null)}
          onDrop={(e) => dropSlug(e, '')}
        >
          Все записи
        </button>
        {crumbs.map((seg, i) => (
          <span key={i}>
            <span className="crumb-sep">/</span>
            <button
              className={'crumb' + (dropKey === 'c:' + i ? ' drop-hover' : '')}
              onClick={() => setFolder(crumbs.slice(0, i + 1).join('/'))}
              onDragOver={(e) => allowDrop(e, 'c:' + i)}
              onDragLeave={() => setDropKey(null)}
              onDrop={(e) => dropSlug(e, crumbs.slice(0, i + 1).join('/'))}
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {subfolders.length === 0 && records.length === 0 ? (
        <div className="empty">
          <div className="empty-title">В этой папке пусто</div>
          <div>Записи можно положить сюда из других папок</div>
        </div>
      ) : (
        <div className="project-grid">
          {subfolders.map((seg) => (
            <div
              key={'f:' + seg}
              className={'folder-card' + (dropKey === 'f:' + seg ? ' drop-hover' : '')}
              role="button"
              tabIndex={0}
              onClick={() => setFolder(prefix + seg)}
              onDragOver={(e) => allowDrop(e, 'f:' + seg)}
              onDragLeave={() => setDropKey(null)}
              onDrop={(e) => dropSlug(e, prefix + seg)}
            >
              <div className="folder-card-title">
                <Icon name="folder" size={18} />
                <span>{seg}</span>
              </div>
              <div className="project-card-meta">{countUnder(seg)} записей</div>
              <div className="card-actions">
                <button title="Переименовать папку" onClick={(e) => renameFolder(e, seg)}>
                  <Icon name="edit" />
                </button>
              </div>
            </div>
          ))}
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
                <button title="Переименовать" onClick={(e) => rename(e, p)}>
                  <Icon name="edit" />
                </button>
                <button title="Положить в папку" onClick={(e) => move(e, p)}>
                  <Icon name="folder" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
