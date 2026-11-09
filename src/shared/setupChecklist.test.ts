import { describe, it, expect } from 'vitest'
import { buildChecklist, doneCount, type ChecklistFacts } from './setupChecklist'

const base: ChecklistFacts = {
  settings: {},
  localSttInstalled: false,
  localAiInstalled: false,
  dictations: 0,
  ownRecords: 0
}
const done = (f: ChecklistFacts) => Object.fromEntries(buildChecklist(f).map((i) => [i.id, i.done]))

describe('buildChecklist', () => {
  it('новый человек: ничего не выполнено', () => {
    expect(doneCount(buildChecklist(base))).toBe(0)
    expect(buildChecklist(base)).toHaveLength(5)
  })
  it('распознавание: ключ облака или локальный движок; пустой ключ не считается', () => {
    expect(done({ ...base, settings: { sttKeys: { deepgram: '  ' } } }).stt).toBe(false)
    expect(done({ ...base, settings: { sttKeys: { deepgram: 'abc' } } }).stt).toBe(true)
    expect(done({ ...base, localSttInstalled: true }).stt).toBe(true)
  })
  it('распознавание считается по выбранному движку (ревью шага 7)', () => {
    expect(done({ ...base, settings: { sttEngine: 'deepgram', sttKeys: { groq: 'k' } } }).stt).toBe(false)
    expect(done({ ...base, settings: { sttEngine: 'deepgram', sttKeys: { deepgram: 'k' } } }).stt).toBe(true)
    expect(done({ ...base, settings: { sttEngine: 'local', sttKeys: { deepgram: 'k' } } }).stt).toBe(false)
    expect(done({ ...base, settings: { sttEngine: 'local' }, localSttInstalled: true }).stt).toBe(true)
  })
  it('ИИ: ключ Claude, OpenRouter или локальный', () => {
    expect(done({ ...base, settings: { anthropicKey: 'k' } }).ai).toBe(true)
    expect(done({ ...base, settings: { openrouterKey: 'k' } }).ai).toBe(true)
    expect(done({ ...base, localAiInstalled: true }).ai).toBe(true)
    expect(done({ ...base, settings: { anthropicKey: ' ' } }).ai).toBe(false)
  })
  it('словарь: не меньше 3 слов', () => {
    const v = (words: string[]) => ({ vocab: { words, replacements: [], snippets: [] } })
    expect(done({ ...base, settings: v(['а', 'б']) }).vocab).toBe(false)
    expect(done({ ...base, settings: v(['а', 'б', 'в']) }).vocab).toBe(true)
  })
  it('диктовка и своя запись считаются по данным', () => {
    const d = done({ ...base, dictations: 1, ownRecords: 2 })
    expect(d.dictation).toBe(true)
    expect(d.record).toBe(true)
  })
  it('всё выполнено — 5 из 5', () => {
    const items = buildChecklist({
      settings: { sttKeys: { groq: 'k' }, anthropicKey: 'k', vocab: { words: ['а', 'б', 'в'], replacements: [], snippets: [] } },
      localSttInstalled: false,
      localAiInstalled: false,
      dictations: 3,
      ownRecords: 1
    })
    expect(doneCount(items)).toBe(5)
  })
})
