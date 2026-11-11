import { buildIndex, type WordIndex } from '../../shared/wordVariants'
// Список вшит в сборку (?raw): работает и в dev, и в упакованной программе (out/** уходит в установщик).
// Источник и лицензия (CC BY-SA 4.0) — data/SOURCE.md.
import ruRaw from './data/ru_50k.txt?raw'

let index: WordIndex | null = null

/** Индекс русских слов по звучанию. Строится лениво один раз (~20 мс). */
export function getWordIndex(): WordIndex {
  if (!index) index = buildIndex(ruRaw)
  return index
}
