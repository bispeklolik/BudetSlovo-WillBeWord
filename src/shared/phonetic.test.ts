import { describe, it, expect } from 'vitest'
import { phoneticKey } from './phonetic'

describe('phoneticKey (русский Metaphone)', () => {
  it('безударные гласные: О/Ы/Я → А, Е/Э → И, Ю → У', () => {
    expect(phoneticKey('молоко')).toBe('малака')
    expect(phoneticKey('лес')).toBe('лис')
    expect(phoneticKey('дым')).toBe('дам')
    expect(phoneticKey('юла')).toBe('ула')
  })
  it('ЙО/ИО/ЙЕ/ИЕ → И', () => {
    expect(phoneticKey('йог')).toBe(phoneticKey('иг'))
    expect(phoneticKey('пионер')).toBe(phoneticKey('пинер'))
    expect(phoneticKey('ёж')).toBe('иш')
  })
  it('оглушение на конце слова', () => {
    expect(phoneticKey('рад')).toBe(phoneticKey('рат'))
    expect(phoneticKey('глаз')).toBe(phoneticKey('глас'))
    expect(phoneticKey('друг')).toBe(phoneticKey('друк'))
  })
  it('оглушение перед согласной, но не перед Л, М, Н, Р', () => {
    expect(phoneticKey('лодка')).toBe(phoneticKey('латка'))
    expect(phoneticKey('обман')).toBe('абман') // б перед м не оглушается
    expect(phoneticKey('облако')).toBe('аблака')
  })
  it('ТС/ДС → Ц', () => {
    expect(phoneticKey('мыться')).toBe(phoneticKey('мыца'))
    expect(phoneticKey('детство')).toBe(phoneticKey('децтво'))
  })
  it('слова, которые легко перепутать на слух, получают близкие ключи', () => {
    expect(phoneticKey('колит')).toBe('калит')
    const a = phoneticKey('коблит')
    const b = phoneticKey('колит')
    expect(a.length - b.length).toBe(1)
  })
  it('пунктуация, регистр и латиница не мешают; пустое слово — пустой ключ', () => {
    expect(phoneticKey('Говорит,')).toBe(phoneticKey('говорит'))
    expect(phoneticKey('abc')).toBe('')
    expect(phoneticKey('')).toBe('')
  })
  it('двойные буквы сворачиваются', () => {
    expect(phoneticKey('масса')).toBe(phoneticKey('маса'))
  })
})
