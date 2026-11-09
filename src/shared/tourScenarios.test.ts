import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { SHORT_TOUR, FULL_TOUR, SECTION_HINTS, allAnchors, tourSections, type TourStep } from './tourScenarios'
import { HINT_SECTIONS } from './tourOffer'

const RENDERER = join(__dirname, '../renderer/src')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.tsx$/.test(name)) out.push(readFileSync(p, 'utf8'))
  }
  return out
}

describe('сценарии гайда: якоря', () => {
  const code = sources(RENDERER).join('\n')

  it('каждый якорь из сценариев есть в коде renderer как data-tour', () => {
    // Якорь пишут data-tour="имя" или, когда он зависит от данных, в выражении:
    // data-tour={cond ? 'имя' : undefined}.
    const exprs = [...code.matchAll(/data-tour=\{([^}]*)\}/g)].map((m) => m[1])
    const missing = allAnchors().filter(
      (a) => !code.includes(`data-tour="${a}"`) && !exprs.some((e) => e.includes(`'${a}'`))
    )
    expect(missing, 'нет в коде: ' + missing.join(', ')).toEqual([])
  })

  it('в коде нет якорей, которых не ждёт ни один сценарий', () => {
    const used = new Set(allAnchors())
    const inCode = new Set<string>()
    for (const m of code.matchAll(/data-tour="([a-z0-9-]+)"/g)) inCode.add(m[1])
    for (const m of code.matchAll(/data-tour=\{([^}]*)\}/g)) for (const q of m[1].matchAll(/'([a-z0-9-]+)'/g)) inCode.add(q[1])
    const extra = [...inCode].filter((a) => !used.has(a) && !EXTRA_ANCHORS.includes(a))
    expect(extra, 'якорь не используется: ' + extra.join(', ')).toEqual([])
  })
})

// Якоря, которые нужны только для подсветки из кода (в сценариях пока не встречаются).
const EXTRA_ANCHORS: string[] = []

describe('сценарии гайда: устройство', () => {
  const all: [string, TourStep[]][] = [
    ['Коротко', SHORT_TOUR],
    ['Подробно', FULL_TOUR],
    ...Object.entries(SECTION_HINTS).map(([k, v]): [string, TourStep[]] => ['подсказки ' + k, v])
  ]

  it('id шагов уникальны внутри сценария', () => {
    for (const [name, steps] of all) {
      const ids = steps.map((s) => s.id)
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
      expect(dup, name).toEqual([])
    }
  })

  it('у каждого шага есть заголовок и текст; тексты короткие', () => {
    for (const [name, steps] of all) {
      for (const s of steps) {
        expect(s.title.trim().length, `${name}/${s.id}: заголовок`).toBeGreaterThan(0)
        expect(s.text.trim().length, `${name}/${s.id}: текст`).toBeGreaterThan(0)
        expect(s.text.length, `${name}/${s.id}: текст длиннее 260 знаков`).toBeLessThanOrEqual(260)
      }
    }
  })

  it('шаги-действия можно пропустить, а тур начинается и кончается без якоря', () => {
    for (const tour of [SHORT_TOUR, FULL_TOUR]) {
      expect(tour[0].anchor).toBeUndefined()
      expect(tour[tour.length - 1].anchor).toBeUndefined()
    }
    for (const [name, steps] of all) {
      for (const s of steps) {
        if (s.wait) expect(s.anchor, `${name}/${s.id}: ждущему шагу нужен якорь`).toBeTruthy()
      }
    }
  })

  it('подсказки: у каждого раздела 2–3 шага, переходов и ожиданий нет', () => {
    for (const sec of HINT_SECTIONS) {
      const steps = SECTION_HINTS[sec]
      expect(steps.length, sec).toBeGreaterThanOrEqual(2)
      expect(steps.length, sec).toBeLessThanOrEqual(3)
      for (const s of steps) {
        expect(s.go, `${sec}/${s.id}`).toBeUndefined()
        expect(s.wait, `${sec}/${s.id}`).toBeUndefined()
      }
    }
  })

  it('тур не запускает платное: в сценариях нет шагов-кликов по ИИ и звонку', () => {
    const banned = ['editor-make', 'editor-ai', 'sidebar-call', 'ask-input', 'lib-ask', 'editor-ask']
    for (const tour of [SHORT_TOUR, FULL_TOUR]) {
      for (const s of tour) {
        if (s.anchor && banned.includes(s.anchor)) expect(s.wait, `${s.id} ждёт клик по платной кнопке`).toBeUndefined()
      }
    }
  })

  it('«Коротко» покрывает обязательное: меню, звонок, добавить, пример, конспекты, спросить, диктовку', () => {
    const anchors = new Set(SHORT_TOUR.map((s) => s.anchor))
    for (const a of ['sidebar', 'sidebar-call', 'sidebar-add', 'demo-record', 'nav-notes', 'nav-ask', 'dict-key', 'mic-check'])
      expect(anchors.has(a), a).toBe(true)
    expect(SHORT_TOUR.some((s) => s.wait?.dictation)).toBe(true)
  })

  it('«Подробно» заходит во все разделы', () => {
    const pages = new Set(FULL_TOUR.map((s) => s.go?.page).filter(Boolean))
    for (const p of ['home', 'library', 'demo', 'notes', 'dictation', 'settings']) expect(pages.has(p as never), p).toBe(true)
    const overlays = new Set(FULL_TOUR.map((s) => s.go?.overlay).filter(Boolean))
    for (const o of ['ask', 'words', 'modes']) expect(overlays.has(o as never), o).toBe(true)
  })
})

describe('сценарии гайда: после тура', () => {
  it('«Коротко» отмечает пройденные разделы: подсказки не повторяют тур (ревью гайда)', () => {
    const s = tourSections(SHORT_TOUR)
    for (const sec of ['record', 'notes', 'dictation']) expect(s, sec).toContain(sec)
  })
  it('«Подробно» отмечает все разделы с подсказками', () => {
    expect(new Set(tourSections(FULL_TOUR))).toEqual(new Set(HINT_SECTIONS))
  })
  it('«Назад» на шаг «Откройте Конспекты» уводит со страницы конспектов', () => {
    for (const t of [SHORT_TOUR, FULL_TOUR]) {
      const st = t.find((x) => x.id === 'notes-nav')!
      expect(st.go?.page).toBe('demo')
    }
  })
})
