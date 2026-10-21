import { useEffect, useState } from 'react'
import { api } from '../api'

// Плашка-индикатор диктовки (отдельное поверх-всех окно, фокус не забирает).
// Микрофон никогда не должен быть «открыт незаметно» — особенно в кабинете
// психолога, поэтому состояния читаются с одного взгляда.
// Состояние приходит строкой «состояние|подпись»: подпись — режим чистки
// и программа («Сообщение · telegram», волна 6).

const LABEL: Record<string, string> = {
  listening: 'Говорите…',
  edit: 'Что сделать с выделенным?',
  processing: 'Распознаю…',
  editing: 'Правлю текст…',
  done: 'Вставлено ✓',
  empty: 'Ничего не расслышал',
  silent: 'Микрофон молчит — проверьте его',
  nomic: 'Нет доступа к микрофону',
  error: 'Не распознал. Запись сохранена',
  noselection: 'Сначала выделите текст',
  'edit-error': 'Не получилось поправить — текст не тронут',
  'edit-moved': 'Окно сменилось — текст в буфере',
  'edit-console': 'В консоли правка выключена'
}

export default function DictOverlay(): React.JSX.Element {
  const [raw, setRaw] = useState('listening')
  const [live, setLive] = useState('')

  useEffect(() => {
    document.body.classList.add('overlay-mode') // прозрачный фон окна
    const off1 = api.onDictState((s) => {
      setRaw(s)
      if (s.startsWith('listening') || s.startsWith('edit|') || s === 'edit') setLive('')
    })
    const off2 = api.onDictLive(setLive)
    return () => {
      off1()
      off2()
    }
  }, [])

  const [state, note = ''] = raw.split('|')
  const recording = state === 'listening' || state === 'edit'
  const busy = state === 'processing' || state === 'editing'
  const look = state === 'edit' ? 'listening' : state === 'editing' ? 'processing' : state

  return (
    <div className={'dict-pill dict-' + look + (live && recording ? ' dict-has-live' : '')}>
      {recording && (
        <span className="dict-wave">
          <i /><i /><i /><i /><i />
        </span>
      )}
      {busy && <span className="dict-spin" />}
      <span className="dict-label">
        {LABEL[state] ?? state}
        {note && <span className="dict-mode">{note}</span>}
      </span>
      {(recording || busy) && <span className="dict-hint">Esc — отмена</span>}
      {live && recording && <div className="dict-live">{live.length > 240 ? '…' + live.slice(-240) : live}</div>}
    </div>
  )
}
