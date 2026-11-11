import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProjectMeta, Word } from '../../../shared/types'
import {
  BASIS_LABEL,
  mergeVariants,
  sameWordCount,
  shapeLike,
  coreOf,
  type AiEntry,
  type WordSoundReply
} from '../../../shared/wordVariants'
import { api } from '../api'

// Окошко «возможные варианты» неуверенного слова (волна 7). Варианты по звучанию видны сразу,
// варианты ИИ дописываются, пока идёт запрос; окошко не блокируется. Клавиши 1–5, ↑/↓/Enter,
// Tab / Shift+Tab, Esc перехватывает окошко, пока оно открыто.

export interface ApplyOptions {
  all: boolean
  toDict: boolean
}

interface Props {
  slug: string
  meta: ProjectMeta
  turnId: string
  word: Word
  /** Есть звук: можно прослушать место. */
  canListen: boolean
  onClose: () => void
  onApply: (text: string, opts: ApplyOptions) => void
  onOk: (opts: ApplyOptions) => void
  onWriteOwn: () => void
  onListen: () => void
  onStep: (dir: 1 | -1) => void
}

type AiState = 'idle' | 'loading' | 'done' | 'error' | 'off'

const WIDTH = 330

export default function WordVariants(props: Props): React.JSX.Element | null {
  const { slug, meta, word } = props
  const [sound, setSound] = useState<WordSoundReply | null>(null)
  const [ai, setAi] = useState<AiEntry | null>(null)
  const [aiState, setAiState] = useState<AiState>('idle')
  const [retry, setRetry] = useState(0)
  const [sel, setSel] = useState(0)
  const [all, setAll] = useState(false)
  const [toDict, setToDict] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Слово сменилось (или его текст поменяли, например Ctrl+Z) — всё начинаем заново.
  // Cleanup ставит cancelled: ответ ИИ для старого слова в новое окошко не попадёт.
  useEffect(() => {
    let cancelled = false
    setSound(null)
    setAi(null)
    setAiState('idle')
    setSel(0)
    setAll(false)
    setToDict(false)
    api.wordsSound(slug, word.id).then((r) => {
      if (!cancelled) setSound(r ?? { pinned: [], sound: [], cached: null, aiState: 'off' })
    })
    return () => {
      cancelled = true
    }
  }, [slug, word.id, word.t])

  useEffect(() => {
    if (!sound) return
    let cancelled = false
    if (sound.cached) {
      setAi(sound.cached)
      setAiState('done')
    } else if (sound.aiState === 'ready') {
      setAiState('loading')
      api
        .wordsAi(slug, word.id)
        .then((r) => {
          if (cancelled) return
          setAi(r.entry)
          setAiState(r.entry ? 'done' : 'error') // ответа по слову нет — можно спросить ещё раз
        })
        .catch(() => {
          if (!cancelled) setAiState('error')
        })
    } else setAiState('off')
    return () => {
      cancelled = true
    }
  }, [sound, retry, slug, word.id])

  const variants = useMemo(
    () => mergeVariants([sound?.pinned.slice(0, 3) ?? [], ai?.variants ?? [], sound?.sound ?? []], word.t),
    [sound, ai, word.t]
  )
  const same = useMemo(() => sameWordCount(meta.turns, word.t, word.id), [meta.turns, word.t, word.id])
  const label = coreOf(word.t) || word.t

  const apply = (i: number): void => {
    const v = variants[i]
    if (v) props.onApply(v.text, { all: all && same > 0, toDict })
  }

  // Клавиши. Захват на window: до обработчика редактора, чтобы цифры не меняли скорость.
  const stateRef = useRef({ variants, sel, apply, props, same })
  stateRef.current = { variants, sel, apply, props, same }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      const typing =
        el?.isContentEditable || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || (el?.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox')
      if (typing || e.ctrlKey || e.altKey || e.metaKey) return
      const s = stateRef.current
      const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code)
      const eat = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (digit) {
        eat()
        s.apply(Number(digit[1]) - 1)
      } else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        eat()
        const n = s.variants.length
        if (n) setSel((i) => (i + (e.code === 'ArrowDown' ? 1 : -1) + n) % n)
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (el?.tagName === 'BUTTON') return // Enter на кнопке окошка нажимает её саму
        eat()
        s.apply(s.sel)
      } else if (e.code === 'KeyA' || e.code === 'KeyD') {
        eat()
        if (e.code === 'KeyD') setToDict((v) => !v)
        else if (s.same > 0) setAll((v) => !v)
      } else if (e.code === 'Escape') {
        eat()
        s.props.onClose()
      } else if (e.code === 'Tab') {
        eat()
        s.props.onStep(e.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Щелчок мимо окошка закрывает его (щелчок по слову сам откроет окошко заново).
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) stateRef.current.props.onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Положение: под словом, у края экрана — над словом. Следим, пока окошко открыто:
  // список реплик прокручивается и перерисовывается.
  // setPos зовём только когда положение правда изменилось: сравниваем с posRef, а не через
  // updater — иначе слой-эффект после каждой отрисовки планирует обновление и React падает
  // с «Maximum update depth exceeded» (Editor перерисовывается 60 раз в секунду).
  const posRef = useRef<{ top: number; left: number } | null>(null)
  const place = (): void => {
    const target = document.querySelector<HTMLElement>(`[data-word="${word.id}"]`)
    let next: { top: number; left: number } | null = null
    if (target) {
      const r = target.getBoundingClientRect()
      const h = boxRef.current?.offsetHeight ?? 260
      let top = r.bottom + 6
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
      next = { top, left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 12)) }
    }
    const cur = posRef.current
    const same = next === null ? cur === null : cur !== null && Math.abs(cur.top - next.top) < 1 && Math.abs(cur.left - next.left) < 1
    if (same) return
    posRef.current = next
    setPos(next)
  }
  const placeRef = useRef(place)
  placeRef.current = place
  useLayoutEffect(place)
  useEffect(() => {
    const id = window.setInterval(() => placeRef.current(), 120)
    return () => window.clearInterval(id)
  }, [])

  const nothing = variants.length === 0 && sound !== null && aiState !== 'loading' && aiState !== 'idle' && aiState !== 'error'

  return (
    <div
      ref={boxRef}
      className="wv"
      role="dialog"
      aria-label="Возможные варианты слова"
      data-testid="word-variants"
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: WIDTH, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="wv-head">
        <span className="wv-word" title="Слово, в котором движок не уверен">
          {label}
        </span>
        <button
          className="btn wv-listen"
          onClick={props.onListen}
          disabled={!props.canListen}
          title={props.canListen ? 'Проиграть это место записи и остановиться' : 'У этой записи нет звука'}
        >
          ▶ Прослушать
        </button>
        <button className="wv-x" onClick={props.onClose} title="Закрыть (Esc)" aria-label="Закрыть">
          ×
        </button>
      </div>

      <div className="wv-list" role="listbox">
        {variants.map((v, i) => (
          <button
            key={v.text.toLowerCase()}
            className={'wv-item' + (i === sel ? ' sel' : '')}
            role="option"
            aria-selected={i === sel}
            data-testid="wv-item"
            onMouseEnter={() => setSel(i)}
            onClick={() => apply(i)}
          >
            <span className="wv-num">{i + 1}</span>
            <span className="wv-text">{shapeLike(v.text, word.t)}</span>
            <span className="wv-basis">{BASIS_LABEL[v.basis]}</span>
          </button>
        ))}
        {sound === null && <div className="wv-note">Ищу варианты…</div>}
        {aiState === 'loading' && <div className="wv-note wv-busy">Подбираю варианты…</div>}
        {aiState === 'error' && (
          <div className="wv-note">
            Не получилось подобрать варианты{' '}
            <button className="wv-link" onClick={() => setRetry((n) => n + 1)}>
              Ещё раз
            </button>
          </div>
        )}
        {aiState === 'off' && <div className="wv-note">Варианты по смыслу подбирает ИИ. Подключить — в Настройках</div>}
        {aiState === 'done' && ai?.ok && <div className="wv-note">ИИ считает, что слово верное.</div>}
        {nothing && <div className="wv-note">Похожих слов не нашлось. Прослушайте и напишите своё</div>}
      </div>

      <div className="wv-actions">
        <button className="wv-act" onClick={props.onWriteOwn}>
          ✎ Написать своё…
        </button>
        <button className="wv-act" onClick={() => props.onOk({ all: false, toDict })} title="Убрать подсветку. Tab больше не остановится на этом слове. Ctrl+Z отменит.">
          ✓ Слово верное
        </button>
      </div>

      <div className="wv-opts">
        {same > 0 && (
          <label className="wv-opt">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Исправить во всей записи ({same})
          </label>
        )}
        <label className="wv-opt">
          <input type="checkbox" checked={toDict} onChange={(e) => setToDict(e.target.checked)} />
          Добавить в словарь
        </label>
      </div>

      <div className="wv-keys">1–5 выбрать · ↑↓ Enter · Tab следующее · A во всей записи · D в словарь · Esc закрыть</div>
    </div>
  )
}
