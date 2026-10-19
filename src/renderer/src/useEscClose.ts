import { useEffect, useRef } from 'react'

// Закрытие модального окна по Esc. Окна бывают вложенными (шаблон согласия —
// поверх настроек): Esc закрывает только ВЕРХНЕЕ окно. Раньше у каждого окна
// был свой обработчик на document, и Esc закрывал сразу оба (ревью волны 4).

const stack: { current: () => void }[] = []
let installed = false

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !stack.length) return
  e.stopPropagation()
  stack[stack.length - 1].current()
}

export function useEscClose(onClose: () => void): void {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!installed) {
      document.addEventListener('keydown', onKey)
      installed = true
    }
    stack.push(ref)
    return () => {
      const i = stack.lastIndexOf(ref)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [])
}
