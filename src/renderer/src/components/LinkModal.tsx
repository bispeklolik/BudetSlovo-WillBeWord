import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { humanError } from '../toast'
import { useEscClose } from '../useEscClose'

// «По ссылке»: YouTube, VK Видео, RuTube и др. (через yt-dlp — скачивается один
// раз с согласия) или прямая ссылка на аудио/видео файл.

export default function LinkModal({
  onOpen,
  onClose
}: {
  onOpen: (slug: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<{ phase: string; percent: number | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [needTool, setNeedTool] = useState(false)
  // Окно закрыли (отмена) — запись, которая всё же успела собраться, не открываем.
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    []
  )
  const close = (): void => {
    if (busy) void api.linkCancel()
    onClose()
  }
  useEscClose(close)

  useEffect(() => api.onLinkProgress((p) => setBusy(p)), [])

  const run = async (): Promise<void> => {
    if (!url.trim() || busy) return
    setErr(null)
    setBusy({ phase: 'Начинаю', percent: null })
    try {
      const meta = await api.linkImport(url.trim())
      if (alive.current) onOpen(meta.slug)
    } catch (e) {
      if (!alive.current) return
      const m = humanError(e)
      if (m.includes('YTDLP_MISSING')) setNeedTool(true)
      else setErr(m)
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  const install = async (): Promise<void> => {
    setErr(null)
    setBusy({ phase: 'Скачиваю yt-dlp', percent: 0 })
    try {
      await api.linkInstall()
      if (!alive.current) return
      setNeedTool(false)
      setBusy(null)
      await run()
    } catch (e) {
      if (!alive.current) return
      setErr('yt-dlp не скачался: ' + humanError(e))
      setBusy(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Запись по ссылке</span>
          <button className="btn" onClick={close}>
            {busy ? 'Отменить' : 'Закрыть'}
          </button>
        </div>
        <div className="panel-note">
          Ссылка на видео YouTube, VK Видео, RuTube и других сайтов или прямая ссылка на аудио/видео файл. Берётся только
          звук. Скачивайте только то, на что у вас есть право.
        </div>
        <input
          className="text-input"
          autoFocus
          placeholder="https://…"
          value={url}
          disabled={!!busy}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
        />
        {needTool && !busy && (
          <div className="call-note">
            Для сайтов нужна бесплатная программа yt-dlp (≈18 МБ, с GitHub). Скачать её в папку «Слова»?{' '}
            <button className="link-btn" onClick={() => void install()}>
              Скачать
            </button>
          </div>
        )}
        {busy && (
          <div className="panel-note">
            {busy.phase}
            {busy.percent !== null ? ` · ${busy.percent}%` : '…'}
          </div>
        )}
        {err && <div className="key-bad">{err}</div>}
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => void run()} disabled={!!busy || !url.trim()}>
            Добавить запись
          </button>
        </div>
      </div>
    </div>
  )
}
