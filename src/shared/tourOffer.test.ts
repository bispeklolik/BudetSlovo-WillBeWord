import { describe, it, expect } from 'vitest'
import {
  tourOffer,
  hintsDue,
  withChoice,
  withDismissed,
  withDone,
  withSectionSeen,
  withHintsReset,
  withStart,
  type OfferFacts
} from './tourOffer'

const base: OfferFacts = { onboarded: true, ownRecords: 0, dictations: 0, wizardJustDone: false }

describe('tourOffer: когда показывать гайд', () => {
  it('сразу после мастера — экран выбора', () => {
    expect(tourOffer({ ...base, wizardJustDone: true })).toBe('choice')
    expect(tourOffer({ ...base, onboarded: false, wizardJustDone: true })).toBe('choice')
  })
  it('пока мастер на экране — ничего', () => {
    expect(tourOffer({ ...base, onboarded: false })).toBeNull()
  })
  it('новый человек закрыл программу, не ответив, — экран выбора снова', () => {
    expect(tourOffer(base)).toBe('choice')
  })
  it('уже пользуется (записи или диктовки) — карточка на Главной', () => {
    expect(tourOffer({ ...base, ownRecords: 2 })).toBe('card')
    expect(tourOffer({ ...base, dictations: 1 })).toBe('card')
  })
  it('предложение закрыто — больше не показываем, в любом случае', () => {
    const tours = { offered: true }
    expect(tourOffer({ ...base, tours })).toBeNull()
    expect(tourOffer({ ...base, tours, ownRecords: 3 })).toBeNull()
    expect(tourOffer({ ...base, tours, wizardJustDone: true })).toBeNull()
  })
})

describe('подсказки в разделах', () => {
  it('идут только при выборе «Коротко» и один раз на раздел', () => {
    expect(hintsDue(undefined, 'library')).toBe(false)
    expect(hintsDue({ mode: 'full' }, 'library')).toBe(false)
    expect(hintsDue({ mode: 'later' }, 'library')).toBe(false)
    expect(hintsDue({ mode: 'short' }, 'library')).toBe(true)
    expect(hintsDue({ mode: 'short', seen: ['library'] }, 'library')).toBe(false)
    expect(hintsDue({ mode: 'short', seen: ['library'] }, 'notes')).toBe(true)
  })
  it('withSectionSeen не дублирует и не теряет остальное', () => {
    const a = withSectionSeen({ mode: 'short', done: ['short'] }, 'ask')
    const b = withSectionSeen(a, 'ask')
    expect(b).toEqual({ mode: 'short', done: ['short'], seen: ['ask'] })
  })
  it('сброс: режим «Коротко», список увиденного пуст, предложение закрыто', () => {
    expect(withHintsReset({ mode: 'later', seen: ['ask', 'notes'], done: ['full'] })).toEqual({
      offered: true,
      mode: 'short',
      seen: [],
      done: ['full']
    })
  })
})

describe('запись ответов', () => {
  it('выбор закрывает предложение и запоминает режим', () => {
    expect(withChoice(undefined, 'full')).toEqual({ offered: true, mode: 'full' })
    expect(withChoice({ seen: ['ask'] }, 'later')).toEqual({ offered: true, mode: 'later', seen: ['ask'] })
  })
  it('крестик на карточке закрывает предложение и не включает подсказки', () => {
    expect(withDismissed(undefined)).toEqual({ offered: true, mode: 'later' })
    expect(withDismissed({ mode: 'short' }).mode).toBe('short')
  })
  it('withDone копит пройденные туры без повторов', () => {
    const a = withDone(undefined, 'short')
    expect(withDone(withDone(a, 'full'), 'short').done).toEqual(['short', 'full'])
  })
})

describe('запуск тура', () => {
  it('«Коротко» включает подсказки в разделах', () => {
    expect(withStart(undefined, 'short')).toEqual({ offered: true, mode: 'short' })
    expect(withStart({ mode: 'later' }, 'short').mode).toBe('short')
  })
  it('«Подробно» не выключает подсказки тому, кто выбрал «Коротко»', () => {
    expect(withStart({ mode: 'short' }, 'full').mode).toBe('short')
    expect(withStart({ mode: 'later' }, 'full').mode).toBe('full')
    expect(withStart(undefined, 'full').mode).toBe('full')
  })
})
