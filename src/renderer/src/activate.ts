import type React from 'react'

// Клавиатура для «кнопок-не-кнопок» (карточки, строки дерева): Enter и пробел
// срабатывают как клик, но только когда фокус на самой строке, а не на кнопке внутри.
export function onActivate(fn: () => void): (e: React.KeyboardEvent) => void {
  return (e) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }
}
