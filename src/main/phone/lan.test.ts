import { describe, it, expect } from 'vitest'
import { lanAddresses, safeFileName, sameToken } from './lan'

describe('lanAddresses', () => {
  it('домашняя сеть первой, без петли, IPv6 и служебных адресов', () => {
    expect(
      lanAddresses({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        vpn: [{ address: '10.8.0.2', family: 'IPv4', internal: false }],
        wifi: [
          { address: 'fe80::1', family: 'IPv6', internal: false },
          { address: '192.168.1.34', family: 'IPv4', internal: false }
        ],
        apipa: [{ address: '169.254.10.1', family: 4, internal: false }]
      })
    ).toEqual(['192.168.1.34', '10.8.0.2'])
  })
})

describe('safeFileName', () => {
  it('оставляет имя аудио и видео', () => {
    expect(safeFileName('Запись 12.m4a')).toBe('Запись 12.m4a')
    expect(safeFileName('VID_2026.mp4')).toBe('VID_2026.mp4')
  })
  it('режет пути и служебные знаки', () => {
    expect(safeFileName('..\\..\\Windows\\evil.mp3')).toBe('evil.mp3')
    expect(safeFileName('a:b?.wav')).toBe('a_b_.wav')
  })
  it('не медиа — нет', () => {
    expect(safeFileName('virus.exe')).toBeNull()
    expect(safeFileName('.m4a')).toBeNull()
    expect(safeFileName('')).toBeNull()
  })
})

describe('sameToken', () => {
  it('сравнивает', () => {
    expect(sameToken('abc', 'abc')).toBe(true)
    expect(sameToken('abc', 'abd')).toBe(false)
    expect(sameToken('abc', 'ab')).toBe(false)
  })
})
