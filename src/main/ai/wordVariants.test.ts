import { describe, it, expect } from 'vitest'
import { askAi, soundLayers } from './wordVariants'
import { buildIndex } from '../../shared/wordVariants'
import type { AiProvider } from './provider'
import type { AiItem, AiRawItem } from '../../shared/wordVariantsAi'
import type { ProjectMeta, Turn, Word } from '../../shared/types'

const index = buildIndex('колет 1430\nколит 900\nсорвала 500\nуволят 800')

function words(texts: string[], p: Record<number, number> = {}): Word[] {
  return texts.map((t, i) => ({ id: i, t, s: i, e: i + 0.5, ...(p[i] !== undefined ? { p: p[i] } : {}) }))
}
function project(turn: Turn, extra: Partial<ProjectMeta> = {}): ProjectMeta {
  return { turns: [turn], ...extra } as unknown as ProjectMeta
}

function fakeProvider(isLocal: boolean, reply: (items: AiItem[]) => AiRawItem[]): AiProvider & { seen: AiItem[][] } {
  const seen: AiItem[][] = []
  return {
    id: isLocal ? 'local-llama' : 'claude',
    name: 'тест',
    isLocal,
    seen,
    isAvailable: async () => true,
    wordVariants: async (items: AiItem[]) => {
      seen.push(items)
      return reply(items)
    }
  } as unknown as AiProvider & { seen: AiItem[][] }
}

describe('askAi: запрос к ИИ про неуверенное слово', () => {
  const turn: Turn = {
    id: 'T0',
    spk: 'S0',
    startSec: 0,
    words: words(['У', 'меня', 'коблит', 'в', 'боку'], { 2: 0.41 })
  }

  it('отправляет фрагмент, уверенность, подсказки по звучанию; ответ режет и фильтрует', async () => {
    const p = fakeProvider(true, (items) => [
      {
        id: items[0].id,
        ok: false,
        variants: [{ text: 'колит' }, { text: 'желудок' }, { text: 'колет' }, { text: 'колит' }]
      }
    ])
    const res = await askAi(p, project(turn), [2], undefined, { timeoutMs: 1000, index })
    const item = p.seen[0][0]
    expect(item).toMatchObject({ id: 2, left: 'У меня', word: 'коблит', right: 'в боку', conf: 41 })
    expect(item.hints).toContain('колет')
    // «желудок» далёк по звучанию, повтор убран
    expect(res.get(2)!.variants.map((v) => v.text)).toEqual(['колит', 'колет'])
    expect(res.get(2)!.t).toBe('коблит')
  })

  it('слово без ответа ИИ в результат не попадает (его можно спросить ещё раз)', async () => {
    const p = fakeProvider(true, () => [])
    const res = await askAi(p, project(turn), [2], undefined, { timeoutMs: 1000, index })
    expect(res.size).toBe(0)
  })

  it('облачному ИИ уходит обезличенный фрагмент и словарь без имён из правил записи', async () => {
    const t: Turn = {
      id: 'T0',
      spk: 'S0',
      startSec: 0,
      words: words(['Я', 'говорила', 'с', 'Марией', 'про', 'коблит', 'вчера'], { 5: 0.4 })
    }
    const meta = project(t, { anon: [{ find: 'Марией', replace: 'Клиент-1', kind: 'name' }] } as Partial<ProjectMeta>)
    const vocab = { words: ['Мария', 'колит'], replacements: [], snippets: [] }
    const cloud = fakeProvider(false, () => [])
    await askAi(cloud, meta, [5], vocab, { timeoutMs: 1000, index })
    const sent = cloud.seen[0][0]
    expect(JSON.stringify(sent)).not.toContain('Мари')
    expect(sent.left).toContain('Клиент-1')
    expect(sent.dict).toEqual(['колит'])

    // Локальному ИИ слова уходят как есть.
    const local = fakeProvider(true, () => [])
    await askAi(local, meta, [5], vocab, { timeoutMs: 1000, index })
    expect(local.seen[0][0].left).toContain('Марией')
  })

  it('слово, закрытое обезличиванием, облаку не отправляем совсем', async () => {
    const t: Turn = { id: 'T0', spk: 'S0', startSec: 0, words: words(['Звонила', 'Марией'], { 1: 0.3 }) }
    const meta = project(t, { anon: [{ find: 'Марией', replace: 'Клиент-1', kind: 'name' }] } as Partial<ProjectMeta>)
    const cloud = fakeProvider(false, () => [])
    const res = await askAi(cloud, meta, [1], undefined, { timeoutMs: 1000, index })
    expect(cloud.seen).toHaveLength(0)
    expect(res.size).toBe(0)
  })

  it('провайдер без метода wordVariants — пусто, без ошибки', async () => {
    const res = await askAi({ isLocal: true } as unknown as AiProvider, project(turn), [2], undefined, { timeoutMs: 1, index })
    expect(res.size).toBe(0)
  })
})

describe('soundLayers: слой без сети', () => {
  it('слова словаря и «как распознал движок» — выше; по звучанию — из списка', () => {
    const t: Turn = {
      id: 'T0',
      spk: 'S0',
      startSec: 0,
      words: [{ id: 0, t: 'колет,', p: 0.4, s: 0, e: 1 }, { id: 1, t: 'колит', t0: 'коблит', s: 1, e: 2 }]
    }
    const l = soundLayers(project(t), 0, { words: ['Колит'], replacements: [], snippets: [] }, index)!
    expect(l.pinned.map((v) => v.text)).toContain('Колит')
    expect(l.sound.map((v) => v.text)).toContain('колит')
    const l1 = soundLayers(project(t), 1, undefined, index)!
    expect(l1.pinned).toEqual([{ text: 'коблит', basis: 'engine' }])
  })
  it('нет такого слова — null', () => {
    expect(soundLayers(project({ id: 'T0', spk: 'S0', startSec: 0, words: [] }), 5, undefined, index)).toBeNull()
  })
})
