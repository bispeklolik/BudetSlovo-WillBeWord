import { describe, it, expect } from 'vitest'
import { applyVoicePunctuation } from './voicePunct'
import { pickModeForApp, DEFAULT_APP_RULES } from './appModes'
import { suggestFromEdit, fuzzyFixVocab, editDistance } from './learn'

describe('пунктуация голосом', () => {
  it('знаки и переводы строк', () => {
    expect(applyVoicePunctuation('привет запятая как дела вопросительный знак')).toBe('Привет, как дела?')
    expect(applyVoicePunctuation('первое с новой строки второе новый абзац третье')).toBe('Первое\nВторое\n\nТретье')
    expect(applyVoicePunctuation('открыть кавычки да закрыть кавычки двоеточие итог')).toBe('«да»: итог')
  })
  it('«точка» — обычное слово, не команда', () => {
    expect(applyVoicePunctuation('у меня своя точка зрения точка')).toBe('у меня своя точка зрения точка')
    expect(applyVoicePunctuation('встретимся у точки сбора запятая Потом обсудим')).toBe('Встретимся у точки сбора, Потом обсудим')
  })
  it('точка с запятой раньше запятой; не трогает «запятая» внутри слов', () => {
    expect(applyVoicePunctuation('раз точка с запятой два')).toBe('Раз; два')
    expect(applyVoicePunctuation('запятаялка')).toBe('запятаялка')
  })
  it('время, числа, ссылки, многоточие и сокращения не портит', () => {
    expect(applyVoicePunctuation('встреча в 14:30 запятая ссылка https://a.ru/x... ок')).toBe(
      'Встреча в 14:30, ссылка https://a.ru/x... ок'
    )
    expect(applyVoicePunctuation('доза 2,5 т. е. мало запятая но')).toBe('Доза 2,5 т. е. мало, но')
    expect(applyVoicePunctuation('без команд,  как есть. т. е. всё')).toBe('без команд,  как есть. т. е. всё')
  })
  it('после «?» и «!» из команды — с заглавной', () => {
    expect(applyVoicePunctuation('как дела вопросительный знак всё хорошо')).toBe('Как дела? Всё хорошо')
  })
  it('команда после уже поставленной движком запятой не двоит знак', () => {
    expect(applyVoicePunctuation('да, запятая, нет')).toBe('Да, нет')
  })
})

describe('режим по программе', () => {
  it('по процессу и по заголовку окна', () => {
    expect(pickModeForApp({ proc: 'telegram', title: 'Анна' }, DEFAULT_APP_RULES)).toBe('message')
    expect(pickModeForApp({ proc: 'chrome', title: 'Входящие — Gmail' }, DEFAULT_APP_RULES)).toBe('email')
    expect(pickModeForApp({ proc: 'winword', title: 'Документ1' }, DEFAULT_APP_RULES)).toBeNull()
  })
  it('короткое правило — только точное имя процесса', () => {
    expect(pickModeForApp({ proc: 'max', title: '' }, DEFAULT_APP_RULES)).toBe('message')
    expect(pickModeForApp({ proc: 'chrome', title: 'Maximum effort' }, DEFAULT_APP_RULES)).toBeNull()
  })
})

describe('словарь учится', () => {
  it('находит заменённые слова', () => {
    expect(suggestFromEdit('метод кэпэтэ помог Еве', 'метод КПТ помог Еве')).toEqual([{ from: 'кэпэтэ', to: 'КПТ' }])
    expect(suggestFromEdit('звонил Шварцаман вчера', 'звонил Шварцман вчера')).toEqual([{ from: 'Шварцаман', to: 'Шварцман' }])
  })
  it('большие вставки и удаления — не ошибка распознавания', () => {
    expect(suggestFromEdit('да', 'да и ещё очень много новых слов про другое')).toEqual([])
  })
  it('правка регистра', () => {
    expect(suggestFromEdit('сеанс кпт', 'сеанс КПТ')).toEqual([{ from: 'кпт', to: 'КПТ' }])
  })
  it('заглавная в начале предложения и числа — не в словарь', () => {
    expect(suggestFromEdit('привет. как дела', 'Привет. Как дела')).toEqual([])
    expect(suggestFromEdit('встреча в 5 часов', 'встреча в 7 часов')).toEqual([])
  })
  it('Левенштейн', () => {
    expect(editDistance('шварцман', 'шварцаман')).toBe(1)
    expect(editDistance('кот', 'собака', 2)).toBe(3)
  })
  it('нечёткое исправление по словарю — осторожно', () => {
    expect(fuzzyFixVocab('звонил Шварцаман и Шварцман', ['Шварцман'])).toBe('звонил Шварцман и Шварцман')
    expect(fuzzyFixVocab('гештальт гешталт', ['гештальт'])).toBe('гештальт гештальт')
    // другая первая буква и короткие слова не трогаем
    expect(fuzzyFixVocab('Мварцман кот', ['Шварцман', 'кот'])).toBe('Мварцман кот')
  })
  it('падеж не откатывает, своё окончание сохраняет', () => {
    expect(fuzzyFixVocab('позвоню Марине и Мариной', ['Марина'])).toBe('позвоню Марине и Мариной')
    expect(fuzzyFixVocab('варенье малина', ['Марина'])).toBe('варенье малина')
    expect(fuzzyFixVocab('у Шварцамана', ['Шварцман'])).toBe('у Шварцмана')
  })
})
