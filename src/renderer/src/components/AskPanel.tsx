import { useEffect, useRef, useState } from 'react'
import type { AskSource, AskTurn } from '../../../shared/types'
import { parseAnswer, clock } from '../../../shared/retrieval'
import { api } from '../api'
import { humanError } from '../toast'
import { useEscClose } from '../useEscClose'

// «Спросить запись» / «Спросить записи»: вопрос — ответ ИИ со ссылками.
// [3] — фрагмент найденной записи, [12:34] — место в этой записи; клик — перейти.

type Props =
  | { mode: 'one'; slug: string; title: string; onSeek: (sec: number) => void; onClose: () => void }
  | { mode: 'all'; folder: string | null; onOpen: (slug: string, sec: number) => void; onClose: () => void }

// Разговоры живут, пока открыто приложение: перешёл к источнику, вернулся —
// вопросы и ответы на месте (ревью волны 4). Ключ — запись или папка.
const threads = new Map<string, Item[]>()

interface Item {
  q: string
  a: string
  sources: AskSource[]
  notFound?: boolean
  thorough?: boolean
}

export default function AskPanel(props: Props): React.JSX.Element {
  useEscClose(props.onClose)
  const key = props.mode === 'one' ? 'one:' + props.slug : 'all:' + (props.folder ?? '')
  const [items, setItemsState] = useState<Item[]>(() => threads.get(key) ?? [])
  const setItems = (list: Item[]): void => {
    threads.set(key, list)
    setItemsState(list)
  }
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [onlyFolder, setOnlyFolder] = useState(true)
  const [saved, setSaved] = useState<number | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const downOnOverlay = useRef(false)

  useEffect(() => api.onAiProgress((p) => setPhase(p.phase)), [])

  const folder = props.mode === 'all' ? props.folder : null
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [items, busy])

  // thorough — «Искать внимательно»: заменяет последний ответ «ничего не нашлось».
  const ask = async (thorough = false): Promise<void> => {
    const question = thorough ? items[items.length - 1]?.q : q.trim()
    if (!question || busy) return
    setBusy(true)
    setErr(null)
    setPhase(null)
    const base = thorough ? items.slice(0, -1) : items
    const history: AskTurn[] = base.filter((i) => !i.notFound).map((i) => ({ q: i.q, a: i.a }))
    try {
      const res =
        props.mode === 'one'
          ? await api.askRecording(props.slug, question, history, thorough)
          : await api.askAll(question, onlyFolder ? folder : null, history, thorough)
      setItems([...base, { q: question, a: res.answer, sources: res.sources, notFound: res.notFound, thorough }])
      if (!thorough) setQ('')
    } catch (e) {
      setErr(humanError(e))
    } finally {
      setBusy(false)
      setPhase(null)
    }
  }

  const go = (src: AskSource): void => {
    if (props.mode === 'one') props.onSeek(src.startSec)
    else props.onOpen(src.slug, src.startSec)
  }
  const goSec = (sec: number): void => {
    if (props.mode === 'one') props.onSeek(sec)
  }

  const saveItem = async (i: number): Promise<void> => {
    const it = items[i]
    const refs = it.sources.map((s) => `[${s.n}] «${s.title}», ${clock(s.startSec)}`).join('\n')
    await api.saveNote({
      kind: 'note',
      title: 'Вопрос: ' + (it.q.length > 60 ? it.q.slice(0, 60) + '…' : it.q),
      body: `**${it.q}**\n\n${it.a}${refs ? '\n\nИсточники:\n' + refs : ''}`,
      sourceSlug: props.mode === 'one' ? props.slug : undefined,
      sourceTitle: props.mode === 'one' ? props.title : undefined
    })
    setSaved(i)
    setTimeout(() => setSaved(null), 1800)
  }

  const title =
    props.mode === 'one' ? 'Спросить запись' : folder && onlyFolder ? `Спросить записи «${folder.split('/').pop()}»` : 'Спросить все записи'
  const placeholder =
    props.mode === 'one'
      ? 'Например: о чём договорились в конце?'
      : 'Например: что клиент говорил о матери?'

  return (
    <div
      className="modal-overlay"
      // Закрывать только кликом мимо окна, а не концом выделения текста в ответе.
      onMouseDown={(e) => (downOnOverlay.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (downOnOverlay.current && e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className="modal modal-wide ask-modal">
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="btn" onClick={props.onClose}>
            Закрыть
          </button>
        </div>
        {props.mode === 'all' && folder && (
          <label className="ask-scope">
            <input type="checkbox" checked={onlyFolder} onChange={(e) => setOnlyFolder(e.target.checked)} />
            Только папка «{folder.split('/').pop()}» (вместе с вложенными)
          </label>
        )}

        <div className="ask-list">
          {items.length === 0 && !busy && (
            <div className="panel-note">
              {props.mode === 'one'
                ? 'Задайте вопрос по этой записи. В ответе будут ссылки на время — нажмите, чтобы послушать это место.'
                : 'Задайте вопрос по записям. ИИ найдёт подходящие места и ответит со ссылками на них.'}{' '}
              ИИ может ошибаться — проверяйте по ссылкам.
            </div>
          )}
          {items.map((it, i) => {
            const parts = parseAnswer(it.a, it.sources.length ? Math.max(...it.sources.map((s) => s.n)) : 0)
            const byN = new Map(it.sources.map((s) => [s.n, s]))
            return (
              <div key={i} className="ask-item">
                <div className="ask-q">{it.q}</div>
                <div className="ask-a">
                  {parts.map((p, k) =>
                    'text' in p ? (
                      <span key={k}>{p.text}</span>
                    ) : 'ref' in p ? (
                      byN.has(p.ref) ? (
                        <button key={k} className="ask-ref" onClick={() => go(byN.get(p.ref)!)} title={byN.get(p.ref)!.title}>
                          {p.ref}
                        </button>
                      ) : (
                        <span key={k}>[{p.ref}]</span>
                      )
                    ) : props.mode === 'one' ? (
                      <button key={k} className="ask-ref" onClick={() => goSec(p.sec)} title="Перейти к этому месту">
                        {p.label}
                      </button>
                    ) : (
                      <span key={k}>[{p.label}]</span>
                    )
                  )}
                </div>
                {it.sources.length > 0 && (
                  <div className="ask-sources">
                    {it.sources.map((s) => (
                      <button key={s.n} className="hl-item" onClick={() => go(s)}>
                        <span className="hl-item-time">
                          {s.n} · {clock(s.startSec)}
                        </span>
                        <span className="hl-item-text">
                          {props.mode === 'all' && <b>{s.title}. </b>}
                          {s.snippet}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {it.notFound && i === items.length - 1 && (
                  <div>
                    <button className="btn btn-sm" onClick={() => void ask(true)} disabled={busy}>
                      Искать внимательно
                    </button>
                  </div>
                )}
                {!it.notFound && !it.thorough && i === items.length - 1 && !busy && (
                  <div className="panel-note">
                    Ответ неполный?{' '}
                    <button className="link-btn" onClick={() => void ask(true)}>
                      Искать внимательно
                    </button>{' '}
                    — ИИ прочитает {props.mode === 'one' ? 'всю запись' : 'каждую запись'} целиком (дольше).
                  </div>
                )}
                <div className="ask-item-actions">
                  <button className="link-btn" onClick={() => void navigator.clipboard.writeText(it.a)}>
                    Копировать
                  </button>
                  <button className="link-btn" onClick={() => void saveItem(i)}>
                    {saved === i ? 'В конспектах ✓' : 'Сохранить в конспекты'}
                  </button>
                </div>
              </div>
            )
          })}
          {busy && (
            <div className="panel-note">
              {phase ? phase + '…' : 'Ищу ответ…'} Локальный ИИ может думать несколько минут.
            </div>
          )}
          <div ref={endRef} />
        </div>

        {err && <div className="key-bad">{err}</div>}
        <div className="ask-input">
          <textarea
            className="text-input"
            rows={2}
            autoFocus
            placeholder={placeholder}
            value={q}
            disabled={busy}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void ask()
              }
            }}
          />
          <button className="btn btn-primary" onClick={() => void ask()} disabled={busy || !q.trim()}>
            Спросить
          </button>
        </div>
      </div>
    </div>
  )
}
