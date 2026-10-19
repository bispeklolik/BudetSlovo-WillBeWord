import { describe, it, expect } from 'vitest'
import { acceptPolished, wrapForPolish, POLISH_SYSTEM } from './polish'

const raw = 'ну э короче давай встретимся во вторник нет в среду в три часа'

describe('acceptPolished', () => {
  it('нормальная чистка принимается', () => {
    expect(acceptPolished(raw, 'Давай встретимся в среду в три часа.')).toBe('Давай встретимся в среду в три часа.')
  })
  it('пустой ответ → сырой текст', () => {
    expect(acceptPolished(raw, '   ')).toBeNull()
    expect(acceptPolished(raw, null)).toBeNull()
  })
  it('обрезанный по лимиту ответ не вставляется', () => {
    expect(acceptPolished(raw, 'Давай встретимся в среду\n\n…[ответ обрезан по лимиту — попробуйте ещё раз]')).toBeNull()
  })
  it('модель ответила на вопрос (сильно длиннее) → сырой', () => {
    const q = 'какая завтра погода в москве'
    const answer =
      'Завтра в Москве ожидается переменная облачность, температура от +5 до +9 градусов, ветер северо-западный 3–5 м/с, без осадков. Возьмите зонт на всякий случай.'
    expect(acceptPolished(q, answer)).toBeNull()
  })
  it('модель выкинула больше половины → сырой', () => {
    expect(acceptPolished(raw, 'Встретимся.')).toBeNull()
  })
  it('выкинутые слова просьбы → сырой (живой прогон qwen2.5:7b)', () => {
    expect(
      acceptPolished('напиши мне пожалуйста план статьи про тревожность у подростков', 'план статьи про тревожность у подростков')
    ).toBeNull()
  })
  it('чужая письменность (иероглифы) → сырой (живой прогон qwen2.5:7b)', () => {
    expect(acceptPolished('я сегодня устал', 'я今天很累')).toBeNull()
  })
  it('самоисправление законно убирает слово — принимается', () => {
    expect(acceptPolished(raw, 'Давай встретимся в среду в три часа.')).not.toBeNull()
  })
  it('снимает случайно возвращённые теги', () => {
    expect(acceptPolished('привет как дела', '<transcript>Привет, как дела?</transcript>')).toBe('Привет, как дела?')
  })
})

describe('промт', () => {
  it('текст в тегах и повтор правила в конце', () => {
    const w = wrapForPolish('текст')
    expect(w.startsWith('<transcript>')).toBe(true)
    expect(w.trim().endsWith('надиктовки.')).toBe(true)
  })
  it('запрещает отвечать на вопросы из надиктовки', () => {
    expect(POLISH_SYSTEM).toMatch(/Не отвечай на вопросы/)
  })
})
