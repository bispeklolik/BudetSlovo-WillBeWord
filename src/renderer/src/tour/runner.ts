import { driver, type Driver } from 'driver.js'
import type { TourNav, TourStep } from '../../../shared/tourScenarios'

// Движок гайда. Сценарий (массив шагов) — данные; здесь он превращается в показ
// через driver.js: highlight() на каждый шаг. Переходы между страницами, ожидание
// действий человека и пропуск шагов без элемента делаем сами.
//
// Что ждём от человека (step.wait): клик по подсвеченному элементу, появление
// элемента на экране, включение диктовки, новая запись в журнале диктовок.
// На таких шагах кнопка «Дальше» превращается в «Пропустить шаг».

export interface TourFacts {
  dictEnabled: boolean
  /** Название клавиши диктовки для текста: «F9». */
  hotkey: string
}

export interface RunnerDeps {
  go: (nav: TourNav) => void
  facts: () => Promise<TourFacts>
  onDictLogged: (cb: () => void) => () => void
  /** Тур закончен: done — дошли до конца, closed — человек закрыл. shown — сколько шагов реально показано. */
  onEnd: (reason: 'done' | 'closed', shown: number) => void
}

export interface Runner {
  stop: () => void
}

const FIND_MS = 2500 // после перехода на другую страницу: ждём, пока она нарисуется
const FIND_SAME_PAGE_MS = 600 // на той же странице: нет элемента — значит, его не будет
const POLL_MS = 80
const AFTER_ACTION_MS = 350

const navKey = (n: TourNav): string => `${n.page ?? ''}|${n.section ?? ''}|${n.overlay ?? ''}`

export function anchorSelector(anchor: string): string {
  return `[data-tour="${anchor}"]`
}

/** Элемент есть на экране и виден (не скрыт и не нулевого размера). */
export function findAnchor(anchor: string): HTMLElement | null {
  const list = document.querySelectorAll<HTMLElement>(anchorSelector(anchor))
  for (const el of list) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

function fill(text: string, f: TourFacts): string {
  return text.replace(/\{hotkey\}/g, f.hotkey)
}

export function startRunner(steps: TourStep[], deps: RunnerDeps): Runner {
  const total = steps.length
  let stopped = false
  let shown = 0
  let lastGo = ''
  let forceGo = true // после действия человека страница могла смениться — переход повторяем
  let cleanups: (() => void)[] = []
  let token = 0 // номер показа: старые асинхронные шаги выбрасываем

  const drv: Driver = driver({
    animate: true,
    allowClose: true,
    allowKeyboardControl: true,
    overlayClickBehavior: 'none', // случайный щелчок мимо не закрывает тур
    stagePadding: 6,
    stageRadius: 10,
    overlayOpacity: 0.55,
    popoverClass: 'slovo-tour',
    popoverOffset: 10,
    onDestroyStarted: () => finish('closed') // Esc
  })

  const clearWaits = (): void => {
    for (const c of cleanups) c()
    cleanups = []
  }

  function finish(reason: 'done' | 'closed'): void {
    if (stopped) return
    stopped = true
    token++
    clearWaits()
    drv.destroy()
    deps.onEnd(reason, shown)
  }

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  async function waitAnchor(anchor: string, my: number, limit: number): Promise<HTMLElement | null> {
    const t0 = Date.now()
    for (;;) {
      if (stopped || my !== token) return null
      const el = findAnchor(anchor)
      if (el) return el
      if (Date.now() - t0 > limit) return null
      await sleep(POLL_MS)
    }
  }

  async function show(i: number, dir: 1 | -1): Promise<void> {
    if (stopped) return
    const my = ++token
    clearWaits()
    // Пропускаем шаги, которые сейчас не нужны или без элемента.
    for (; i >= 0 && i < total; i += dir) {
      const step = steps[i]
      const f = await deps.facts()
      if (stopped || my !== token) return
      if (step.only === 'dict-off' && f.dictEnabled) continue
      if (step.only === 'dict-on' && !f.dictEnabled) continue
      let moved = false
      if (step.go && (forceGo || navKey(step.go) !== lastGo)) {
        moved = true
        deps.go(step.go)
        lastGo = navKey(step.go)
        forceGo = false
        await sleep(160)
        if (stopped || my !== token) return
      }
      let el: HTMLElement | null = null
      if (step.anchor) {
        el = await waitAnchor(step.anchor, my, moved ? FIND_MS : FIND_SAME_PAGE_MS)
        if (stopped || my !== token) return
        if (!el) continue // элемента нет (например, список скрыт) — следующий шаг
      }
      render(i, step, el, f)
      return
    }
    // Дошли до края: вперёд — конец тура, назад — остаёмся на первом показанном шаге.
    if (dir === 1) finish('done')
    else if (i < 0) void show(0, 1)
  }

  function render(i: number, step: TourStep, el: HTMLElement | null, f: TourFacts): void {
    shown++
    const last = i === total - 1
    const interactive = !!step.wait
    drv.highlight({
      element: el ?? undefined,
      // Пока шаг без действия, нажать подсвеченную кнопку нельзя: тур ничего не запускает сам и не даёт запустить по ошибке.
      disableActiveInteraction: !interactive,
      popover: {
        title: step.title,
        description: fill(step.text, f),
        side: step.side ?? 'bottom',
        align: 'start',
        showButtons: ['previous', 'next', 'close'],
        disableButtons: i === 0 ? ['previous'] : [],
        showProgress: total > 1,
        progressText: `${i + 1} из ${total}`,
        prevBtnText: 'Назад',
        nextBtnText: interactive ? 'Пропустить шаг' : last ? 'Готово' : 'Дальше',
        closeBtnLabel: 'Закрыть тур',
        popoverClass: 'slovo-tour' + (interactive ? ' is-action' : '') + (el ? '' : ' is-center'),
        onNextClick: () => (last ? finish('done') : void show(i + 1, 1)),
        onPrevClick: () => void show(i - 1, -1),
        onCloseClick: () => finish('closed')
      }
    })
    if (step.wait) arm(i, step, el)
  }

  /** Ждём действие человека; когда оно случилось — идём дальше. */
  function arm(i: number, step: TourStep, el: HTMLElement | null): void {
    const w = step.wait!
    const my = token
    let fired = false
    const advance = (delay: number): void => {
      if (fired || stopped || my !== token) return
      fired = true
      forceGo = true
      setTimeout(() => {
        if (stopped || my !== token) return
        if (i === total - 1) finish('done')
        else void show(i + 1, 1)
      }, delay)
    }
    if (w.click && el) {
      const onClick = (e: MouseEvent): void => {
        if (e.composedPath().includes(el)) advance(AFTER_ACTION_MS)
      }
      window.addEventListener('click', onClick, true)
      cleanups.push(() => window.removeEventListener('click', onClick, true))
    }
    if (w.appears) {
      // Ждём именно появления: если элемент уже на экране (человек вернулся «Назад»),
      // сначала он должен исчезнуть. Иначе шаг сам листал бы вперёд.
      let was = !!findAnchor(w.appears)
      const timer = window.setInterval(() => {
        const now = !!findAnchor(w.appears!)
        if (now && !was) advance(AFTER_ACTION_MS)
        was = now
      }, 120)
      cleanups.push(() => window.clearInterval(timer))
    }
    if (w.dictation) cleanups.push(deps.onDictLogged(() => advance(700)))
    if (w.dictEnabled) {
      const timer = window.setInterval(() => {
        void deps.facts().then((f) => f.dictEnabled && advance(AFTER_ACTION_MS))
      }, 500)
      cleanups.push(() => window.clearInterval(timer))
    }
  }

  void show(0, 1)
  return { stop: () => finish('closed') }
}
