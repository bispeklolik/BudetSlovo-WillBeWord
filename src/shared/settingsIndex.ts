// Оглавление настроек: разделы и список настроек для поиска.
// Страница (renderer/views/Settings.tsx) ставит каждой настройке id="..." —
// тест settingsIndex.test.ts следит, чтобы список и страница не расходились.

export type SettingsSection =
  | 'general'
  | 'dictation'
  | 'records'
  | 'engines'
  | 'connections'
  | 'privacy'

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'Общие' },
  { id: 'dictation', label: 'Диктовка' },
  { id: 'records', label: 'Записи и звонки' },
  { id: 'engines', label: 'Движки и ключи' },
  { id: 'connections', label: 'Подключения' },
  { id: 'privacy', label: 'Приватность и данные' }
]

export interface SettingEntry {
  id: string
  section: SettingsSection
  label: string
  /** Дополнительные слова для поиска (через пробел). */
  words?: string
}

export const SETTING_ENTRIES: SettingEntry[] = [
  // Общие
  { id: 'theme', section: 'general', label: 'Тёмная тема', words: 'тема оформление светлая цвет' },
  { id: 'wizard', section: 'general', label: 'Пройти настройку заново', words: 'мастер с чего начать пример облако' },
  { id: 'tour', section: 'general', label: 'Обучение: пройти тур, подсказки в разделах', words: 'гайд тур подсказки знакомство коротко подробно' },
  { id: 'hotkeys', section: 'general', label: 'Горячие клавиши в записи', words: 'пробел поиск отменить скорость' },
  { id: 'about', section: 'general', label: 'О программе', words: 'версия слово' },
  // Диктовка
  { id: 'dict-enabled', section: 'dictation', label: 'Диктовка в любое окно', words: 'включить выключить' },
  { id: 'dict-hotkey', section: 'dictation', label: 'Клавиша диктовки', words: 'горячая кнопка' },
  { id: 'dict-mic', section: 'dictation', label: 'Микрофон', words: 'устройство звук' },
  { id: 'dict-paste', section: 'dictation', label: 'Вставлять в активное окно', words: 'буфер обмена куда вставлять' },
  { id: 'dict-tail', section: 'dictation', label: 'Дописывать после отпускания клавиши', words: 'хвост задержка мс' },
  { id: 'dict-pausemedia', section: 'dictation', label: 'Ставить музыку и видео на паузу', words: 'медиа плеер' },
  { id: 'dict-sounds', section: 'dictation', label: 'Звуковые сигналы', words: 'звук щелчок' },
  { id: 'dict-keepaudio', section: 'dictation', label: 'Хранить аудио диктовок', words: 'повторить дни' },
  { id: 'dict-editbyvoice', section: 'dictation', label: 'Shift + клавиша: правка голосом', words: 'выделенный текст мягче сократи' },
  { id: 'dict-live', section: 'dictation', label: 'Текст во время речи', words: 'плашка deepgram' },
  { id: 'dict-polish', section: 'dictation', label: 'ИИ-чистка текста', words: 'паразиты пунктуация' },
  { id: 'dict-modes', section: 'dictation', label: 'Словарь и режимы', words: 'замены сниппеты свои режимы правила по программам' },
  { id: 'dict-mode', section: 'dictation', label: 'Режим по умолчанию', words: 'сообщение письмо чистка дополнительно' },
  { id: 'dict-tone', section: 'dictation', label: 'Тон', words: 'мягкий деловой дополнительно' },
  { id: 'dict-automode', section: 'dictation', label: 'Режим по программе', words: 'telegram почта дополнительно' },
  { id: 'dict-digits', section: 'dictation', label: 'Числа и даты цифрами', words: 'дополнительно' },
  { id: 'dict-punct', section: 'dictation', label: 'Пунктуация голосом', words: 'запятая с новой строки дополнительно' },
  { id: 'dict-fuzzy', section: 'dictation', label: 'Исправлять слова по словарю', words: 'похожие дополнительно' },
  { id: 'dict-dropcorr', section: 'dictation', label: 'Убирать оговорки', words: 'нет в среду дополнительно' },
  { id: 'dict-history', section: 'dictation', label: 'История диктовок', words: 'последние повторить исправить слушать страница' },
  // Записи и звонки
  { id: 'pause-mark', section: 'records', label: 'Отмечать паузы в тексте', words: 'секунды' },
  { id: 'pause-export', section: 'records', label: 'Паузы в экспорте', words: 'word txt md' },
  { id: 'call-prompt', section: 'records', label: 'Предлагать запись звонка', words: 'telegram zoom whatsapp teams' },
  { id: 'call-muted', section: 'records', label: 'Не предлагать для программ', words: 'вернуть' },
  { id: 'consent', section: 'records', label: 'Согласие клиента на запись', words: 'шаблон' },
  // Движки и ключи
  { id: 'stt-engine', section: 'engines', label: 'Распознавание речи: движок', words: 'расшифровка elevenlabs deepgram assemblyai openai groq whisper' },
  { id: 'stt-key', section: 'engines', label: 'Ключ распознавания', words: 'api проверить' },
  { id: 'stt-local', section: 'engines', label: 'Локальный движок: модель и устройство', words: 'видеокарта процессор cuda скачать дополнительно' },
  { id: 'ai-engine', section: 'engines', label: 'ИИ: движок', words: 'claude openrouter локально саммари' },
  { id: 'ai-key', section: 'engines', label: 'Ключ ИИ', words: 'anthropic openrouter api проверить' },
  { id: 'ai-model', section: 'engines', label: 'Модель ИИ', words: 'haiku sonnet opus' },
  // Подключения
  { id: 'mcp', section: 'connections', label: 'Claude читает записи (MCP)', words: 'claude desktop' },
  { id: 'phone', section: 'connections', label: 'Запись с телефона', words: 'qr' },
  { id: 'watch', section: 'connections', label: 'Папка-наблюдатель', words: 'onedrive диск синхронизация' },
  { id: 'link', section: 'connections', label: 'Ссылка YouTube и VK', words: 'видео' },
  // Приватность и данные
  { id: 'datadir', section: 'privacy', label: 'Где лежат данные', words: 'папка открыть' },
  { id: 'backup', section: 'privacy', label: 'Копия данных', words: 'резервная zip сохранить' },
  { id: 'restore', section: 'privacy', label: 'Восстановить из копии', words: 'резервная zip' }
]

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е')

/** Поиск по настройкам: все слова запроса должны встретиться в названии или словах. */
export function searchSettings(query: string): SettingEntry[] {
  const tokens = norm(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  return SETTING_ENTRIES.filter((e) => {
    const hay = norm(e.label + ' ' + (e.words ?? ''))
    return tokens.every((t) => hay.includes(t))
  })
}

export function isSettingsSection(x: unknown): x is SettingsSection {
  return SETTINGS_SECTIONS.some((s) => s.id === x)
}
