import { useEffect, useState } from 'react'
import { api } from '../api'
import { showToast, humanError } from '../toast'
import type { DictationEntry } from '../../../shared/types'
import { suggestFromEdit, type Suggestion } from '../../../shared/learn'
import { cleanWords } from '../../../shared/vocab'

// «Последние диктовки»: ни одна диктовка не теряется. Ошибка распознавания или
// чистки → аудио лежит в папке данных, его можно распознать заново (идея —
// History/Retry у OpenWhispr и Superwhisper).
// «Исправить» (волна 6): правишь вставленный текст — «Слово» предлагает
// запомнить замены и слова для словаря (словарь, который учится).

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
  const [edit, setEdit] = useState<{ i: number; before: string; value: string } | null>(null)
  const [learn, setLearn] = useState<{ list: Suggestion[]; on: boolean[] } | null>(null)

  const saveEdit = (): void => {
    if (!edit) return
    void navigator.clipboard.writeText(edit.value).catch(() => {})
    const list = suggestFromEdit(edit.before, edit.value)
    setEdit(null)
    if (!list.length) {
      showToast('Исправленный текст в буфере обмена.', 'info')
      return
    }
    // Галочки сняты: в словарь попадает только то, что человек отметил сам.
    setLearn({ list, on: list.map(() => false) })
  }

  const applyLearn = async (): Promise<void> => {
    if (!learn) return
    const picked = learn.list.filter((_, k) => learn.on[k])
    const s = await api.getSettings()
    const v = s.vocab ?? { words: [], replacements: [], snippets: [] }
    const reps = [...v.replacements]
    for (const p of picked) {
      const i = reps.findIndex((r) => r.from.toLowerCase() === p.from.toLowerCase())
      if (i >= 0) reps[i] = { from: p.from, to: p.to }
      else reps.push({ from: p.from, to: p.to })
    }
    // В словарь — то, как надо писать: имена, термины (с заглавной или длинные).
    const words = cleanWords([...v.words, ...picked.map((p) => p.to).filter((t) => /\p{Lu}/u.test(t) || t.length >= 6)])
    await api.setSettings({ vocab: { ...v, replacements: reps, words } })
    setLearn(null)
    showToast(`Запомнил: ${picked.length}. Исправленный текст в буфере обмена.`, 'info')
  }

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
      {learn && (
        <div className="dict-learn">
          <div className="settings-status">Запомнить, как надо писать? Дальше «Слово» будет исправлять это само.</div>
          {learn.list.map((p, k) => (
            <label key={k} className="ask-scope">
              <input
                type="checkbox"
                checked={learn.on[k]}
                onChange={(ev) => setLearn({ ...learn, on: learn.on.map((x, j) => (j === k ? ev.target.checked : x)) })}
              />
              «{p.from}» → «{p.to}»
            </label>
          ))}
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-primary" onClick={() => void applyLearn()} disabled={!learn.on.some(Boolean)}>
              Запомнить
            </button>
            <button className="btn btn-sm" onClick={() => setLearn(null)}>
              Не надо
            </button>
          </span>
        </div>
      )}
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
                    {text && e.mode !== 'edit' && (
                      <button className="btn btn-sm" title="Поправить текст — «Слово» запомнит ошибки распознавания" onClick={() => setEdit({ i, before: text, value: text })}>
                        Исправить
                      </button>
                    )}
                    {e.audio && (
                      <button className="btn btn-sm" disabled={busy !== null} onClick={() => retry(e.audio!)}>
                        {busy === e.audio ? 'Распознаю…' : 'Повторить'}
                      </button>
                    )}
                  </span>
                </div>
                {edit?.i === i ? (
                  <div className="dict-edit">
                    <textarea
                      className="text-input"
                      rows={3}
                      autoFocus
                      value={edit.value}
                      onChange={(ev) => setEdit({ ...edit, value: ev.target.value })}
                    />
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-primary" onClick={saveEdit} disabled={edit.value.trim() === edit.before.trim()}>
                        Сохранить и запомнить
                      </button>
                      <button className="btn btn-sm" onClick={() => setEdit(null)}>
                        Отмена
                      </button>
                    </span>
                  </div>
                ) : (
                  text && <div className="dict-item-text">{text}</div>
                )}
              </div>
            )
          })
        ))}
    </div>
  )
}
