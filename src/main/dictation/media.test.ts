import { describe, it, expect } from 'vitest'
import { parsePaused } from './media'

describe('parsePaused', () => {
  it('список источников, поставленных на паузу', () => {
    expect(parsePaused('PAUSED:Spotify.exe|Chrome\r\n')).toEqual(['Spotify.exe', 'Chrome'])
  })
  it('ничего не играло → пусто (ничего не возобновляем)', () => {
    expect(parsePaused('PAUSED:\r\n')).toEqual([])
    expect(parsePaused('')).toEqual([])
  })
})
