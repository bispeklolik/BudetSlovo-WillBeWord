import { useEffect, useState } from 'react'
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
  useEscClose(onClose)
  const [tab, setTab] = useState<Tab>('words')
  const [words, setWords] = useState('')
  const [reps, setReps] = useState<Replacement[]>([])
  const [snips, setSnips] = useState<Snippet[]>([])
  const [modes, setModes] = useState<CustomDictMode[]>(customModes)
  const [saved, setSaved] = useState(false)

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
    onSaveModes(modes.filter((m) => m.name.trim() && m.prompt.trim()))
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const setAt = <T,>(list: T[], i: number, patch: Partial<T>): T[] => list.map((x, k) => (k === i ? { ...x, ...patch } : x))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Словарь и сниппеты</span>
          <button className="btn" onClick={onClose}>
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
                диктовке, и при расшифровке записей).
              </div>
              <textarea
                className="note-body"
                value={words}
                placeholder={'КПТ\nгештальт\nШварцман'}
                onChange={(e) => setWords(e.target.value)}
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
                  <input className="text-input" placeholder="кэпэтэ" value={r.from} onChange={(e) => setReps(setAt(reps, i, { from: e.target.value }))} />
                  <span>→</span>
                  <input className="text-input" placeholder="КПТ" value={r.to} onChange={(e) => setReps(setAt(reps, i, { to: e.target.value }))} />
                  <button className="btn btn-icon" title="Удалить" onClick={() => setReps(reps.filter((_, k) => k !== i))}>
                    ×
                  </button>
                </div>
              ))}
              <div>
                <button className="btn btn-sm" onClick={() => setReps([...reps, { from: '', to: '' }])}>
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
                  <input className="text-input" placeholder="моя подпись" value={s.trigger} onChange={(e) => setSnips(setAt(snips, i, { trigger: e.target.value }))} />
                  <span>→</span>
                  <textarea className="text-input" rows={3} placeholder={'С уважением,\nАнна, +7 …'} value={s.text} onChange={(e) => setSnips(setAt(snips, i, { text: e.target.value }))} />
                  <button className="btn btn-icon" title="Удалить" onClick={() => setSnips(snips.filter((_, k) => k !== i))}>
                    ×
                  </button>
                </div>
              ))}
              <div>
                <button className="btn btn-sm" onClick={() => setSnips([...snips, { trigger: '', text: '' }])}>
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
                  <input className="text-input" placeholder="Пост в канал" value={m.name} onChange={(e) => setModes(setAt(modes, i, { name: e.target.value }))} />
                  <span>→</span>
                  <textarea
                    className="text-input"
                    rows={3}
                    placeholder="Оформи как короткий пост для Telegram-канала: заголовок и 2–3 абзаца."
                    value={m.prompt}
                    onChange={(e) => setModes(setAt(modes, i, { prompt: e.target.value }))}
                  />
                  <button className="btn btn-icon" title="Удалить" onClick={() => setModes(modes.filter((_, k) => k !== i))}>
                    ×
                  </button>
                </div>
              ))}
              <div>
                <button
                  className="btn btn-sm"
                  onClick={() => setModes([...modes, { id: 'm' + Date.now().toString(36), name: '', prompt: '' }])}
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
