// Словарь, который учится (волна 6).
// 1. Человек исправил вставленный текст в «Последних диктовках» → находим, какие
//    слова заменены, и предлагаем точные замены и слова в словарь.
// 2. Нечёткое исправление по словарю (идея Handy, MIT): слово распознано почти
//    как слово из словаря («Шварцаман») → пишем, как в словаре («Шварцман»).

import { stem } from './retrieval'

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
const tokens = (s: string): string[] => s.match(TOKEN) ?? []
const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е')

/** Номера слов, с которых начинается предложение (первое, после .!?… и перевода строки). */
function sentenceStarts(s: string): Set<number> {
  const out = new Set<number>()
  let k = 0
  for (const m of s.matchAll(TOKEN)) {
    const before = s.slice(0, m.index).replace(/[ \t«"(]+$/, '')
    if (!before || /[.!?…\n]$/.test(before)) out.add(k)
    k++
  }
  return out
}

export interface Suggestion {
  from: string
  to: string
}

/**
 * Пары «как было → как надо» из правки текста. Берём только замены
 * 1–3 слов на 1–3 слова; вставки и удаления целых кусков — это правка смысла,
 * а не ошибка распознавания.
 */
export function suggestFromEdit(before: string, after: string): Suggestion[] {
  const a = tokens(before)
  const b = tokens(after)
  const starts = sentenceStarts(before)
  // LCS по нормализованным словам
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: Suggestion[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && norm(a[i]) === norm(b[j])) {
      // Совпало без учёта регистра, но регистр другой — тоже правка («кпт» → «КПТ»).
      // Кроме начала предложения: там заглавная — правило письма, а не слово.
      if (a[i] !== b[j] && a[i].toLowerCase() !== a[i].toUpperCase() && !starts.has(i)) out.push({ from: a[i], to: b[j] })
      i++
      j++
      continue
    }
    const si = i
    const sj = j
    while (i < n && j < m && norm(a[i]) !== norm(b[j])) {
      if (dp[i + 1][j] >= dp[i][j + 1]) i++
      else j++
    }
    while (i < n && j === m) i++
    while (j < m && i === n) j++
    const from = a.slice(si, i)
    const to = b.slice(sj, j)
    if (from.length >= 1 && from.length <= 3 && to.length >= 1 && to.length <= 3) out.push({ from: from.join(' '), to: to.join(' ') })
  }
  const seen = new Set<string>()
  const numeric = (t: string): boolean => !/\p{L}/u.test(t)
  return out.filter((s) => {
    const k = norm(s.from) + '→' + s.to
    // Числа — правка смысла («5» → «7»), а не ошибка распознавания слова.
    if (numeric(s.from) || numeric(s.to)) return false
    if (seen.has(k) || (norm(s.from) === norm(s.to) && s.from === s.to)) return false
    seen.add(k)
    return true
  })
}

/** Расстояние Левенштейна с ранним выходом, если больше max. */
export function editDistance(x: string, y: string, max = 3): number {
  if (Math.abs(x.length - y.length) > max) return max + 1
  let prev = Array.from({ length: y.length + 1 }, (_, k) => k)
  for (let i = 1; i <= x.length; i++) {
    const cur = [i]
    let best = i
    for (let k = 1; k <= y.length; k++) {
      cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (x[i - 1] === y[k - 1] ? 0 : 1))
      best = Math.min(best, cur[k])
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[y.length]
}

/**
 * Слова, почти совпадающие со словом из словаря, пишем как в словаре.
 * Осторожно: только однословные записи словаря от 5 букв, та же первая буква.
 * Сравниваем основы слов (без окончаний): «Марине» при «Марина» в словаре — то же
 * слово в другом падеже, не трогаем (ревью волны 6: правка падежа ломала текст).
 * Почти-совпадение основы («Шварцамана» → «Шварцмана»): основа из словаря,
 * окончание — своё. Только для основ от 6 букв: «малина» не станет «Марина».
 * Отличие — 1 буква (основа до 7 букв) или 2 (длиннее).
 */
export function fuzzyFixVocab(text: string, vocab: string[] | undefined): string {
  const list = (vocab ?? []).map((w) => w.trim()).filter((w) => w.length >= 5 && !/\s/.test(w))
  if (!list.length) return text
  return text.replace(/[\p{L}][\p{L}'’-]*/gu, (w) => {
    if (w.length < 5) return w
    const nw = norm(w)
    const sw = stem(w)
    let best: string | null = null
    let bestD = 99
    for (const v of list) {
      const nv = norm(v)
      if (nv === nw) return v === w ? w : w[0] === w[0].toUpperCase() && v[0] !== v[0].toUpperCase() ? w : v
      if (nv[0] !== nw[0]) continue
      const sv = stem(v)
      if (sv === sw) {
        // Своё окончание — другой падеж того же слова. Без окончания
        // («гешталт» при «гештальт») — ошибка, пишем как в словаре.
        if (nw.length > sw.length) return w
        return v
      }
      if (sv.length < 6) continue
      const max = Math.max(sv.length, sw.length) <= 7 ? 1 : 2
      const d = editDistance(sw, sv, max)
      if (d <= max && d < bestD) {
        bestD = d
        best = v.slice(0, sv.length) + w.slice(sw.length)
      }
    }
    return best ?? w
  })
}
