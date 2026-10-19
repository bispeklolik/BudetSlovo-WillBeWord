import { describe, it, expect } from 'vitest'
import { linkKind, directFileName, ytDlpPercent, ytDlpArgs, shaFor, ytDlpError } from './parse'

describe('linkKind', () => {
  it('сайты, прямые файлы и не ссылки', () => {
    expect(linkKind('https://www.youtube.com/watch?v=abc')).toBe('site')
    expect(linkKind('https://vkvideo.ru/video-1_2')).toBe('site')
    expect(linkKind('https://rutube.ru/video/xyz/')).toBe('site')
    expect(linkKind('https://example.com/files/session.MP3?x=1')).toBe('direct')
    expect(linkKind('file:///C:/a.mp3')).toBe('bad')
    expect(linkKind('просто текст')).toBe('bad')
  })
  it('имя файла из прямой ссылки', () => {
    expect(directFileName('https://e.com/a/%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C.m4a')).toBe('запись.m4a')
  })
})

describe('yt-dlp', () => {
  it('процент загрузки', () => {
    expect(ytDlpPercent('[download]  42.3% of   3.21MiB at  1.20MiB/s ETA 00:01')).toBe(42.3)
    expect(ytDlpPercent('[youtube] abc: Downloading webpage')).toBeNull()
  })
  it('аргументы: только звук, один ролик, ffmpeg и печать пути', () => {
    const a = ytDlpArgs(' https://youtu.be/x ', 'C:/t', 'C:/ff.exe')
    expect(a).toContain('bestaudio/best')
    expect(a).toContain('--no-playlist')
    expect(a[a.indexOf('--ffmpeg-location') + 1]).toBe('C:/ff.exe')
    expect(a[a.length - 1]).toBe('https://youtu.be/x')
  })
  it('сумма из SHA2-256SUMS', () => {
    const sums = 'a'.repeat(64) + '  yt-dlp\n' + 'B'.repeat(64) + '  yt-dlp.exe\n'
    expect(shaFor(sums, 'yt-dlp.exe')).toBe('b'.repeat(64))
    expect(shaFor(sums, 'nope')).toBeNull()
  })
  it('понятные ошибки', () => {
    expect(ytDlpError('ERROR: [youtube] x: Private video. Sign in')).toMatch(/закрыто/)
    expect(ytDlpError('ERROR: Unsupported URL: https://x')).toMatch(/не поддерживается/)
    expect(ytDlpError('ERROR: something odd')).toBe('something odd')
  })
})

describe('ревью волны 5: yt-dlp', () => {
  it('проценты и UTF-8 при --print', () => {
    const a = ytDlpArgs('https://x', 'C:/t', 'ff')
    expect(a).toContain('--progress')
    expect(a[a.indexOf('--encoding') + 1]).toBe('utf-8')
  })
  it('нужен Deno — понятная причина', () => {
    expect(ytDlpError('WARNING: No supported JavaScript runtime could be found. ERROR: x')).toMatch(/Deno/)
  })
})
