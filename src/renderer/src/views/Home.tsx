import { useEffect, useState } from 'react'
import type { ProjectMeta } from '../../../shared/types'
import { api } from '../api'

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

  return (
    <main className="home">
      <div className="home-toolbar">
        <button className="btn btn-primary" onClick={doImport} disabled={busy !== null} data-testid="import-btn">
          {busy ?? 'Импортировать запись'}
        </button>
      </div>
      {projects.length === 0 && !busy ? (
        <div className="empty">
          <div className="empty-title">Пока нет ни одной записи</div>
          <div>Нажмите «Импортировать запись» и выберите аудио- или видеофайл</div>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <div
              key={p.slug}
              className="project-card"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(p.slug)}
            >
              <div className="project-card-title">{p.title}</div>
              <div className="project-card-meta">
                {fmtDuration(p.audio.durationSec)} · {fmtDate(p.createdAt)}
              </div>
              <button
                className="project-rename"
                title="Переименовать"
                onClick={(e) => rename(e, p)}
              >
                ✏
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
