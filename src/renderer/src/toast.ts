// Ненавязчивое уведомление вместо блокирующего системного alert().
// Без фреймворка: DOM-элемент, автоисчезание, стек в правом нижнем углу.

let box: HTMLDivElement | null = null

function container(): HTMLDivElement {
  if (!box || !document.body.contains(box)) {
    box = document.createElement('div')
    box.className = 'toast-box'
    document.body.appendChild(box)
  }
  return box
}

export function showToast(message: string, kind: 'error' | 'info' = 'error'): void {
  const el = document.createElement('div')
  el.className = 'toast toast-' + kind
  el.textContent = message
  container().appendChild(el)
  setTimeout(() => {
    el.classList.add('toast-out')
    setTimeout(() => el.remove(), 400)
  }, 6000)
  el.addEventListener('click', () => el.remove())
}

// Человеческий текст для известных кодов ошибок ИИ/сети.
export function humanError(err: unknown): string {
  const m = String(err instanceof Error ? err.message : err)
  if (m.includes('AI_UNAVAILABLE')) return 'Не удалось запустить локальный ИИ (Ollama).'
  if (m.includes('AI_MODEL_MISSING')) return 'ИИ не настроен: проверьте модель или ключ в Настройках.'
  if (m.includes('AI_KEY_INVALID')) return 'Ключ не подошёл — проверьте его в Настройках.'
  if (m.includes('TimeoutError') || m.includes('не ответил вовремя'))
    return 'Сервис не ответил вовремя. Проверьте интернет и попробуйте ещё раз.'
  return m.replace(/^Error:\s*/, '')
}
