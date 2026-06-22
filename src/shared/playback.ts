// Горячие клавиши скорости воспроизведения: цифры 1–4 → удобные скорости.
// По e.code (раскладко-независимо: на RU верхний ряд цифр тот же). 1× — норма,
// дальше ускорение для проглядывания; 0.75×/1.75× остаются в выпадающем списке.
const RATE_BY_CODE: Record<string, number> = {
  Digit1: 1,
  Digit2: 1.25,
  Digit3: 1.5,
  Digit4: 2
}

export function rateForKey(code: string): number | null {
  return RATE_BY_CODE[code] ?? null
}
