import type { SettingsSection } from './settingsIndex'
import type { HintSection } from './tourOffer'
import type { TourId } from './types'

// Сценарии интерактивного гайда — это данные. Чтобы добавить шаг, допишите объект
// в нужный массив. Каждый якорь (anchor) — атрибут data-tour="..." на элементе
// интерфейса; тест tourScenarios.test.ts проверяет, что якорь есть в коде renderer.
//
// Правила текста: коротко, просто, одна мысль в предложении.
// В тексте можно писать {hotkey} — подставится клавиша диктовки из настроек.

/** Куда перейти перед шагом. Без overlay окна «Спросить», «Словарь», «Режимы» закрываются. */
export interface TourNav {
  page?: 'home' | 'library' | 'notes' | 'dictation' | 'settings' | 'demo'
  /** Раздел настроек (для page: 'settings'). */
  section?: SettingsSection
  overlay?: 'ask' | 'words' | 'modes'
}

/** Чего ждёт шаг от человека. Любое из условий пускает дальше. */
export interface TourWait {
  /** Человек нажал на подсвеченный элемент. */
  click?: boolean
  /** На экране появился элемент с таким якорем (например, открылась запись). */
  appears?: string
  /** Диктовка включена в настройках. */
  dictEnabled?: boolean
  /** В журнал легла новая диктовка. */
  dictation?: boolean
}

export interface TourStep {
  id: string
  /** Якорь data-tour. Без якоря подсказка стоит по центру. Нет элемента на экране — шаг пропускается. */
  anchor?: string
  title: string
  text: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  go?: TourNav
  /** Шаг-действие: человек делает сам, тур ждёт. На таком шаге кнопка «Пропустить шаг». */
  wait?: TourWait
  /** Показать шаг, только если диктовка выключена / включена. */
  only?: 'dict-on' | 'dict-off'
}

/** Ставит один переход всем шагам группы. */
function at(go: TourNav, steps: Omit<TourStep, 'go'>[]): TourStep[] {
  return steps.map((s) => ({ ...s, go }))
}

const HOME: TourNav = { page: 'home' }
const DEMO: TourNav = { page: 'demo' }
const NOTES: TourNav = { page: 'notes' }
const LIBRARY: TourNav = { page: 'library' }
const DICT: TourNav = { page: 'dictation' }

// ---------------------------------------------------------------- «Коротко»

export const SHORT_TOUR: TourStep[] = [
  ...at(HOME, [
    {
      id: 'start',
      title: 'Коротко о «Слове»',
      text: 'Покажу главное за 2–3 минуты. Закрыть тур можно на любом шаге. Звонок я не запишу и ИИ не запущу.'
    },
    {
      id: 'menu',
      anchor: 'sidebar',
      side: 'right',
      title: 'Меню',
      text: 'Здесь все разделы: записи, конспекты, вопросы, диктовка, словарь и настройки.'
    },
    {
      id: 'call',
      anchor: 'sidebar-call',
      side: 'right',
      title: 'Записать звонок',
      text: 'Эта кнопка записывает разговор в Zoom, Telegram и других программах. Сейчас её нажимать не нужно.'
    },
    {
      id: 'add',
      anchor: 'sidebar-add',
      side: 'right',
      title: 'Добавить запись',
      text: 'Сюда добавляют файл, запись с телефона, ссылку или папку. «Слово» превращает звук в текст.'
    },
    {
      id: 'open-demo',
      anchor: 'demo-record',
      side: 'top',
      title: 'Откройте пример',
      text: 'Это пример консультации. Звука в нём нет, поэтому он ничего не стоит. Нажмите на него.',
      wait: { click: true, appears: 'editor-text' }
    }
  ]),
  ...at(DEMO, [
    {
      id: 'text',
      anchor: 'editor-text',
      side: 'left',
      title: 'Текст записи',
      text: 'Реплики разложены по собеседникам. Любое слово можно поправить.'
    },
    {
      id: 'make',
      anchor: 'editor-make',
      side: 'bottom',
      title: 'Сделать из текста',
      text: 'ИИ превращает текст в конспект, заметку или письмо. Для этого нужен ключ ИИ. В туре я эту кнопку не нажимаю.'
    }
  ]),
  {
    id: 'notes-nav',
    anchor: 'nav-notes',
    side: 'right',
    go: DEMO,
    title: 'Откройте «Конспекты»',
    text: 'Тут лежат готовые результаты. Для примера они уже есть. Нажмите «Конспекты».',
    wait: { click: true, appears: 'notes-pane' }
  },
  ...at(NOTES, [
    {
      id: 'note',
      anchor: 'note-card',
      side: 'bottom',
      title: 'Готовый конспект',
      text: 'Так выглядит результат ИИ по примеру. Карточку можно открыть, поправить и скопировать.'
    }
  ]),
  {
    id: 'ask',
    anchor: 'nav-ask',
    side: 'right',
    title: 'Спросить',
    text: 'Здесь задают вопрос сразу по всем записям. Ответ приходит со ссылками на нужные места. Нужен ключ ИИ.'
  },
  ...at(DICT, [
    {
      id: 'dict-key',
      anchor: 'dict-key',
      side: 'bottom',
      title: 'Клавиша диктовки',
      text: 'Зажмите {hotkey} и говорите. Текст появится там, где стоит курсор. Отпустите клавишу — запись закончится.'
    },
    {
      id: 'mic-check',
      anchor: 'mic-check',
      side: 'top',
      title: 'Проверьте микрофон',
      text: 'Нажмите «Проверить» и скажите что-нибудь. Полоса покажет, слышно ли вас.',
      wait: { click: true }
    },
    {
      id: 'dict-on',
      anchor: 'dict-switch',
      side: 'left',
      only: 'dict-off',
      title: 'Включите диктовку',
      text: 'Нажмите на переключатель. Без него клавиша не работает.',
      wait: { dictEnabled: true }
    },
    {
      id: 'dictate',
      anchor: 'dict-history',
      side: 'top',
      only: 'dict-on',
      title: 'Продиктуйте фразу',
      text: 'Зажмите {hotkey}, скажите короткую фразу и отпустите клавишу. Фраза появится в истории. Я подожду.',
      wait: { dictation: true }
    }
  ]),
  ...at(HOME, [
    {
      id: 'end',
      title: 'Готово',
      text: 'Меню слева ведёт во все разделы. При первом заходе в раздел я дам пару подсказок. Обучение можно повторить: «Настройки» → «Общие» → «Обучение».'
    }
  ])
]

// ---------------------------------------------------------------- «Подробно»

export const FULL_TOUR: TourStep[] = [
  // Главная
  ...at(HOME, [
    {
      id: 'start',
      title: 'Подробно о «Слове»',
      text: 'Пройдём по всем разделам по порядку. Я сам перехожу между страницами. Закрыть тур можно на любом шаге. Звонок я не запишу и ИИ не запущу.'
    },
    {
      id: 'home-status',
      anchor: 'home-status',
      side: 'bottom',
      title: 'Главная',
      text: 'Здесь видно, включена ли диктовка и какая у неё клавиша.'
    },
    {
      id: 'home-actions',
      anchor: 'home-actions',
      side: 'bottom',
      title: 'Три главных действия',
      text: 'Диктовать — писать голосом в любое окно. Записать звонок — сохранить разговор. Добавить запись — взять готовый файл.'
    },
    {
      id: 'home-checklist',
      anchor: 'home-checklist',
      side: 'top',
      title: 'Настройка',
      text: 'Список из пяти шагов: распознавание, диктовка, первая запись, ИИ и словарь. Выполненные шаги отмечаются сами.'
    },
    {
      id: 'home-summary',
      anchor: 'home-summary',
      side: 'bottom',
      title: 'Сводка',
      text: 'Слова, дни подряд и записи за неделю.'
    },
    {
      id: 'feed-filter',
      anchor: 'feed-filter',
      side: 'bottom',
      title: 'Недавнее',
      text: 'Лента записей и диктовок по дням. Кнопки справа оставляют только записи или только диктовки.'
    }
  ]),
  // Меню
  ...at(HOME, [
    {
      id: 'menu',
      anchor: 'sidebar',
      side: 'right',
      title: 'Меню',
      text: 'Оно всегда слева. Кнопка внизу сворачивает его в узкую полосу.'
    },
    {
      id: 'call',
      anchor: 'sidebar-call',
      side: 'right',
      title: 'Записать звонок',
      text: 'Записывает оба голоса: ваш микрофон и звук компьютера. Когда начнётся звонок, «Слово» само предложит запись. Сейчас эту кнопку нажимать не нужно.'
    },
    {
      id: 'add',
      anchor: 'sidebar-add',
      side: 'right',
      title: 'Добавить запись',
      text: 'Файл, запись с телефона, ссылка на видео или папка-наблюдатель. Файл можно и просто перетащить в окно.'
    },
    {
      id: 'nav-home',
      anchor: 'nav-home',
      side: 'right',
      title: 'Главная',
      text: 'Вернёт на стартовую страницу с лентой.'
    },
    {
      id: 'nav-library',
      anchor: 'nav-library',
      side: 'right',
      title: 'Записи',
      text: 'Все ваши записи. Под этой кнопкой лежат папки.'
    },
    {
      id: 'nav-notes',
      anchor: 'nav-notes',
      side: 'right',
      title: 'Конспекты',
      text: 'Готовые результаты ИИ. Число справа — сколько их.'
    },
    {
      id: 'nav-ask',
      anchor: 'nav-ask',
      side: 'right',
      title: 'Спросить',
      text: 'Вопрос по всем записям сразу. Ответ приходит со ссылками на места в записях.'
    },
    {
      id: 'nav-dictation',
      anchor: 'nav-dictation',
      side: 'right',
      title: 'Диктовка',
      text: 'Страница диктовки: включить, проверить микрофон, посмотреть историю.'
    },
    {
      id: 'nav-vocab',
      anchor: 'nav-vocab',
      side: 'right',
      title: 'Словарь',
      text: 'Имена и термины, которые «Слово» должно писать правильно.'
    },
    {
      id: 'nav-modes',
      anchor: 'nav-modes',
      side: 'right',
      title: 'Режимы',
      text: 'Как ИИ правит надиктованный текст: письмо, сообщение, заметка или свой режим.'
    },
    {
      id: 'nav-settings',
      anchor: 'nav-settings',
      side: 'right',
      title: 'Настройки',
      text: 'Движки, ключи, диктовка, звонки и данные. Загляните туда позже.'
    },
    {
      id: 'sidebar-setup',
      anchor: 'sidebar-setup',
      side: 'right',
      title: 'Ход настройки',
      text: 'Пока не все пять шагов сделаны, здесь видно, сколько осталось.'
    }
  ]),
  // Записи
  ...at(LIBRARY, [
    {
      id: 'lib-toolbar',
      anchor: 'lib-import',
      side: 'bottom',
      title: 'Страница «Записи»',
      text: 'Сверху кнопки добавления. Файл расшифровывается по вашему выбору: в облаке или на этом компьютере.'
    },
    {
      id: 'lib-ask',
      anchor: 'lib-ask',
      side: 'bottom',
      title: 'Спросить записи',
      text: 'Вопрос по записям. Если выбрана папка, искать будем только в ней.'
    },
    {
      id: 'lib-search',
      anchor: 'lib-search',
      side: 'bottom',
      title: 'Поиск',
      text: 'Ищет слово во всех записях и показывает отрывок текста.'
    },
    {
      id: 'lib-cards',
      anchor: 'lib-cards',
      side: 'top',
      title: 'Карточки записей',
      text: 'Карточку можно переименовать, переместить в папку или удалить. Удалённое попадает в Корзину.'
    },
    {
      id: 'folder-tree',
      anchor: 'folder-tree',
      side: 'right',
      title: 'Папки',
      text: 'Перетащите карточку на папку в меню — запись переедет туда.'
    }
  ]),
  // Запись
  ...at(HOME, [
    {
      id: 'open-demo',
      anchor: 'demo-record',
      side: 'top',
      title: 'Откройте пример',
      text: 'Это пример консультации без звука. Нажмите на него.',
      wait: { click: true, appears: 'editor-text' }
    }
  ]),
  ...at(DEMO, [
    {
      id: 'editor-banner',
      anchor: 'editor-banner',
      side: 'bottom',
      title: 'Это пример',
      text: 'У него нет звука. Зато есть текст и готовые конспекты.'
    },
    {
      id: 'editor-text',
      anchor: 'editor-text',
      side: 'left',
      title: 'Текст записи',
      text: 'Реплики по собеседникам. Нажмите на слово — звук перейдёт к нему. Слово можно поправить.'
    },
    {
      id: 'uncertain-word',
      anchor: 'uncertain-word',
      side: 'bottom',
      title: 'Неуверенные слова',
      text: 'Слова, в которых движок не уверен, подсвечены. Щёлкните по такому слову — появятся варианты. Правая кнопка открывает варианты для любого слова.'
    },
    {
      id: 'editor-search',
      anchor: 'editor-search',
      side: 'bottom',
      title: 'Поиск и замена',
      text: 'Найдёт слово в тексте. Можно заменить его везде сразу. Быстрая клавиша — Ctrl+F.'
    },
    {
      id: 'editor-stats',
      anchor: 'editor-stats',
      side: 'bottom',
      title: 'Статистика',
      text: 'Кто сколько говорил в записи.'
    },
    {
      id: 'editor-notes',
      anchor: 'editor-notes',
      side: 'bottom',
      title: 'Мои заметки',
      text: 'Ваши пометки к записи. Из них ИИ делает конспект.'
    },
    {
      id: 'editor-ask',
      anchor: 'editor-ask',
      side: 'bottom',
      title: 'Спросить по записи',
      text: 'Вопрос по этой одной записи. В ответе будут ссылки на время.'
    },
    {
      id: 'editor-make',
      anchor: 'editor-make',
      side: 'bottom',
      title: 'Сделать из текста',
      text: 'Саммари, заметка, протокол — любой результат из готовых карточек. Нужен ключ ИИ. В туре я эту кнопку не нажимаю.'
    },
    {
      id: 'editor-ai',
      anchor: 'editor-ai',
      side: 'bottom',
      title: 'Меню «ИИ»',
      text: 'Причесать текст, найти лучшие мысли, обезличить имена.'
    },
    {
      id: 'editor-export',
      anchor: 'editor-export',
      side: 'bottom',
      title: 'Экспорт',
      text: 'Текст в Word, txt, md или субтитры. Звук тоже можно выгрузить.'
    },
    {
      id: 'editor-player',
      anchor: 'editor-player',
      side: 'top',
      title: 'Проигрыватель',
      text: 'Пробел — играть или пауза. Стрелки перематывают на 5 секунд. В примере звука нет.'
    }
  ]),
  // Конспекты
  {
    id: 'notes-nav',
    anchor: 'nav-notes',
    side: 'right',
    go: DEMO,
    title: 'Откройте «Конспекты»',
    text: 'Для примера готовые результаты уже лежат здесь. Нажмите «Конспекты».',
    wait: { click: true, appears: 'notes-pane' }
  },
  ...at(NOTES, [
    {
      id: 'notes-search',
      anchor: 'notes-search',
      side: 'bottom',
      title: 'Поиск по конспектам',
      text: 'Ищет по названию и тексту.'
    },
    {
      id: 'note-card',
      anchor: 'note-card',
      side: 'bottom',
      title: 'Готовый конспект',
      text: 'Карточку можно открыть, поправить, скопировать и скачать в Word.'
    }
  ]),
  // Спросить
  ...at({ overlay: 'ask' }, [
    {
      id: 'ask-panel',
      anchor: 'ask-panel',
      side: 'left',
      title: 'Спросить записи',
      text: 'Задайте вопрос обычными словами. ИИ найдёт места в записях и ответит со ссылками. Он может ошибаться — проверяйте по ссылкам. В туре я вопрос не задаю.'
    },
    {
      id: 'ask-input',
      anchor: 'ask-input',
      side: 'top',
      title: 'Строка вопроса',
      text: 'Например: «Что клиент говорил о матери?». Нужен ключ ИИ.'
    }
  ]),
  // Диктовка
  ...at(DICT, [
    {
      id: 'dict-state',
      anchor: 'dict-state',
      side: 'bottom',
      title: 'Диктовка',
      text: 'Пишет текст голосом в любое окно: письмо, мессенджер, документ.'
    },
    {
      id: 'dict-key',
      anchor: 'dict-key',
      side: 'bottom',
      title: 'Клавиша',
      text: 'Зажмите {hotkey} и говорите. Отпустите — текст появится там, где стоит курсор. Двойное нажатие включает запись до следующего нажатия.'
    },
    {
      id: 'mic-check',
      anchor: 'mic-check',
      side: 'top',
      title: 'Проверьте микрофон',
      text: 'Нажмите «Проверить» и скажите что-нибудь. Полоса покажет, слышно ли вас.',
      wait: { click: true }
    },
    {
      id: 'dict-on',
      anchor: 'dict-switch',
      side: 'left',
      only: 'dict-off',
      title: 'Включите диктовку',
      text: 'Нажмите на переключатель. Без него клавиша не работает.',
      wait: { dictEnabled: true }
    },
    {
      id: 'dictate',
      anchor: 'dict-history',
      side: 'top',
      only: 'dict-on',
      title: 'Продиктуйте фразу',
      text: 'Зажмите {hotkey}, скажите короткую фразу и отпустите клавишу. Фраза появится в истории. Я подожду.',
      wait: { dictation: true }
    },
    {
      id: 'dict-stats',
      anchor: 'dict-stats',
      side: 'bottom',
      title: 'Статистика',
      text: 'Слова за неделю, дни подряд и скорость речи.'
    }
  ]),
  // Словарь и режимы
  ...at({ overlay: 'words' }, [
    {
      id: 'vocab-tabs',
      anchor: 'vocab-tabs',
      side: 'bottom',
      title: 'Словарь',
      text: 'Слова, замены и сниппеты. Впишите имена и термины — «Слово» будет писать их точно.'
    }
  ]),
  ...at({ overlay: 'modes' }, [
    {
      id: 'modes-tabs',
      anchor: 'vocab-tabs',
      side: 'bottom',
      title: 'Режимы',
      text: 'Режим говорит ИИ, как править диктовку: письмо, сообщение, заметка. Можно сделать свой режим. Для режимов по программам есть отдельная вкладка.'
    }
  ]),
  // Настройки
  ...at({ page: 'settings', section: 'general' }, [
    {
      id: 'settings-tabs',
      anchor: 'settings-tabs',
      side: 'right',
      title: 'Настройки',
      text: 'Шесть разделов: общие, диктовка, записи и звонки, движки и ключи, подключения, приватность и данные.'
    },
    {
      id: 'settings-search',
      anchor: 'settings-search',
      side: 'bottom',
      title: 'Поиск настройки',
      text: 'Не знаете, где настройка? Впишите слово — найдётся.'
    }
  ]),
  ...at({ page: 'settings', section: 'engines' }, [
    {
      id: 'settings-engines',
      anchor: 'settings-content',
      side: 'left',
      title: 'Движки и ключи',
      text: 'Здесь выбирают, чем расшифровывать звук и чем работает ИИ. Ключи хранятся только на этом компьютере.'
    }
  ]),
  ...at({ page: 'settings', section: 'general' }, [
    {
      id: 'settings-tour',
      anchor: 'tour-block',
      side: 'top',
      title: 'Обучение',
      text: 'Сюда можно вернуться: пройти тур заново или снова включить подсказки в разделах.'
    }
  ]),
  ...at(HOME, [
    {
      id: 'end',
      title: 'Готово',
      text: 'Вы прошли все разделы. Обучение можно повторить: «Настройки» → «Общие» → «Обучение».'
    }
  ])
]

export const TOURS: Record<TourId, { title: string; steps: TourStep[] }> = {
  short: { title: 'Коротко', steps: SHORT_TOUR },
  full: { title: 'Подробно', steps: FULL_TOUR }
}

/** Разделы, по которым прошёл тур: их подсказки при первом заходе уже не нужны. */
export function tourSections(steps: TourStep[]): HintSection[] {
  const out = new Set<HintSection>()
  for (const s of steps) {
    const g = s.go
    if (!g) continue
    if (g.overlay === 'ask') out.add('ask')
    else if (g.overlay === 'words' || g.overlay === 'modes') out.add('vocab')
    else if (g.page === 'demo') out.add('record')
    else if (g.page === 'library' || g.page === 'notes' || g.page === 'dictation' || g.page === 'settings') out.add(g.page)
  }
  return [...out]
}

// ---------------------------------------------- подсказки при первом заходе

/** 2–3 подсказки на раздел. Идут на месте, без переходов и без действий от человека. */
export const SECTION_HINTS: Record<HintSection, TourStep[]> = {
  library: [
    {
      id: 'lib-search',
      anchor: 'lib-search',
      side: 'bottom',
      title: 'Поиск по записям',
      text: 'Ищет слово во всех записях сразу и показывает отрывок текста.'
    },
    {
      id: 'lib-cards',
      anchor: 'lib-cards',
      side: 'top',
      title: 'Карточки',
      text: 'Наведите на карточку: появятся кнопки «переименовать», «в папку» и «удалить». Удалённое идёт в Корзину.'
    },
    {
      id: 'folder-tree',
      anchor: 'folder-tree',
      side: 'right',
      title: 'Папки',
      text: 'Перетащите карточку на папку в меню — запись переедет туда.'
    }
  ],
  record: [
    {
      id: 'editor-text',
      anchor: 'editor-text',
      side: 'left',
      title: 'Текст записи',
      text: 'Нажмите на слово — звук перейдёт к нему. Слово можно поправить.'
    },
    {
      id: 'uncertain-word',
      anchor: 'uncertain-word',
      side: 'bottom',
      title: 'Неуверенные слова',
      text: 'Слова, в которых движок не уверен, подсвечены. Щёлкните по такому слову — появятся варианты. Правая кнопка открывает варианты для любого слова.'
    },
    {
      id: 'editor-make',
      anchor: 'editor-make',
      side: 'bottom',
      title: 'Сделать из текста',
      text: 'Из текста выйдет саммари, заметка или протокол. Результат сохраняется в «Конспекты».'
    }
  ],
  notes: [
    {
      id: 'notes-search',
      anchor: 'notes-search',
      side: 'bottom',
      title: 'Поиск',
      text: 'Ищет по названию и тексту конспектов.'
    },
    {
      id: 'note-card',
      anchor: 'note-card',
      side: 'bottom',
      title: 'Конспект',
      text: 'Нажмите на карточку, чтобы открыть, поправить, скопировать или скачать в Word.'
    }
  ],
  ask: [
    {
      id: 'ask-input',
      anchor: 'ask-input',
      side: 'top',
      title: 'Вопрос обычными словами',
      text: 'Например: «О чём договорились в конце?». Ответ придёт со ссылками на места в записях.'
    },
    {
      id: 'ask-panel',
      anchor: 'ask-panel',
      side: 'left',
      title: 'Проверяйте ответ',
      text: 'ИИ может ошибаться. Нажмите на номер в ответе — увидите, откуда взято.'
    }
  ],
  dictation: [
    {
      id: 'dict-key',
      anchor: 'dict-key',
      side: 'bottom',
      title: 'Клавиша',
      text: 'Зажмите {hotkey} и говорите. Отпустите — текст появится там, где стоит курсор.'
    },
    {
      id: 'mic-check',
      anchor: 'mic-check',
      side: 'top',
      title: 'Микрофон',
      text: 'Если диктовка молчит, начните с проверки микрофона.'
    },
    {
      id: 'dict-history',
      anchor: 'dict-history',
      side: 'top',
      title: 'История',
      text: 'Все диктовки хранятся здесь. Текст можно скопировать или повторить.'
    }
  ],
  vocab: [
    {
      id: 'vocab-tabs',
      anchor: 'vocab-tabs',
      side: 'bottom',
      title: 'Вкладки',
      text: 'Слова, замены, сниппеты, режимы. Слова помогают распознать имена и термины.'
    },
    {
      id: 'vocab-body',
      anchor: 'vocab-body',
      side: 'top',
      title: 'Правки сохраняются сами',
      text: 'Впишите слова по одному в строке. Закройте окно, когда закончите.'
    }
  ],
  settings: [
    {
      id: 'settings-tabs',
      anchor: 'settings-tabs',
      side: 'right',
      title: 'Разделы',
      text: 'Шесть разделов. Движки и ключи — там, где выбирают, чем расшифровывать и чем работает ИИ.'
    },
    {
      id: 'settings-search',
      anchor: 'settings-search',
      side: 'bottom',
      title: 'Поиск',
      text: 'Впишите слово — найдётся нужная настройка.'
    },
    {
      id: 'settings-tour',
      anchor: 'tour-block',
      side: 'top',
      title: 'Обучение',
      text: 'Тур можно пройти заново. Здесь же включаются подсказки в разделах.'
    }
  ]
}

/** Все якоря всех сценариев (в том числе те, появления которых ждут шаги) — для теста «якорь есть в коде». */
export function allAnchors(): string[] {
  const steps = [...SHORT_TOUR, ...FULL_TOUR, ...Object.values(SECTION_HINTS).flat()]
  const names = steps.flatMap((s) => [s.anchor, s.wait?.appears])
  return [...new Set(names.filter((a): a is string => !!a))]
}
