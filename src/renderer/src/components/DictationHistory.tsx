import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { api } from '../api'
import { showToast, humanError } from '../toast'
import type { DictationEntry } from '../../../shared/types'
import { suggestFromEdit, type Suggestion } from '../../../shared/learn'
import { cleanWords } from '../../../shared/vocab'

// История диктовок (страница «Диктовка»): ни одна диктовка не теряется. Ошибка распознавания или
// чистки → аудио лежит в папке данных, его можно распознать заново (идея —
// History/Retry у OpenWhispr и Superwhisper).
// «Исправить» (волна 6): правишь вставленный текст — «Слово» предлагает
// запомнить замены и слова для словаря (словарь, который учится).

const PAGE = 20

function fmtTime(at: string): string {
  return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Заголовок дня: «Сегодня», «Вчера», дальше «6 ноября, пятница». Даты и дни недели считает код. */
export function dayTitle(at: string, now: Date = new Date()): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return 'Раньше'
  const start = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(now) - start(d)) / 86_400_000)
  if (diff <= 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', weekday: 'long' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('ru-RU', opts)
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
  const [hasMore, setHasMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const player = useRef<{ audio: HTMLAudioElement; url: string } | null>(null)
  const count = useRef(0)
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

  // Обновить с начала (после «Повторить» и новой диктовки), не сбрасывая уже открытые страницы.
  const load = useCallback((): void => {
    api
      .dictHistoryPage(Math.max(PAGE, count.current), 0)
      .then((r) => {
        count.current = r.items.length
        setItems(r.items)
        setHasMore(r.hasMore)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])
  useEffect(() => {
    load()
    return api.onDictLogged(load)
  }, [load])

  const more = (): void => {
    api
      .dictHistoryPage(PAGE, count.current)
      .then((r) => {
        count.current += r.items.length
        setItems((prev) => [...prev, ...r.items])
        setHasMore(r.hasMore)
      })
      .catch(() => showToast('Не удалось прочитать историю диктовок.'))
  }

  const stop = (): void => {
    if (player.current) {
      player.current.audio.pause()
      URL.revokeObjectURL(player.current.url)
      player.current = null
    }
    setPlaying(null)
  }
  useEffect(() => stop, [])

  const listen = async (audio: string): Promise<void> => {
    if (playing === audio) return stop()
    stop()
    const buf = await api.dictClip(audio)
    if (!buf) {
      showToast('Звук этой диктовки уже удалён.')
      return
    }
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/webm' }))
    const el = new Audio(url)
    el.onended = stop
    el.onerror = () => {
      stop()
      showToast('Не получилось проиграть звук.')
    }
    player.current = { audio: el, url }
    setPlaying(audio)
    void el.play().catch(() => stop())
  }

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
    <div className="dict-history" data-testid="dict-history">
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
      {!loaded ? null : items.length === 0 ? (
        <div className="settings-status">Пока пусто. Зажмите клавишу диктовки и скажите что-нибудь.</div>
      ) : (
        items.map((e, i) => {
          const text = e.text ?? e.polished ?? e.raw
          const day = dayTitle(e.at)
          const head = i === 0 || dayTitle(items[i - 1].at) !== day
          return (
            <div key={e.at + i}>
              {head && <h3 className="feed-day dict-day">{day}</h3>}
              <div className="dict-item">
                <div className="dict-item-head">
                  <span className="settings-status">{fmtTime(e.at)}</span>
                  {e.error && <span className="key-bad">{e.error}</span>}
                  <span className="dict-item-actions">
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
                      <button className="btn btn-sm" onClick={() => void listen(e.audio!)}>
                        {playing === e.audio ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
                        {playing === e.audio ? 'Стоп' : 'Слушать'}
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
            </div>
          )
        })
      )}
      {hasMore && (
        <button className="btn dict-more" onClick={more} data-testid="dict-more">
          Показать ещё
        </button>
      )}
    </div>
  )
}
