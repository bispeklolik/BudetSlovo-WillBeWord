import type { Turn } from './types'

// Слово «с таймингом» — только то, что дал движок. Вставленные вручную / ИИ слова
// времени не имеют, по ним паузу мерить нельзя.
function isTimed(w: { s?: number; e?: number }): w is { s: number; e: number } {
  return typeof w.s === 'number' && typeof w.e === 'number'
}

/**
 * Паузы между соседними словами с таймингом (внутри реплики и между репликами).
 * Ключ — id первого слова ПОСЛЕ паузы, значение — длина паузы в секундах (шаг 0.1).
 * Слова без тайминга пропускаются, но предыдущее слово с таймингом не сбрасывают:
 * иначе вставка посреди тишины «съела» бы паузу.
 * Слова с пустым текстом (t === '') тайминг сохраняют — показывать их или нет, решает вызывающий.
 */
export function computePauses(turns: Turn[], minSec: number): Map<number, number> {
  const out = new Map<number, number>()
  if (!(minSec > 0)) return out // 0, отрицательное и NaN — паузы выключены
  let prevEnd: number | null = null
  for (const turn of turns) {
    for (const w of turn.words) {
      if (!isTimed(w)) continue
      // Перед самым первым словом файла маркера нет — там нет «до».
      if (prevEnd !== null) {
        const gap = w.s - prevEnd
        // Округляем до сравнения: 2.96 с показывается как 3.0 и должно считаться паузой.
        const rounded = Math.round(gap * 10) / 10
        if (rounded >= minSec) out.set(w.id, rounded)
      }
      prevEnd = w.e
    }
  }
  return out
}

/** «пауза 4 с», «пауза 1 мин 5 с», «пауза 2 мин». */
export function fmtPause(sec: number): string {
  const total = Math.max(1, Math.round(sec))
  if (total < 60) return `пауза ${total} с`
  const min = Math.floor(total / 60)
  const rest = total % 60
  return rest === 0 ? `пауза ${min} мин` : `пауза ${min} мин ${rest} с`
}

export function pauseMarker(sec: number): string {
  return '(' + fmtPause(sec) + ')'
}
