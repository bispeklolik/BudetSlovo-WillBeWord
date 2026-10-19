import { describe, it, expect } from 'vitest'
import {
  recommendModel,
  deviceArgs,
  requiredBytes,
  formatBytes,
  localModel,
  ENGINE_RELEASE,
  LOCAL_MODELS
} from './localModels'

describe('recommendModel', () => {
  it('нет NVIDIA → medium', () => expect(recommendModel(null)).toBe('medium'))
  it('RTX 3060 12 ГБ → large-v3', () => expect(recommendModel({ name: 'RTX 3060', vramMb: 12288 })).toBe('large-v3'))
  it('4 ГБ видеопамяти → turbo', () => expect(recommendModel({ name: 'GTX 1650', vramMb: 4096 })).toBe('large-v3-turbo'))
})

describe('deviceArgs', () => {
  it('auto + видеокарта → cuda float16 (как раньше у владельца)', () => {
    expect(deviceArgs('auto', true)).toEqual(['--device', 'cuda', '--compute_type', 'float16'])
  })
  it('auto без видеокарты → cpu int8', () => {
    expect(deviceArgs(undefined, false)).toEqual(['--device', 'cpu', '--compute_type', 'int8'])
  })
  it('явный cpu побеждает видеокарту', () => {
    expect(deviceArgs('cpu', true)).toEqual(['--device', 'cpu', '--compute_type', 'int8'])
  })
})

describe('requiredBytes / formatBytes / каталог', () => {
  it('движок + large-v3 ≈ 10 ГБ с запасом', () => {
    const n = requiredBytes('large-v3', true)
    expect(n).toBeGreaterThan(9e9)
    expect(n).toBeLessThan(11e9)
  })
  it('только модель — без движка', () => {
    expect(requiredBytes('small', false)).toBeLessThan(6e8)
  })
  it('формат по-русски', () => {
    expect(formatBytes(3_092_000_000)).toBe('3,1 ГБ')
    expect(formatBytes(486_000_000)).toBe('486 МБ')
  })
  it('неизвестная модель → large-v3', () => expect(localModel('zzz').id).toBe('large-v3'))
  it('имя архива движка распознаётся', () => {
    expect(ENGINE_RELEASE.asset.test('Faster-Whisper-XXL_r245.4_windows.7z')).toBe(true)
    expect(ENGINE_RELEASE.asset.test('Faster-Whisper-XXL_r245.4_linux.7z')).toBe(false)
  })
  it('у всех моделей оценки 1–5', () => {
    for (const m of LOCAL_MODELS) for (const v of [m.accuracy, m.speedGpu, m.speedCpu]) expect(v).toBeGreaterThanOrEqual(1)
  })
})
