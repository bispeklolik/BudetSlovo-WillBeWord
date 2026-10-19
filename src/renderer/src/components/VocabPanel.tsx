import { useEffect, useRef, useState } from 'react'
import type { Replacement, Snippet, Vocab } from '../../../shared/vocab'
import type { CustomDictMode } from '../../../shared/dictModes'
import { api } from '../api'
import { useEscClose } from '../useEscClose'

// Словарь (волна 5): слова для распознавания, точные замены, сниппеты и свои
// режимы диктовки. Сохраняется кнопкой — так проще править несколько строк.

type Tab = 'words' | 'reps' | 'snippets' | 'modes'

const TABS: { id: Tab; name: string }[] = [
  { id: 'words', name: 'Словарь' },
  { id: 'reps', name: 'Замены' },
  { id: 'snippets', name: 'Сниппеты' },
  { id: 'modes', name: 'Свои режимы' }
]

export default function VocabPanel({
  customModes,
  onSaveModes,
  onClose
}: {
  customModes: CustomDictMode[]
  onSaveModes: (modes: CustomDictMode[]) => void
  onClose: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('words')
  const [words, setWords] = useState('')
  const [reps, setReps] = useState<Replacement[]>([])
  const [snips, setSnips] = useState<Snippet[]>([])
  const [modes, setModes] = useState<CustomDictMode[]>(customModes)
  const [saved, setSaved] = useState(false)
  // Правки сохраняются и при закрытии (Esc, «Закрыть», клик мимо) — как везде
  // в настройках; раньше они молча пропадали (ревью волны 5).
  const dirty = useRef(false)
  const downOnOverlay = useRef(false)
  const close = (): void => {
    if (dirty.current) void save()
    onClose()
  }
  useEscClose(close)
  const touch = <T,>(set: (v: T) => void) => (v: T): void => {
    dirty.current = true
    set(v)
  }

  useEffect(() => {
    api.getSettings().then((s) => {
      setWords((s.vocab?.words ?? []).join('\n'))
      setReps(s.vocab?.replacements ?? [])
      setSnips(s.vocab?.snippets ?? [])
    })
  }, [])

  const save = async (): Promise<void> => {
    const vocab: Vocab = {
      words: words.split('\n').map((w) => w.trim()).filter(Boolean),
      replacements: reps.filter((r) => r.from.trim()),
      snippets: snips.filter((s) => s.trigger.trim() && s.text.trim())
    }
    await api.setSettings({ vocab })
    // Режим без названия получает название; без описания — хранится, но не работает (видно подсказку).
    onSaveModes(
      modes
        .filter((m) => m.name.trim() || m.prompt.trim())
        .map((m) => ({ ...m, name: m.name.trim() || 'Свой режим' }))
    )
    dirty.current = false
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const setAt = <T,>(list: T[], i: number, patch: Partial<T>): T[] => list.map((x, k) => (k === i ? { ...x, ...patch } : x))

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => (downOnOverlay.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (downOnOverlay.current && e.target === e.currentTarget) close()
      }}
    >
      <div className="modal modal-wide">
        <div className="modal-head">
          <span className="modal-title">Словарь и сниппеты</span>
          <button className="btn" onClick={close}>
            Закрыть
          </button>
        </div>
        <div className="vocab-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={'btn btn-sm' + (tab === t.id ? ' btn-primary' : '')} onClick={() => setTab(t.id)}>
              {t.name}
            </button>
          ))}
        </div>

        <div className="vocab-body">
          {tab === 'words' && (
            <>
              <div className="panel-note">
                Имена, фамилии, термины — по одному в строке. Движок распознавания будет писать их именно так (и в
                диктовке, и при расшифровке записей). Локальный Whisper, OpenAI и Groq берут первые ~40 слов — самые
                важные ставьте наверх. ElevenLabs подсказок не принимает.
              </div>
              <textarea
                className="note-body"
                value={words}
                placeholder={'КПТ\nгештальт\nШварцман'}
                onChange={(e) => touch(setWords)(e.target.value)}
              />
            </>
          )}

          {tab === 'reps' && (
            <>
              <div className="panel-note">
                Что движок пишет неправильно → как надо. Заменяется в диктовке после распознавания, точно как
                написано справа.
              </div>
              {reps.map((r, i) => (
                <div className="vocab-row" key={i}>
                  <input className="text-input" placeholder="кэпэтэ" value={r.from} onChange={(e) => touch(setReps)(setAt(reps, i, { from: e.target.value }))} />
                  <span>→</span>
                  <input className="text-input" placeholder="КПТ" value={r.to} onChange={(e) => touch(setReps)(setAt(reps, i, { to: e.target.value }))} />
                  <button className="btn btn-icon" title="Удалить" onClick={() => touch(setReps)(reps.filter((_, k) => k !== i))}>
                    ×
                  </button>
                </div>
              ))}
              <div>
                <button className="btn btn-sm" onClick={() => touch(setReps)([...reps, { from: '', to: '' }])}>
                  + Замена
                </button>
              </div>
            </>
          )}

          {tab === 'snippets' && (
            <>
              <div className="panel-note">
                Скажите фразу — вставится готовый текст. Например, «моя подпись» → подпись с телефоном.
              </div>
              {snips.map((s, i) => (
                <div className="vocab-row vocab-row-top" key={i}>
                  <input className="text-input" placeholder="моя подпись" value={s.trigger} onChange={(e) => touch(setSnips)(setAt(snips, i, { trigger: e.target.value }))} />
                  <span>→</span>
                  <textarea className="text-input" rows={3} placeholder={'С уважением,\nАнна, +7 …'} value={s.text} onChange={(e) => touch(setSnips)(setAt(snips, i, { text: e.target.value }))} />
                  <button className="btn btn-icon" title="Удалить" onClick={() => touch(setSnips)(snips.filter((_, k) => k !== i))}>
                    ×
                  </button>
                </div>
              ))}
              <div>
                <button className="btn btn-sm" onClick={() => touch(setSnips)([...snips, { trigger: '', text: '' }])}>
                  + Сниппет
                </button>
              </div>
            </>
          )}

          {tab === 'modes' && (
            <>
              <div className="panel-note">
                Свой режим ИИ-чистки: название и что сделать с надиктовкой. Выбирается в настройках диктовки рядом
                с «Письмом» и «Сообщением».
              </div>
              {modes.map((m, i) => (
                <div className="vocab-row vocab-row-top" key={m.id}>
                  <input className="text-input" placeholder="Пост в канал" value={m.name} onChange={(e) => touch(setModes)(setAt(modes, i, { name: e.target.value }))} />
                  <span>→</span>
                  <textarea
                    className="text-input"
                    rows={3}
                    placeholder="Оформи как короткий пост для Telegram-канала: заголовок и 2–3 абзаца."
                    value={m.prompt}
                    onChange={(e) => touch(setModes)(setAt(modes, i, { prompt: e.target.value }))}
                  />
                  <button className="btn btn-icon" title="Удалить" onClick={() => touch(setModes)(modes.filter((_, k) => k !== i))}>
                    ×
                  </button>
                  {m.name.trim() && !m.prompt.trim() && <div className="key-bad vocab-hint">Без описания режим не работает.</div>}
                </div>
              ))}
              <div>
                <button
                  className="btn btn-sm"
                  onClick={() => touch(setModes)([...modes, { id: 'm' + Date.now().toString(36), name: '', prompt: '' }])}
                >
                  + Режим
                </button>
              </div>
            </>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => void save()}>
            {saved ? 'Сохранено ✓' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}
