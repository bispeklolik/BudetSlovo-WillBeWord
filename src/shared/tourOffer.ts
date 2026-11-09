import type { TourId, ToursState } from './types'

// Интерактивный гайд: когда что показывать. Чистые функции — их проверяют тесты.
// Флаги лежат в settings.tours (см. types.ts).

/** Разделы, где при первом заходе всплывают 2–3 подсказки. */
export type HintSection = 'library' | 'record' | 'notes' | 'ask' | 'dictation' | 'vocab' | 'settings'

export const HINT_SECTIONS: HintSection[] = ['library', 'record', 'notes', 'ask', 'dictation', 'vocab', 'settings']

/** 'choice' — экран «Как познакомиться со „Словом“?»; 'card' — карточка на Главной; null — ничего. */
export type TourOffer = 'choice' | 'card' | null

export interface OfferFacts {
  /** Мастер первого запуска пройден. */
  onboarded: boolean
  tours?: ToursState
  /** Записи, кроме примера. */
  ownRecords: number
  /** Удачных диктовок за всё время. */
  dictations: number
  /** Мастер только что закрыт (в этом запуске) — показываем экран выбора сразу. */
  wizardJustDone: boolean
}

export function tourOffer(f: OfferFacts): TourOffer {
  if (f.tours?.offered) return null // предложение уже закрыли — больше не показываем
  if (f.wizardJustDone) return 'choice'
  if (!f.onboarded) return null // мастер ещё на экране
  // Уже пользуется: один раз спокойная карточка на Главной, а не экран поверх всего.
  if (f.ownRecords > 0 || f.dictations > 0) return 'card'
  // Новый человек, который закрыл программу, не ответив на экран выбора.
  return 'choice'
}

/** Подсказки раздела нужны: человек выбрал «Коротко» и в этом разделе их ещё не было. */
export function hintsDue(tours: ToursState | undefined, section: HintSection): boolean {
  return tours?.mode === 'short' && !(tours.seen ?? []).includes(section)
}

/** Ответ на предложение. «Позже» тоже закрывает предложение: вернуться можно из Настроек. */
export function withChoice(tours: ToursState | undefined, choice: TourId | 'later'): ToursState {
  return { ...tours, offered: true, mode: choice }
}

/** Предложение закрыто без выбора (крестик на карточке). */
export function withDismissed(tours: ToursState | undefined): ToursState {
  return { ...tours, offered: true, mode: tours?.mode ?? 'later' }
}

export function withDone(tours: ToursState | undefined, id: TourId): ToursState {
  const done = new Set(tours?.done ?? [])
  done.add(id)
  return { ...tours, done: [...done] }
}

export function withSectionSeen(tours: ToursState | undefined, section: HintSection): ToursState {
  const seen = new Set(tours?.seen ?? [])
  seen.add(section)
  return { ...tours, seen: [...seen] }
}

/** «Снова показывать подсказки в разделах»: режим «Коротко» и пустой список увиденного. */
export function withHintsReset(tours: ToursState | undefined): ToursState {
  return { ...tours, offered: true, mode: 'short', seen: [] }
}

/**
 * Тур запущен. «Коротко» включает подсказки в разделах. «Подробно» их не включает,
 * но и не выключает тому, кто уже выбрал «Коротко».
 */
export function withStart(tours: ToursState | undefined, id: TourId): ToursState {
  const mode: ToursState['mode'] = id === 'short' || tours?.mode === 'short' ? 'short' : 'full'
  return { ...tours, offered: true, mode }
}
