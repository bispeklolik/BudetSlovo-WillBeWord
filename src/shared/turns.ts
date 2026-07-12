import type { SpeakerInfo, Turn, Word } from './types'

// Нормализация распознанного в {speakers, turns}: общий код для main
// (локальный движок + облака) и веб-версии (браузерные вызовы облаков).

// Одно слово с уже определённым говорящим (label).
export interface FlatWord {
  s: number
  e: number
  p: number
  t: string
  label: string
}

export interface MergeResult {
  speakers: SpeakerInfo[]
  turns: Turn[]
}

const DEFAULT_NAMES = ['Психолог', 'Клиент']

// Группирует плоский список слов в реплики (подряд идущие слова одного
// говорящего) и строит список говорящих в порядке появления.
export function buildTurns(flat: FlatWord[]): MergeResult {
  const labels: string[] = []
  const speakerOf = (label: string): string => {
    let idx = labels.indexOf(label)
    if (idx === -1) {
      labels.push(label)
      idx = labels.length - 1
    }
    return 'S' + idx
  }

  const turns: Turn[] = []
  let wordId = 0
  let cur: Turn | null = null
  for (const w of flat) {
    const spk = speakerOf(w.label)
    if (!cur || cur.spk !== spk) {
      cur = { id: 'T' + turns.length, spk, startSec: w.s, words: [] }
      turns.push(cur)
    }
    const word: Word = { id: wordId++, s: w.s, e: w.e, p: Math.round(w.p * 1000) / 1000, t: w.t }
    cur.words.push(word)
  }

  const speakers: SpeakerInfo[] = labels.map((label, i) => ({
    id: 'S' + i,
    engineLabel: label,
    name: DEFAULT_NAMES[i] ?? `Говорящий ${i + 1}`,
    colorKey: 'spk' + ((i % 2) + 1)
  }))

  return { speakers, turns }
}
