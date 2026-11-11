import { describe, it, expect } from 'vitest'
import { getWordIndex } from './ruWords'
import { soundCandidates, MIN_SOUND_FREQ } from '../../shared/wordVariants'

// Настоящий индекс: субтитры + слова психологии (11.11.2026).
describe('индекс слов по звучанию', () => {
  const idx = getWordIndex()
  const shown = (w: string): string[] => soundCandidates(w, idx, 5, MIN_SOUND_FREQ).map((v) => v.text)

  it('в индексе есть слова психологии, которых нет в субтитрах', () => {
    for (const w of ['тревожность', 'тревожности', 'созависимость', 'обесценивание', 'руминация']) {
      expect(idx.words, w).toContain(w)
    }
  })
  it('ослышка в термине даёт термин', () => {
    expect(shown('трефожность')).toContain('тревожность')
    expect(shown('созовисимость')).toContain('созависимость')
    expect(shown('обесцениванее')).toContain('обесценивание')
  })
  it('обычные слова по-прежнему находятся', () => {
    expect(shown('тривога')).toContain('тревога')
    expect(shown('Здраствуйте,')).toContain('здравствуйте')
  })
})
