import { describe, it, expect } from 'vitest'
import { deepgramLiveUrl, joinLive } from './live'
import { acceptEdit } from './polish'
import { buildPolishSystem, EDIT_SYSTEM, wrapForEdit } from '../../shared/dictModes'

describe('поток Deepgram', () => {
  it('русская модель Nova-3, промежуточные результаты, без кодировки (webm как есть)', () => {
    const u = new URL(deepgramLiveUrl())
    expect(u.protocol).toBe('wss:')
    expect(u.searchParams.get('model')).toBe('nova-3')
    expect(u.searchParams.get('language')).toBe('ru')
    expect(u.searchParams.get('interim_results')).toBe('true')
    expect(u.searchParams.has('encoding')).toBe(false)
  })
  it('итоговые куски + промежуточный хвост', () => {
    expect(joinLive(['Привет,', 'как дела'], ' у те')).toBe('Привет, как дела у те')
    expect(joinLive([], '')).toBe('')
  })
})

describe('правка выделенного', () => {
  it('промт: не отвечать на вопрос, вернуть только текст', () => {
    expect(EDIT_SYSTEM).toMatch(/не ответ/)
    expect(wrapForEdit('текст', 'сократи')).toContain('<instruction>\nсократи\n</instruction>')
  })
  it('acceptEdit: пусто, обрезано, чужая письменность — не трогаем текст', () => {
    expect(acceptEdit('Привет', '')).toBeNull()
    expect(acceptEdit('Привет', 'Здравствуйте [ответ обрезан')).toBeNull()
    expect(acceptEdit('Привет', '你好')).toBeNull()
    expect(acceptEdit('Привет', '<text>Здравствуйте</text>')).toBe('Здравствуйте')
  })
})

describe('цифры', () => {
  it('правило «числа цифрами» — только когда включено', () => {
    expect(buildPolishSystem('clean', 'neutral', [], [], { digits: true })).toMatch(/цифрами/)
    expect(buildPolishSystem('clean', 'neutral', [], [])).not.toMatch(/цифрами/)
  })
})
