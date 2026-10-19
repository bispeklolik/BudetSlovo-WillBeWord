import { describe, it, expect } from 'vitest'
import {
  anonPlain,
  plainTranscript,
  projectsIn,
  askRecording,
  askAll,
  askAllThorough,
  enhanceNotes,
  sessionBrief,
  dynamicsSessions,
  clientDynamics,
  looksForeign,
  russianOnly
} from './insights'
import type { AiProvider } from './provider'
import type { ProjectMeta, Turn } from '../../shared/types'
import { KEYWORDS_SYSTEM, ASK_SYSTEM_ONE, ASK_SYSTEM_MANY, BRIEF_SYSTEM } from '../../shared/aiTasks'

let wid = 0
const turn = (spk: string, startSec: number, text: string): Turn => ({
  id: 't' + wid,
  spk,
  startSec,
  words: text.split(' ').map((t) => ({ id: wid++, t, s: startSec }))
})

function project(slug: string, turns: Turn[], extra: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    version: 1,
    id: slug,
    slug,
    title: 'Сессия ' + slug,
    createdAt: '2026-10-0' + (slug.charCodeAt(0) % 9) + 'T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    audio: { file: 'audio.m4a', originalPath: '', durationSec: 100, repairedPrefixBytes: 0, peaks: { file: '', perSec: 1 } },
    speakers: [{ id: 'S1', engineLabel: 'S1', name: 'Клиент', colorKey: 'b' }],
    turns,
    ...extra
  }
}

// Модель-заглушка: запоминает, что ей прислали, и отвечает по сценарию.
function fake(isLocal: boolean, reply: (system: string, text: string) => string = () => 'ответ [1]') {
  const calls: { system: string; text: string }[] = []
  const p = {
    id: isLocal ? 'local-llama' : 'openrouter',
    name: 'fake',
    isLocal,
    isAvailable: async () => true,
    generate: async (system: string, text: string) => {
      calls.push({ system, text })
      return reply(system, text)
    }
  } as unknown as AiProvider
  return { p, calls }
}

const ANON = [{ find: 'Ева', replace: '[Имя]', kind: 'name' as const }]

describe('anonPlain', () => {
  it('меняет целые слова без учёта регистра', () => {
    expect(anonPlain('ева сказала, Ева! Евангелие', ANON)).toBe('[Имя] сказала, [Имя]! Евангелие')
  })
  it('без правил — как есть', () => {
    expect(anonPlain('Ева', undefined)).toBe('Ева')
  })
})

describe('plainTranscript', () => {
  it('обезличивает, только если просят', () => {
    const m = project('a', [turn('S1', 0, 'Ева пришла')], { anon: ANON })
    expect(plainTranscript(m, true)).toBe('Клиент: [Имя] пришла')
    expect(plainTranscript(m, false)).toBe('Клиент: Ева пришла')
  })
})

describe('projectsIn', () => {
  const list = [
    project('a', [turn('S1', 0, 'x')], { folder: 'Ева' }),
    project('b', [turn('S1', 0, 'x')], { folder: 'Ева/2026' }),
    project('c', [turn('S1', 0, 'x')], { folder: 'Евангелина' }),
    project('d', [], { folder: 'Ева' }),
    project('e', [turn('S1', 0, 'x')], { folder: 'Ева', demo: true })
  ]
  it('папка с подпапками, без пустых и примера', () => {
    expect(projectsIn(list, 'Ева').map((p) => p.slug)).toEqual(['a', 'b'])
  })
  it('без папки — все расшифрованные', () => {
    expect(projectsIn(list, null).map((p) => p.slug)).toEqual(['a', 'b', 'c'])
  })
})

describe('askRecording', () => {
  it('короткая запись — целиком с временем, облаку — обезличенно', async () => {
    const { p, calls } = fake(false, () => 'Пришла [0:05].')
    const m = project('a', [turn('S1', 5, 'Ева пришла')], { anon: ANON })
    const res = await askRecording(p, m, 'Кто пришёл?', [])
    expect(res).toEqual({ answer: 'Пришла [0:05].', sources: [] })
    expect(calls[0].system).toBe(ASK_SYSTEM_ONE)
    expect(calls[0].text).toContain('[0:05] Клиент: [Имя] пришла')
    expect(calls[0].text).not.toContain('Ева')
  })
  it('локальной модели — как есть', async () => {
    const { p, calls } = fake(true)
    await askRecording(p, project('a', [turn('S1', 5, 'Ева пришла')], { anon: ANON }), 'Кто?', [])
    expect(calls[0].text).toContain('Ева пришла')
  })
  it('без расшифровки — понятная ошибка', async () => {
    const { p } = fake(true)
    await expect(askRecording(p, project('a', []), 'Кто?', [])).rejects.toThrow('расшифруйте')
  })
})

describe('askAll', () => {
  const a = project('a', [turn('S1', 0, 'с мамой опять поругались'), turn('S1', 30, 'на работе завал')])
  const b = project('b', [turn('S1', 7, 'матерью я недовольна')])
  // Много текста не по теме — чтобы записи не влезали в модель целиком и включался поиск.
  const filler = project(
    'z',
    Array.from({ length: 60 }, (_, i) => turn('S1', i * 10, 'отпуск на море ' + 'песок волны чайки солнце пляж '.repeat(20).trim() + ' ' + i))
  )
  it('мало текста — отдаёт всё без поиска', async () => {
    const { p, calls } = fake(true, () => 'Ссоры с мамой [1].')
    await askAll(p, [a, b], 'Что говорила о матери?', [])
    expect(calls).toHaveLength(1)
    expect(calls[0].system).toBe(ASK_SYSTEM_MANY)
    expect(calls[0].text).toContain('завал')
  })
  it('много текста — ищет по словам вопроса и подсказкам модели, источники — только упомянутые', async () => {
    const { p, calls } = fake(true, (system) =>
      system === KEYWORDS_SYSTEM ? '["мама", "матерью"]' : 'Ссоры с мамой [1].'
    )
    const res = await askAll(p, [a, b, filler], 'Что говорила о матери?', [])
    expect(calls[0].system).toBe(KEYWORDS_SYSTEM)
    expect(calls[1].system).toBe(ASK_SYSTEM_MANY)
    expect(calls[1].text).toContain('мамой')
    expect(calls[1].text).toContain('матерью')
    expect(calls[1].text).not.toContain('отпуск')
    expect(res.sources).toHaveLength(1)
    expect(res.sources[0].n).toBe(1)
  })
  it('ничего не нашлось — модель не зовём, предлагаем искать внимательно', async () => {
    const { p, calls } = fake(true, () => '[]')
    const res = await askAll(p, [a, filler], 'квантовая физика', [])
    expect(res.sources).toEqual([])
    expect(res.notFound).toBe(true)
    expect(calls).toHaveLength(1) // только подсказка слов
  })
  it('подсказка слов сломалась — ищем по вопросу', async () => {
    const { p } = fake(true, (system) => {
      if (system === KEYWORDS_SYSTEM) throw new Error('ollama down')
      return 'про работу [1]'
    })
    const res = await askAll(p, [a, filler], 'что на работе?', [])
    expect(res.sources[0].snippet).toContain('работе')
  })
})

describe('askAllThorough', () => {
  it('читает каждую запись, время из выписки → ссылки на запись', async () => {
    const a = project('a', [turn('S1', 0, 'плохо сплю'), turn('S1', 75, 'всё ещё не сплю')], { createdAt: '2026-10-01T00:00:00Z' })
    const b = project('b', [turn('S1', 0, 'про работу')], { createdAt: '2026-10-08T00:00:00Z' })
    const c = project('c', [turn('S1', 30, 'выспалась')], { createdAt: '2026-10-15T00:00:00Z' })
    const { p, calls } = fake(true, (_s, text) =>
      text.includes('плохо') ? '- плохо спит [0:00]\n- всё ещё [1:15]' : text.includes('выспалась') ? '- выспалась [0:30]' : 'НЕТ'
    )
    const progress: number[] = []
    const res = await askAllThorough(p, [c, a, b], 'как сон?', [], (d) => progress.push(d))
    expect(calls).toHaveLength(3)
    expect(res.answer).toBe('Сессия a:\n- плохо спит [1]\n- всё ещё [2]\n\nСессия c:\n- выспалась [3]')
    expect(res.sources.map((s) => [s.slug, s.startSec])).toEqual([
      ['a', 0],
      ['a', 75],
      ['c', 30]
    ])
    expect(res.sources[1].snippet).toBe('Клиент: всё ещё не сплю')
    expect(progress).toEqual([0, 1, 2, 3])
  })
  it('ответа нет нигде — честно говорит', async () => {
    const { p } = fake(true, () => 'НЕТ.')
    const res = await askAllThorough(p, [project('a', [turn('S1', 0, 'x')])], 'q', [], () => {})
    expect(res.sources).toEqual([])
    expect(res.answer).toContain('нет')
  })
})

describe('enhanceNotes', () => {
  it('без заметок — ошибка', async () => {
    const { p } = fake(true)
    await expect(enhanceNotes(p, project('a', [turn('S1', 0, 'x')]))).rejects.toThrow('заметки')
  })
  it('заметки идут в system, облаку — обезличенно', async () => {
    const { p, calls } = fake(false, () => '## Конспект')
    const m = project('a', [turn('S1', 0, 'Ева плачет')], { anon: ANON, myNotes: '- Ева: слёзы' })
    expect(await enhanceNotes(p, m)).toBe('## Конспект')
    expect(calls[0].system).toContain('- [Имя]: слёзы')
    expect(calls[0].text).toBe('Клиент: [Имя] плачет')
  })
})

describe('sessionBrief / clientDynamics', () => {
  it('готовая выжимка с тем же хэшем не пересчитывается', async () => {
    const { p, calls } = fake(true, () => 'выжимка')
    const m = project('a', [turn('S1', 0, 'текст')])
    const first = await sessionBrief(p, m)
    expect(first.fresh).toBe(true)
    const again = await sessionBrief(p, { ...m, brief: { text: first.text, hash: first.hash } })
    expect(again.fresh).toBe(false)
    expect(calls).toHaveLength(1)
  })
  it('сессии по дате, выжимки сохраняются, итог сводится', async () => {
    const { p, calls } = fake(true, (system) => (system === BRIEF_SYSTEM ? 'выжимка' : '## Динамика'))
    const s1 = project('a', [turn('S1', 0, 'один')], { folder: 'Ева', createdAt: '2026-10-02T10:00:00Z' })
    const s2 = project('b', [turn('S1', 0, 'два')], { folder: 'Ева', createdAt: '2026-10-01T10:00:00Z' })
    const sessions = dynamicsSessions([s1, s2], 'Ева')
    expect(sessions.map((s) => s.slug)).toEqual(['b', 'a'])
    const saved: string[] = []
    const progress: number[] = []
    const out = await clientDynamics(p, sessions, {
      progress: (d) => progress.push(d),
      saveBrief: (m) => saved.push(m.slug)
    })
    expect(out).toBe('## Динамика')
    expect(saved).toEqual(['b', 'a'])
    expect(progress).toEqual([0, 1, 2])
    expect(calls[2].text).toContain('### Сессия 1 — «Сессия b»')
  })
  it('одна сессия — ошибка', async () => {
    const { p } = fake(true)
    await expect(
      clientDynamics(p, [project('a', [turn('S1', 0, 'x')])], { progress: () => {}, saveBrief: () => {} })
    ).rejects.toThrow('две')
  })
})

describe('russianOnly', () => {
  it('looksForeign: иероглифы и латиница', () => {
    expect(looksForeign('Ответ по-русски, всё хорошо.')).toBe(false)
    expect(looksForeign('- дневник сна 登记并翻译')).toBe(true)
    expect(looksForeign('The psychologist suggested that the patient should keep a sleep diary every day.')).toBe(true)
    expect(looksForeign('Встреча в Zoom про API')).toBe(false)
  })
  it('не по-русски — один повтор с напоминанием', async () => {
    let n = 0
    const { p, calls } = fake(true, () => (n++ === 0 ? 'The answer is diary for the whole week, every single day.' : 'Дневник сна.'))
    expect(await russianOnly(p).generate('sys', 'text')).toBe('Дневник сна.')
    expect(calls[1].system).toContain('только на русском')
  })
  it('повтор снова с иероглифами — выкидывает такие строки', async () => {
    const { p } = fake(true, () => '- дневник сна\n登记并翻译成英文')
    expect(await russianOnly(p).generate('sys', 'text')).toBe('- дневник сна')
  })
  it('ничего русского — честная ошибка', async () => {
    const { p } = fake(true, () => '登记并翻译成英文')
    await expect(russianOnly(p).generate('sys', 'text')).rejects.toThrow('не по-русски')
  })
})

describe('ревью волны 4: облако и длинные записи', () => {
  it('облаку: имя в вопросе, истории, названии и имени говорящего обезличено', async () => {
    const m = project('a', [turn('S1', 0, 'Ева плачет')], { anon: ANON, title: 'Сессия с Евой' })
    m.speakers = [{ id: 'S1', engineLabel: 'S1', name: 'Ева', colorKey: 'b' }]
    const { p, calls } = fake(false, () => 'ответ')
    await askAll(p, [m], 'Что Ева говорила? Евы не было?', [{ q: 'А Еве что?', a: 'Еве плохо' }])
    const sent = calls.map((c) => c.system + c.text).join('\n')
    expect(sent).not.toMatch(/Ев[аыеуо]/)
    expect(sent).toContain('[Имя]')
  })
  it('«внимательно»: вопрос в каждой части длинной записи', async () => {
    const long = Array.from({ length: 900 }, (_, i) => turn('S1', i * 5, 'обычный текст разговора номер ' + i))
    const { p, calls } = fake(true, () => 'НЕТ')
    await askRecording(p, project('a', long), 'Что про сон?', [], true)
    const parts = calls.filter((c) => !c.system.includes('Сведи'))
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((c) => c.system.includes('ВОПРОС: Что про сон?'))).toBe(true)
  })
  it('одна длинная запись: в модель идёт весь бюджет, а не 3 куска', async () => {
    const long = Array.from({ length: 400 }, (_, i) =>
      turn('S1', i * 5, (i % 2 ? 'мама звонила снова и ругалась ' : 'работа и коллеги ') + 'слово '.repeat(20) + i)
    )
    const { p, calls } = fake(true, (s) => (s === KEYWORDS_SYSTEM ? '["мама"]' : 'ответ'))
    await askRecording(p, project('a', long), 'Что говорила мама?', [])
    const ctx = calls[calls.length - 1].text
    expect((ctx.match(/^\[\d+\]/gm) ?? []).length).toBeGreaterThan(6)
  })
})
