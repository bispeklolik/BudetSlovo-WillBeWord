// Нарезка длинного текста по границам строк (реплик) для map-reduce:
// локальная модель ограничена контекстом (~16k токенов ≈ 45k символов),
// 2-часовая сессия не влезает целиком — обрабатываем частями и сводим.

export function chunkByLines(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const lines = text.split('\n')
  const chunks: string[] = []
  let cur = ''
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > maxChars) {
      chunks.push(cur)
      cur = line
    } else {
      cur = cur ? cur + '\n' + line : line
    }
    // Одна строка длиннее лимита — режем жёстко, чтобы не зациклиться.
    while (cur.length > maxChars) {
      chunks.push(cur.slice(0, maxChars))
      cur = cur.slice(maxChars)
    }
  }
  if (cur) chunks.push(cur)
  return chunks
}
