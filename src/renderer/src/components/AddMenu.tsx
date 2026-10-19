import { useEffect, useRef, useState } from 'react'

// Главный экран → «Ещё ▾»: другие способы добавить запись (волна 5).

export default function AddMenu({
  onPhone,
  onLink,
  onWatch
}: {
  onPhone: () => void
  onLink: () => void
  onWatch: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (fn: () => void): void => {
    setOpen(false)
    fn()
  }

  return (
    <div className="export-wrap" ref={wrapRef}>
      <button className="btn" onClick={() => setOpen((v) => !v)}>
        Ещё ▾
      </button>
      {open && (
        <div className="export-menu">
          <button className="export-item" onClick={() => pick(onPhone)}>
            С телефона (QR-код)
          </button>
          <button className="export-item" onClick={() => pick(onLink)}>
            По ссылке (YouTube, VK, RuTube…)
          </button>
          <button className="export-item" onClick={() => pick(onWatch)}>
            Папка-наблюдатель…
          </button>
        </div>
      )}
    </div>
  )
}
