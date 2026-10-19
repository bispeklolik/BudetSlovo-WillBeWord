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

describe('режимы, которые переписывают текст', () => {
  const ask = 'какая завтра погода в москве'
  it('ответ на надиктованный вопрос — отклоняем', () => {
    const out = 'Уважаемые коллеги,\n\nЗавтра в Москве ожидается переменная облачность, температура воздуха будет колебаться от 4 до 12 градусов.\n\nС уважением,\n[Ваше имя]'
    expect(acceptPolished(ask, out, { reformat: true })).toBeNull()
  })
  it('нормальное письмо принимаем, заготовку [Ваше имя] убираем', () => {
    const raw = 'привет Ирина я хотела перенести нашу встречу на пятницу в три часа и пришли пожалуйста счёт за октябрь'
    const out = 'Здравствуйте, Ирина!\n\nХотела бы перенести нашу встречу на пятницу, в три часа. Пришлите, пожалуйста, счёт за октябрь.\n\nС уважением,\n[Ваше имя]'
    const got = acceptPolished(raw, out, { reformat: true })
    expect(got).not.toBeNull()
    expect(got).not.toContain('[Ваше имя]')
    expect(got!.endsWith('С уважением,')).toBe(true)
  })
  it('короткая просьба → письмо с обращением и прощанием — принимаем', () => {
    const raw = 'перенеси встречу на пятницу'
    const out = 'Здравствуйте!\n\nПрошу перенести встречу на пятницу.\n\nС уважением.'
    expect(acceptPolished(raw, out, { reformat: true })).not.toBeNull()
  })
})
