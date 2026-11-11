// Русский Metaphone по правилам Каньковского: слово → «звуковой ключ».
// Слова, которые звучат одинаково или почти одинаково, получают один и тот же ключ
// («колит» и «калит», «рад» и «рат»). Нужен для подбора вариантов неуверенного слова.

const VOICED_TO_VOICELESS: Record<string, string> = { б: 'п', з: 'с', д: 'т', в: 'ф', г: 'к', ж: 'ш' }
// Перед этими согласными звонкая не оглушается.
const KEEP_VOICED_BEFORE = new Set(['л', 'м', 'н', 'р'])
const VOWELS = new Set(['а', 'и', 'у'])

export function phoneticKey(word: string): string {
  let s = word.toLowerCase().replace(/[^а-яё]/g, '')
  if (!s) return ''
  // 1. Сочетания с «й»: ЙО/ИО/ЙЕ/ИЕ → И. Буква «ё» — это «йо».
  s = s.replace(/ё/g, 'йо').replace(/(?:й|и)[ое]/g, 'и')
  // 2. Гласные в безударной позиции: О/Ы/Я → А; Е/Э → И; Ю → У. Знаки ь, ъ не звучат.
  s = s.replace(/[оыя]/g, 'а').replace(/[еэ]/g, 'и').replace(/ю/g, 'у').replace(/[ьъ]/g, '')
  // 3. ТС/ДС → Ц («мыться» → «мыца»).
  s = s.replace(/[тд]с/g, 'ц')
  // 4. Оглушение: на конце слова и перед согласной (кроме Л, М, Н, Р).
  const chars = [...s]
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    const v = VOICED_TO_VOICELESS[c]
    if (!v) continue
    const next = chars[i + 1]
    if (next === undefined || (!VOWELS.has(next) && !KEEP_VOICED_BEFORE.has(next))) chars[i] = v
  }
  // 5. Двойные буквы звучат как одна.
  return chars.join('').replace(/(.)\1+/g, '$1')
}
