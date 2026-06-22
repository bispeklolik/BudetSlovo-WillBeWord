import type { Turn, SpeakerInfo } from './types'

// Статистика записи: сколько говорил каждый участник (время речи = сумма
// длительностей распознанных слов e−s; вставленные слова без таймкодов
// считаются в словах, но не во времени), плюс слова и реплики. Для психолога
// баланс речи Психолог/Клиент — полезная супервизорская метрика.

export interface SpeakerStat {
  spk: string
  name: string
  talkSec: number
  words: number
  turns: number
  talkPct: number
}

export interface RecordStats {
  durationSec: number
  totalWords: number
  totalTurns: number
  totalTalkSec: number
  speakers: SpeakerStat[]
}

const round1 = (n: number): number => Math.round(n * 10) / 10

export function computeStats(
  turns: Turn[],
  speakers: SpeakerInfo[],
  durationSec: number
): RecordStats {
  const nameOf = (spk: string): string => speakers.find((s) => s.id === spk)?.name ?? spk
  const acc = new Map<string, { talkSec: number; words: number; turns: number }>()

  for (const turn of turns) {
    const a = acc.get(turn.spk) ?? { talkSec: 0, words: 0, turns: 0 }
    a.turns += 1
    for (const w of turn.words) {
      a.words += 1
      if (typeof w.s === 'number' && typeof w.e === 'number' && w.e > w.s) a.talkSec += w.e - w.s
    }
    acc.set(turn.spk, a)
  }

  let totalTalkSec = 0
  let totalWords = 0
  for (const a of acc.values()) {
    totalTalkSec += a.talkSec
    totalWords += a.words
  }

  const speakerStats: SpeakerStat[] = [...acc.entries()]
    .map(([spk, a]) => ({
      spk,
      name: nameOf(spk),
      talkSec: round1(a.talkSec),
      words: a.words,
      turns: a.turns,
      talkPct: totalTalkSec > 0 ? Math.round((a.talkSec / totalTalkSec) * 100) : 0
    }))
    .sort((x, y) => y.talkSec - x.talkSec)

  return {
    durationSec,
    totalWords,
    totalTurns: turns.length,
    totalTalkSec: round1(totalTalkSec),
    speakers: speakerStats
  }
}
