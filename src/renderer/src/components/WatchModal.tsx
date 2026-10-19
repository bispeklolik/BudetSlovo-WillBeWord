import { useEffect, useState } from 'react'
import { api } from '../api'
import { useEscClose } from '../useEscClose'

// «Папка-наблюдатель»: всё, что появится в папке (диктофон, OneDrive,
// Яндекс.Диск), «Слово» возьмёт само и, если включено, расшифрует.

export default function WatchModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  useEscClose(onClose)
  const [dir, setDir] = useState('')
  const [auto, setAuto] = useState(true)
  const [takeExisting, setTakeExisting] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getSettings().then((s) => {
      setDir(s.watchFolder?.dir ?? '')
      setAuto(s.watchFolder?.autoTranscribe ?? true)
    })
  }, [])

  const apply = async (d: string, a: boolean, take: boolean): Promise<void> => {
    await api.watchSet(d || null, a, take)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Папка-наблюдатель</span>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="panel-note">
          Положите запись в эту папку — «Слово» само добавит её в список (через 20–30 секунд, когда файл докопируется).
          Удобно с папкой синхронизации телефона: OneDrive, Яндекс.Диск, Google Диск.
        </div>
        <div className="settings-row">
          <span className="watch-dir">{dir || 'Папка не выбрана'}</span>
          <button
            className="btn btn-sm"
            onClick={async () => {
              const d = await api.watchPick()
              if (d) {
                setDir(d)
                await apply(d, auto, takeExisting)
              }
            }}
          >
            Выбрать…
          </button>
        </div>
        <label className="ask-scope">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked)
              if (dir) void apply(dir, e.target.checked, false)
            }}
          />
          Сразу расшифровывать (движок из Настроек, 2 говорящих)
        </label>
        {!dir && (
          <label className="ask-scope">
            <input type="checkbox" checked={takeExisting} onChange={(e) => setTakeExisting(e.target.checked)} />
            Взять и записи, которые уже лежат в папке
          </label>
        )}
        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          {dir ? (
            <button
              className="btn"
              onClick={async () => {
                setDir('')
                await apply('', auto, false)
              }}
            >
              Перестать следить
            </button>
          ) : (
            <span />
          )}
          {saved && <span className="pane-count">сохранено</span>}
        </div>
      </div>
    </div>
  )
}
