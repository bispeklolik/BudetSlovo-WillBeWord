import { describe, it, expect } from 'vitest'
import { pickEngineAsset, modelFilesFromTree, parse7zPercent } from './setup'

describe('pickEngineAsset', () => {
  it('берёт самый свежий виндовый архив, не linux', () => {
    const a = pickEngineAsset([
      { name: 'Faster-Whisper-XXL_r192.3.4_windows.7z', size: 1, browser_download_url: 'a' },
      { name: 'Faster-Whisper-XXL_r245.4_linux.7z', size: 1, browser_download_url: 'b' },
      { name: 'Faster-Whisper-XXL_r245.4_windows.7z', size: 1, browser_download_url: 'c' },
      { name: 'Faster-Whisper-XXL_r245.1_windows.7z', size: 1, browser_download_url: 'd' }
    ])
    expect(a?.browser_download_url).toBe('c')
  })
  it('пусто → null', () => expect(pickEngineAsset([])).toBeNull())
})

describe('modelFilesFromTree', () => {
  it('без README/.gitattributes, sha256 только у LFS', () => {
    const f = modelFilesFromTree([
      { type: 'file', path: '.gitattributes', size: 1 },
      { type: 'file', path: 'README.md', size: 2 },
      { type: 'file', path: 'config.json', size: 2394 },
      { type: 'file', path: 'model.bin', size: 135, lfs: { oid: 'abc', size: 3087284237 } },
      { type: 'directory', path: 'x', size: 0 }
    ])
    expect(f).toEqual([
      { path: 'config.json', size: 2394, sha256: undefined },
      { path: 'model.bin', size: 3087284237, sha256: 'abc' }
    ])
  })
})

describe('parse7zPercent', () => {
  it('берёт последний процент из куска вывода', () => {
    expect(parse7zPercent('  3% 10 - a\r  42% 13 - b')).toBe(42)
    expect(parse7zPercent('Everything is Ok')).toBeNull()
  })
})
