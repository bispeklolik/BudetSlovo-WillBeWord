import { useState } from 'react'
import { useEscClose } from '../useEscClose'

// Внутреннее окно ввода строки — замена window.prompt (Electron его не поддерживает).
export default function InputModal({
  title,
  label,
  initial = '',
  placeholder,
  submitLabel = 'OK',
  onSubmit,
  onClose
}: {
  title: string
  label?: string
  initial?: string
  placeholder?: string
  submitLabel?: string
  onSubmit: (value: string) => void
  onClose: () => void
}): React.JSX.Element {
  useEscClose(onClose)
  const [value, setValue] = useState(initial)
  const submit = (): void => {
    const v = value.trim()
    if (v) onSubmit(v)
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
        </div>
        {label && <div className="input-label">{label}</div>}
        <input
          className="text-input"
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            else if (e.key === 'Escape') onClose()
          }}
        />
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!value.trim()}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
