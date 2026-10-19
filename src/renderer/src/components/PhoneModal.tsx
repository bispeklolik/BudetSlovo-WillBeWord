import { useEffect, useState } from 'react'
import { api } from '../api'
import { humanError } from '../toast'
import { useEscClose } from '../useEscClose'

// «С телефона»: QR-код на страницу в домашней сети. Пока окно открыто,
// телефон может прислать запись; закрыли окно — приём выключен.

export default function PhoneModal({
  onOpen,
  onClose
}: {
  onOpen: (slug: string) => void
  onClose: () => void
}): React.JSX.Element {
  useEscClose(onClose)
  const [s, setS] = useState<{ urls: string[]; qr: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [got, setGot] = useState<{ slug: string; title: string }[]>([])

  useEffect(() => {
    let alive = true
    api
      .phoneStart()
      .then((r) => alive && setS(r))
      .catch((e) => alive && setErr(humanError(e)))
    const off = api.onPhoneReceived((p) => setGot((list) => [p, ...list]))
    return () => {
      alive = false
      off()
      void api.phoneStop()
    }
  }, [])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Запись с телефона</span>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {err && <div className="key-bad">{err}</div>}
        {s && !s.urls.length && (
          <div className="key-bad">Компьютер не подключён к сети. Подключитесь к Wi-Fi и откройте окно снова.</div>
        )}
        {s && s.urls.length > 0 && (
          <>
            <div className="panel-note">
              Наведите камеру телефона на код и выберите запись диктофона. Телефон и компьютер должны быть в одной
              Wi-Fi сети. Файл идёт напрямую на компьютер, без облака.
            </div>
            <img className="phone-qr" src={s.qr} alt="QR-код для телефона" />
            <div className="phone-url">{s.urls[0]}</div>
            <div className="panel-note">
              Windows может спросить, разрешить ли «Слову» доступ к сети, — разрешите для частных сетей. Приём работает,
              пока открыто это окно.
            </div>
          </>
        )}
        {!s && !err && <div className="panel-note">Включаю приём…</div>}
        {got.length > 0 && (
          <div className="dict-history">
            {got.map((g) => (
              <button key={g.slug} className="hl-item" onClick={() => onOpen(g.slug)}>
                <span className="hl-item-time">готово</span>
                <span className="hl-item-text">{g.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
