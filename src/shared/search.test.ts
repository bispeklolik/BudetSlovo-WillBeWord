import { describe, it, expect } from 'vitest'
import { searchProjects } from './search'
import type { ProjectMeta, Word } from './types'

const W = (id: number, t: string, s: number): Word => ({ id, t, s, e: s + 0.4, p: 0.9 })

function proj(slug: string, title: string, words: Word[]): ProjectMeta {
  return { slug, title, turns: [{ id: 'T0', spk: 'S0', startSec: 0, words }] } as unknown as ProjectMeta
}

const projects: ProjectMeta[] = [
  proj('eva-1', 'Ева — сессия 1', [W(0, 'Сегодня', 0), W(1, 'тревога', 1), W(2, 'усилилась', 2)]),
  proj('semen-1', 'Семён — сессия 1', [
    W(0, 'Тревога', 0),
    W(1, 'и', 1),
    W(2, 'снова', 2),
    W(3, 'тревога', 3)
  ]),
  proj('biz', 'Переговоры РХГА', [W(0, 'бюджет', 0), W(1, 'утверждён', 1)])
]

describe('searchProjects', () => {
  it('находит записи с совпадениями, без учёта регистра', () => {
    const hits = searchProjects(projects, 'тревога')
    expect(hits.map((h) => h.slug)).toEqual(['semen-1', 'eva-1']) // semen первым: 2 совпадения
    expect(hits[0].count).toBe(2)
    expect(hits[1].count).toBe(1)
  })

  it('пустой запрос — пустой результат', () => {
    expect(searchProjects(projects, '   ')).toEqual([])
  })

  it('нет совпадений — запись не попадает в результат', () => {
    const hits = searchProjects(projects, 'бюджет')
    expect(hits).toHaveLength(1)
    expect(hits[0].slug).toBe('biz')
  })

  it('сниппет содержит найденное слово и время первого совпадения', () => {
    const hits = searchProjects(projects, 'усилилась')
    expect(hits[0].snippet).toContain('усилилась')
    expect(hits[0].sec).toBe(2)
  })
})
