import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import 'driver.js/dist/driver.css'
import type { TourId, ToursState } from '../../../shared/types'
import { defaultDictation } from '../../../shared/types'
import { SECTION_HINTS, TOURS, tourSections, type TourNav } from '../../../shared/tourScenarios'
import {
  hintsDue,
  tourOffer,
  withChoice,
  withDismissed,
  withDone,
  withHintsReset,
  withSectionSeen,
  withStart,
  type HintSection,
  type TourOffer
} from '../../../shared/tourOffer'
import { api } from '../api'
import { useLibrary } from '../library'
import { showToast } from '../toast'
import { hotkeyLabel } from '../dictKeys'
import { startRunner, type Runner, type RunnerDeps, type TourFacts } from './runner'
import TourChoice from './TourChoice'

// Гайд: хранит флаги (settings.tours), решает, что показать, и запускает runner.
// Окно выбора живёт здесь, карточка на Главной — в TourCard (берёт offer отсюда).

export interface TourApi {
  /** Идёт тур или подсказки раздела. */
  running: boolean
  /** Что предложить сейчас: экран выбора, карточку на Главной или ничего. */
  offer: TourOffer
  tours: ToursState | undefined
  start: (id: TourId) => void
  /** Ответ на предложение: тур или «Позже». */
  choose: (c: TourId | 'later') => void
  /** Карточка закрыта без выбора. */
  dismiss: () => void
  /** Раздел открыт: если надо, покажет 2–3 подсказки. */
  noteSection: (s: HintSection) => void
  /** «Снова показывать подсказки в разделах». */
  resetHints: () => void
}

const idle: TourApi = {
  running: false,
  offer: null,
  tours: undefined,
  start: () => {},
  choose: () => {},
  dismiss: () => {},
  noteSection: () => {},
  resetHints: () => {}
}

const TourContext = createContext<TourApi>(idle)
export const useTour = (): TourApi => useContext(TourContext)

/** Вызвать в разделе: при первом заходе всплывут подсказки (если человек выбрал «Коротко»). */
export function useSectionHints(section: HintSection, ready = true): void {
  const { noteSection } = useTour()
  useEffect(() => {
    if (ready) noteSection(section)
  }, [ready, section, noteSection])
}

export function TourProvider({
  nav,
  blocked,
  justOnboarded,
  children
}: {
  /** Перейти на страницу / открыть окно. Реализует App. */
  nav: (n: TourNav) => void
  /** На экране мастер первого запуска — ничего не предлагаем. */
  blocked: boolean
  /** Мастер только что закрыт — предложить сразу. */
  justOnboarded: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [cfg, setCfg] = useState<{ onboarded: boolean; tours?: ToursState } | null>(null)
  const [running, setRunning] = useState(false)
  const projects = useLibrary((s) => s.projects)
  const setup = useLibrary((s) => s.setup)

  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const runningRef = useRef(false)
  const runnerRef = useRef<Runner | null>(null)
  const navRef = useRef(nav)
  navRef.current = nav
  const pendingHints = useRef(new Set<string>())
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const reload = useCallback(async () => {
    const s = await api.getSettings()
    setCfg({ onboarded: !!s.onboarded, tours: s.tours })
  }, [])
  useEffect(() => {
    void reload()
  }, [reload, blocked])

  /** Запись флагов по очереди, от свежих настроек: гонка двух записей не теряет данные. */
  const saveTours = useCallback((update: (t: ToursState | undefined) => ToursState): Promise<void> => {
    const job = queue.current.then(async () => {
      const s = await api.getSettings()
      const next = update(s.tours)
      await api.setSettings({ tours: next })
      setCfg((c) => (c ? { ...c, tours: next } : { onboarded: !!s.onboarded, tours: next }))
    })
    queue.current = job.catch(() => {})
    return job.catch(() => {})
  }, [])

  const facts = useCallback(async (): Promise<TourFacts> => {
    const s = await api.getSettings()
    const d = { ...defaultDictation, ...s.dictation }
    return { dictEnabled: !!d.enabled, hotkey: hotkeyLabel(d.hotkey) }
  }, [])

  const deps = useCallback(
    (onEnd: RunnerDeps['onEnd']): RunnerDeps => ({
      go: (n) => navRef.current(n),
      facts,
      onDictLogged: (cb) => api.onDictLogged(cb),
      onEnd
    }),
    [facts]
  )

  const launch = useCallback(
    (steps: Parameters<typeof startRunner>[0], onEnd: RunnerDeps['onEnd']) => {
      runnerRef.current?.stop()
      runningRef.current = true
      setRunning(true)
      runnerRef.current = startRunner(
        steps,
        deps((reason, shown) => {
          runningRef.current = false
          runnerRef.current = null
          setRunning(false)
          onEnd(reason, shown)
        })
      )
    },
    [deps]
  )

  const start = useCallback(
    (id: TourId) => {
      void (async () => {
        await saveTours((t) => withStart(t, id))
        // Тур работает только с примером: готовим его (бесплатно, без звука и без ИИ).
        try {
          await api.createDemo()
        } catch {
          /* без примера шаги про него просто пропустятся */
        }
        await useLibrary.getState().refresh()
        useLibrary.getState().refreshNotes()
        navRef.current({ page: 'home' })
        launch(TOURS[id].steps, (reason) => {
          navRef.current({}) // закрыть окна «Спросить», «Словарь», «Режимы»
          if (reason !== 'done') return
          const sections = tourSections(TOURS[id].steps)
          void saveTours((t) => sections.reduce((acc, s) => withSectionSeen(acc, s), withDone(t, id)))
        })
      })()
    },
    [launch, saveTours]
  )

  const choose = useCallback(
    (c: TourId | 'later') => {
      if (c === 'later') void saveTours((t) => withChoice(t, 'later'))
      else start(c)
    },
    [saveTours, start]
  )

  const dismiss = useCallback(() => void saveTours((t) => withDismissed(t)), [saveTours])

  const resetHints = useCallback(() => {
    void saveTours((t) => withHintsReset(t)).then(() =>
      showToast('Подсказки в разделах включены. Они появятся при первом заходе в каждый раздел.', 'info')
    )
  }, [saveTours])

  const noteSection = useCallback(
    (section: HintSection) => {
      if (runningRef.current || pendingHints.current.has(section)) return
      if (!hintsDue(cfgRef.current?.tours, section)) return
      pendingHints.current.add(section)
      // Даём разделу дорисоваться и не перебиваем окно выбора.
      window.setTimeout(() => {
        pendingHints.current.delete(section)
        if (runningRef.current || !hintsDue(cfgRef.current?.tours, section)) return
        launch(SECTION_HINTS[section], (_reason, shown) => {
          if (shown > 0) void saveTours((t) => withSectionSeen(t, section))
        })
      }, 700)
    },
    [launch, saveTours]
  )

  useEffect(() => () => runnerRef.current?.stop(), [])

  const ready = !!cfg && !blocked && projects !== null && setup !== null
  const offer = useMemo<TourOffer>(() => {
    if (!ready || !cfg) return null
    return tourOffer({
      onboarded: cfg.onboarded,
      tours: cfg.tours,
      ownRecords: (projects ?? []).filter((p) => !p.demo).length,
      dictations: setup?.stats.total ?? 0,
      wizardJustDone: justOnboarded
    })
  }, [ready, cfg, projects, setup, justOnboarded])

  const value = useMemo<TourApi>(
    () => ({ running, offer, tours: cfg?.tours, start, choose, dismiss, noteSection, resetHints }),
    [running, offer, cfg?.tours, start, choose, dismiss, noteSection, resetHints]
  )

  return (
    <TourContext.Provider value={value}>
      {children}
      {offer === 'choice' && !running && <TourChoice onChoose={choose} />}
    </TourContext.Provider>
  )
}
