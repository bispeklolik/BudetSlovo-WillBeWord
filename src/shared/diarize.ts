// Кто говорит каждое СЛОВО (а не каждое предложение).
//
// Движок (Faster-Whisper-XXL --diarize) в текстовом выводе даёт одну метку на
// предложение: короткое «угу», «да» внутри чужой реплики сливалось с ней —
// «фразы смешиваются». С --diarize_dump движок пишет «сырую» разметку: кто
// говорил в каждый отрезок времени, включая короткие вставки поверх чужой
// речи. Здесь по ней ставим метку каждому слову (как WhisperX), а реплики
// потом режутся на каждой смене говорящего.

export interface DiarTurn {
  start: number
  end: number
  label: string
}

// [ 00:00:03.000 -->  00:00:03.372] B SPEAKER_04
const DUMP_LINE = /^\[\s*([\d:.,]+)\s*-->\s*([\d:.,]+)\s*\]\s*\S*\s+(\S+)\s*$/

function tcToSec(tc: string): number {
  let sec = 0
  for (const p of tc.split(':')) sec = sec * 60 + parseFloat(p.replace(',', '.'))
  return sec
}

/** Файл *_dump.txt движка → отрезки речи по говорящим. */
export function parseDiarizeDump(text: string): DiarTurn[] {
  const out: DiarTurn[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = DUMP_LINE.exec(line.trim())
    if (!m) continue
    const start = tcToSec(m[1])
    const end = tcToSec(m[2])
    if (end > start) out.push({ start, end, label: m[3] })
  }
  return out.sort((a, b) => a.start - b.start)
}

export interface TimedWord {
  s: number
  e: number
}

/** Сколько времени слова [s, e] каждый говорящий звучит (сумма пересечений). */
function overlapByLabel(s: number, e: number, turns: DiarTurn[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of turns) {
    if (t.start >= e) break
    const ov = Math.min(e, t.end) - Math.max(s, t.start)
    if (ov > 0) m.set(t.label, (m.get(t.label) ?? 0) + ov)
  }
  return m
}

/** Ближайший говорящий для слова в паузе разметки (до maxGap секунд). */
function nearestLabel(s: number, e: number, turns: DiarTurn[], maxGap: number): string | null {
  let best: string | null = null
  let bestGap = maxGap
  for (const t of turns) {
    const gap = t.end <= s ? s - t.end : t.start >= e ? t.start - e : 0
    if (gap < bestGap) {
      bestGap = gap
      best = t.label
    }
  }
  return best
}

/**
 * Метка говорящего для каждого слова.
 * 1. Чей голос дольше звучит на отрезке слова — того и слово.
 * 2. Голоса звучат одинаково (речь поверх речи) — оставляем говорящего
 *    предыдущего слова, если он среди них: Whisper обычно пишет основную речь,
 *    а не вставку поверх неё.
 * 3. Слово в паузе разметки — ближайший говорящий (до 1 с), иначе как у соседа.
 * 4. Сглаживание: слово, которое лишь чуть задело чужой отрезок (меньше
 *    половины слова) и стоит между словами одного говорящего, — тому говорящему.
 *    Настоящая вставка («угу» поверх речи) звучит своим голосом всю длину слова
 *    и остаётся отдельной.
 */
export function assignWordSpeakers(words: TimedWord[], turns: DiarTurn[], fallback = 'SPEAKER_00'): string[] {
  if (!turns.length) return words.map(() => fallback)
  const labels: (string | null)[] = []
  const strength: number[] = [] // доля слова, которую звучит выбранный говорящий
  for (let i = 0; i < words.length; i++) {
    const { s, e } = words[i]
    const dur = Math.max(e - s, 0.01)
    const ov = overlapByLabel(s, e, turns)
    if (!ov.size) {
      labels.push(nearestLabel(s, e, turns, 1.0))
      strength.push(0)
      continue
    }
    const ranked = [...ov.entries()].sort((a, b) => b[1] - a[1])
    let pick = ranked[0][0]
    const prev = labels[i - 1]
    if (prev && ranked.length > 1 && ranked[0][1] - ranked[1][1] < 0.02 && ov.has(prev)) pick = prev
    labels.push(pick)
    strength.push(Math.min(1, (ov.get(pick) ?? 0) / dur))
  }
  // Пустые (далеко от разметки) — как у соседа.
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]) continue
    labels[i] = labels[i - 1] ?? labels.slice(i + 1).find((l) => l) ?? fallback
  }
  // Сглаживание шума на границах.
  const out = labels as string[]
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i] !== out[i - 1] && out[i - 1] === out[i + 1] && strength[i] < 0.5) out[i] = out[i - 1]
  }
  return out
}
