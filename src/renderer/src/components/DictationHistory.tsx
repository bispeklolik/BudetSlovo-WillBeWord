import { useEffect, useState } from 'react'
import { api } from '../api'
import { showToast, humanError } from '../toast'
import type { DictationEntry } from '../../../shared/types'

// «Последние диктовки»: ни одна диктовка не теряется. Ошибка распознавания или
// чистки → аудио лежит в папке данных, его можно распознать заново (идея —
// History/Retry у OpenWhispr и Superwhisper).

function fmt(at: string): string {
  const d = new Date(at)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function MicSelect({ value, onChange }: { value: string; onChange: (id: string) => void }): React.JSX.Element {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setMics(d.filter((x) => x.kind === 'audioinput' && x.deviceId !== 'default' && x.deviceId !== 'communications')))
      .catch(() => setMics([]))
  }, [])
  return (
    <select className="rate" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Системный по умолчанию</option>
      {mics.map((m, i) => (
        <option key={m.deviceId} value={m.deviceId}>
          {m.label || `Микрофон ${i + 1}`}
        </option>
      ))}
    </select>
  )
}

export default function DictationHistory(): React.JSX.Element {
  const [items, setItems] = useState<DictationEntry[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = (): void => {
    api.dictHistory().then(setItems)
  }
  useEffect(() => {
    if (open) load()
  }, [open])

  const retry = async (audio: string): Promise<void> => {
    setBusy(audio)
    try {
      await api.retryDict(audio)
      showToast('Распознал заново — текст в буфере обмена.')
      load()
    } catch (err) {
      showToast('Не получилось: ' + humanError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="dict-history">
      <button className="text-link" onClick={() => setOpen((v) => !v)}>
        {open ? 'Скрыть последние диктовки' : 'Последние диктовки'}
      </button>
      {open &&
        (items.length === 0 ? (
          <div className="settings-status">Пока пусто.</div>
        ) : (
          items.map((e, i) => {
            const text = e.text ?? e.polished ?? e.raw
            return (
              <div className="dict-item" key={e.at + i}>
                <div className="dict-item-head">
                  <span className="settings-status">{fmt(e.at)}</span>
                  {e.error && <span className="key-bad">{e.error}</span>}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {text && (
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          void navigator.clipboard.writeText(text)
                          showToast('Скопировано.')
                        }}
                      >
                        Копировать
                      </button>
                    )}
                    {e.audio && (
                      <button className="btn btn-sm" disabled={busy !== null} onClick={() => retry(e.audio!)}>
                        {busy === e.audio ? 'Распознаю…' : 'Повторить'}
                      </button>
                    )}
                  </span>
                </div>
                {text && <div className="dict-item-text">{text}</div>}
              </div>
            )
          })
        ))}
    </div>
  )
}
