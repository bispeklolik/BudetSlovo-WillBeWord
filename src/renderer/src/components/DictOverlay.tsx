import { useEffect, useState } from 'react'
import { api } from '../api'

// Плашка-индикатор диктовки (отдельное поверх-всех окно, фокус не забирает).
// Микрофон никогда не должен быть «открыт незаметно» — особенно в кабинете
// психолога, поэтому состояния читаются с одного взгляда.

const LABEL: Record<string, string> = {
  listening: 'Говорите…',
  processing: 'Распознаю…',
  done: 'Вставлено ✓',
  empty: 'Ничего не расслышал',
  error: 'Ошибка — текст в журнале'
}

export default function DictOverlay(): React.JSX.Element {
  const [state, setState] = useState('listening')

  useEffect(() => {
    document.body.classList.add('overlay-mode') // прозрачный фон окна
    return api.onDictState(setState)
  }, [])

  return (
    <div className={'dict-pill dict-' + state}>
      {state === 'listening' && (
        <span className="dict-wave">
          <i /><i /><i /><i /><i />
        </span>
      )}
      {state === 'processing' && <span className="dict-spin" />}
      <span className="dict-label">{LABEL[state] ?? state}</span>
      {state === 'listening' && <span className="dict-hint">Esc — отмена</span>}
    </div>
  )
}
