import { buildIndex, type WordIndex } from '../../shared/wordVariants'
// Списки вшиты в сборку (?raw): работают и в dev, и в упакованной программе (out/** уходит в установщик).
// ru_50k — частотный список из субтитров, источник и лицензия (CC BY-SA 4.0) — data/SOURCE.md.
// psy_terms — слова психологии со всеми формами (тревожность, созависимость, обесценивание…),
// которых нет в субтитрах; составлен для «Слова» 11.11.2026. В нём только слова, которых нет в ru_50k.
import ruRaw from './data/ru_50k.txt?raw'
import psyRaw from './data/psy_terms.txt?raw'

let index: WordIndex | null = null

/** Индекс русских слов по звучанию. Строится лениво один раз (~25 мс). */
export function getWordIndex(): WordIndex {
  if (!index) index = buildIndex(ruRaw + '\n' + psyRaw)
  return index
}
