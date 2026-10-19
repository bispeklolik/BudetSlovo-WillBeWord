import { describe, it, expect } from 'vitest'
import { parseNvidiaSmi, freeBytes } from './sysinfo'

describe('parseNvidiaSmi', () => {
  it('разбирает имя и память', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 3060, 12288\r\n')).toEqual({ name: 'NVIDIA GeForce RTX 3060', vramMb: 12288 })
  })
  it('пусто → null', () => expect(parseNvidiaSmi('')).toBeNull())
})

describe('freeBytes', () => {
  it('для несуществующей папки берёт ближайшую существующую', () => {
    const n = freeBytes('C:\Windows\нет\такой\папки')
    expect(n).toBeGreaterThan(0)
  })
})
