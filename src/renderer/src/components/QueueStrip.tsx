import { X } from 'lucide-react'
import { api } from '../api'
import { useLibrary } from '../library'

// Очередь расшифровок (ревью волны 7): видна на любой странице, а не только в
// «Записях» — импорт запускается и с Главной, и из бокового меню.
export default function QueueStrip(): React.JSX.Element | null {
  const jobs = useLibrary((s) => s.jobs)
  const projects = useLibrary((s) => s.projects)
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running')
  if (active.length === 0) return null
  const title = (slug: string): string => (projects ?? []).find((p) => p.slug === slug)?.title ?? slug
  return (
    <div className="queue-strip">
      {active.map((j) => (
        <div className="queue-item" key={j.id}>
          <span className="queue-dot" />
          <span className="queue-title">{title(j.slug)}</span>
          <span className="queue-phase">
            {j.status === 'queued' ? 'в очереди' : j.phase}
            {j.percent !== null && j.status === 'running' ? ` · ${j.percent}%` : ''}
          </span>
          <button className="btn-icon" title="Отменить" aria-label="Отменить" onClick={() => api.cancelJob(j.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
