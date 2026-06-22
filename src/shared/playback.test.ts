import { describe, it, expect } from 'vitest'
import { rateForKey } from './playback'

describe('rateForKey', () => {
  it('цифры 1–4 дают скорости 1× / 1.25× / 1.5× / 2×', () => {
    expect(rateForKey('Digit1')).toBe(1)
    expect(rateForKey('Digit2')).toBe(1.25)
    expect(rateForKey('Digit3')).toBe(1.5)
    expect(rateForKey('Digit4')).toBe(2)
  })

  it('прочие клавиши → null (раскладко-независимо, по e.code)', () => {
    expect(rateForKey('Digit5')).toBeNull()
    expect(rateForKey('Digit0')).toBeNull()
    expect(rateForKey('KeyA')).toBeNull()
    expect(rateForKey('Numpad1')).toBeNull()
    expect(rateForKey('')).toBeNull()
  })

  it('все возвращаемые скорости есть в списке RATES плеера', () => {
    const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]
    for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
      expect(RATES).toContain(rateForKey(code))
    }
  })
})
