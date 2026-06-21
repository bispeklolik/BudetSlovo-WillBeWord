import { useState } from 'react'
import type { AnonRule } from '../../../shared/types'
import { useEscClose } from '../useEscClose'
import Icon from './Icon'

const KIND_LABEL: Record<AnonRule['kind'], string> = {
  name: 'имя',
  place: 'место',
  org: 'организация',
  other: 'другое'
}

export default function AnonPanel({
  rules,
  onSave,
  onClose
}: {
  rules: AnonRule[]
  onSave: (rules: AnonRule[]) => void
  onClose: () => void
}): React.JSX.Element {
  useEscClose(onClose)
  const [list, setList] = useState<AnonRule[]>(rules)
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')

  const add = (): void => {
    const f = find.trim()
    const r = replace.trim()
    if (!f || !r) return
    setList([...list, { find: f, replace: r, kind: 'other' }])
    setFind('')
    setReplace('')
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Список замен</span>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="panel-note">
          ИИ нашёл эти данные и заменит их в обезличенном виде. Убери лишнее или добавь пропущенное
          слово вручную — ИИ мог что-то не поймать.
        </div>
        <div className="anon-list">
          {list.length === 0 ? (
            <div className="panel-note">Пока пусто — нажми «Обезличить» в меню ИИ.</div>
          ) : (
            list.map((r, i) => (
              <div className="anon-rule" key={i}>
                <span className="anon-find">{r.find}</span>
                <span className="anon-arrow">→</span>
                <span className="anon-replace">{r.replace}</span>
                <span className="note-badge">{KIND_LABEL[r.kind]}</span>
                <button
                  className="btn-icon"
                  title="Убрать правило"
                  onClick={() => setList(list.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="anon-add">
          <input
            className="text-input"
            placeholder="слово как в тексте"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <span className="anon-arrow">→</span>
          <input
            className="text-input"
            placeholder="замена"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn" onClick={add} disabled={!find.trim() || !replace.trim()}>
            Добавить
          </button>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => onSave(list)}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
