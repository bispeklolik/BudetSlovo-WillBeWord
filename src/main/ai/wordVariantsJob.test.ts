import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AiProvider } from './provider'
import type { AiItem } from '../../shared/wordVariantsAi'
import type { ProjectMeta, Word } from '../../shared/types'
import { buildIndex } from '../../shared/wordVariants'

// Пустая папка данных до загрузки модулей: paths.ts читает SLOVO_DATA_DIR при загрузке.
const dir = mkdtempSync(join(tmpdir(), 'slovo-wv-'))
process.env['SLOVO_DATA_DIR'] = dir

type Job = typeof import('./wordVariantsJob')
type Store = typeof import('../project/store')
let job: Job
let store: Store
const index = buildIndex('колет 143\nколит 90\nсорвала 500\nуволят 800')

function makeProject(slug: string, count: number, text = 'слово'): ProjectMeta {
  const words: Word[] = Array.from({ length: count }, (_, i) => ({ id: i, t: text, s: i, e: i + 0.5, p: 0.3 }))
  const meta = { version: 1, slug, title: slug, turns: [{ id: 'T0', spk: 'S0', startSec: 0, words }] } as unknown as ProjectMeta
  mkdirSync(store.projectDir(slug), { recursive: true })
  store.writeJsonAtomic(join(store.projectDir(slug), 'project.json'), meta)
  return meta
}

function provider(calls: AiItem[][], fail = false): AiProvider {
  return {
    id: 'claude',
    name: 'тест',
    isLocal: false,
    isAvailable: async () => true,
    wordVariants: async (items: AiItem[]) => {
      calls.push(items)
      if (fail) throw new Error('Нет связи с Claude — проверьте интернет.')
      return items.map((it) => ({ id: it.id, ok: false, variants: [{ text: 'колит' }] }))
    }
  } as unknown as AiProvider
}

beforeAll(async () => {
  store = await import('../project/store')
  job = await import('./wordVariantsJob')
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('«на всю запись»: пачки, кэш, отмена', () => {
  it('считает слова и запросы до запуска (12 слов в запросе)', () => {
    makeProject('a', 30)
    expect(job.prepareCount('a')).toEqual({ total: 30, todo: 30, requests: 3 })
  })

  it('идёт пачками по 12, пишет прогресс и кэш в отдельный variants.json', async () => {
    makeProject('b', 30)
    const calls: AiItem[][] = []
    const progress: number[] = []
    const res = await job.prepareAll(provider(calls), 'b', undefined, (p) => progress.push(p.done), { cancelled: false }, { index })
    expect(calls.map((c) => c.length)).toEqual([12, 12, 6])
    expect(progress).toEqual([0, 12, 24, 30])
    expect(res).toEqual({ asked: 30, answered: 30, cancelled: false })
    expect(existsSync(join(store.projectDir('b'), 'variants.json'))).toBe(true)
    // в проекте (патчах) ничего не появилось
    expect(readFileSync(join(store.projectDir('b'), 'project.json'), 'utf8')).not.toContain('колит')
    // готово — второй раз не спрашиваем
    expect(job.prepareCount('b')).toEqual({ total: 30, todo: 0, requests: 0 })
    const again: AiItem[][] = []
    await job.prepareAll(provider(again), 'b', undefined, () => {}, { cancelled: false }, { index })
    expect(again).toHaveLength(0)
  })

  it('отмена останавливает после текущей пачки; сделанное остаётся в кэше', async () => {
    makeProject('c', 30)
    const calls: AiItem[][] = []
    const signal = { cancelled: false }
    const res = await job.prepareAll(
      provider(calls),
      'c',
      undefined,
      (p) => {
        if (p.done >= 12) signal.cancelled = true
      },
      signal,
      { index }
    )
    expect(calls).toHaveLength(1)
    expect(res.cancelled).toBe(true)
    expect(job.prepareCount('c').todo).toBe(18)
  })

  it('ошибка ИИ: уже готовые пачки сохранены, ошибка уходит наверх', async () => {
    makeProject('d', 5)
    await expect(job.prepareAll(provider([], true), 'd', undefined, () => {}, { cancelled: false }, { index })).rejects.toThrow('Нет связи')
    expect(job.prepareCount('d').todo).toBe(5)
  })

  it('кэш по слову: ответ годится, пока текст слова не изменился', async () => {
    makeProject('e', 2, 'коблит')
    const calls: AiItem[][] = []
    const first = await job.aiForWord(provider(calls), 'e', 1, undefined, { index })
    expect(first.entry?.variants.map((v) => v.text)).toEqual(['колит'])
    const second = await job.aiForWord(provider(calls), 'e', 1, undefined, { index })
    expect(second.entry).toEqual(first.entry)
    expect(calls).toHaveLength(1) // второй раз не спрашивали
    // слово поправили — ответ устарел
    const cache = job.loadCache('e')
    expect(job.cachedFor(cache, { id: 1, t: 'коблит' })).not.toBeNull()
    expect(job.cachedFor(cache, { id: 1, t: 'другое' })).toBeNull()
  })
})
