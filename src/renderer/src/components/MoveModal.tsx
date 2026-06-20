import { useEscClose } from '../useEscClose'
import Icon from './Icon'

// Окно выбора папки назначения для записи — замена ручного ввода пути.
export default function MoveModal({
  folders,
  current,
  onPick,
  onClose
}: {
  folders: string[]
  current?: string
  onPick: (folder: string) => void
  onClose: () => void
}): React.JSX.Element {
  useEscClose(onClose)
  const all = ['', ...folders.filter((f) => f).sort((a, b) => a.localeCompare(b))]
  const cur = current ?? ''
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Переместить в папку</span>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="move-list">
          {all.map((f) => (
            <button
              key={f || 'root'}
              className={'move-item' + (f === cur ? ' is-current' : '')}
              onClick={() => onPick(f)}
              disabled={f === cur}
            >
              <Icon name="folder" size={16} />
              <span>{f === '' ? 'Все записи (корень)' : f}</span>
              {f === cur && <span className="move-here">здесь</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
