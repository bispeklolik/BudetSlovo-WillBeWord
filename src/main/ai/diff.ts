// Детерминированное пословное сравнение оригинала и причёсанного текста.
// Модель возвращает связную прозу; мы сами (без участия модели) вычисляем,
// какие слова сохранены / заменены / удалены / вставлены. Это позволяет
// наложить правки поверх существующего оверлея: сохранённые слова держат свои
// таймкоды (караоке живёт), заменённые помечаются как правка ИИ.

export type DiffOp =
  | { kind: 'keep'; origIndex: number; text: string }
  | { kind: 'replace'; origIndex: number; text: string }
  | { kind: 'delete'; origIndex: number }
  | { kind: 'insert'; text: string; afterOrigIndex: number }

// Для СРАВНЕНИЯ слова приводим к нижнему регистру и срезаем краевую пунктуацию,
// чтобы «зовут,» и «Зовут.» считались тем же словом (изменение пунктуации/регистра
// — это причёсывание, а не смысловая правка). Поверхностная форма берётся из
// причёсанного текста, так что новая пунктуация всё равно попадает в результат.
function norm(s: string): string {
  return s.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

export function diffWords(orig: string[], cleaned: string[]): DiffOp[] {
  const m = orig.length
  const n = cleaned.length
  const na = orig.map(norm)
  const nb = cleaned.map(norm)

  // LCS по нормализованным токенам (таблица с конца).
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = na[i] === nb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  // Разбор выравнивания в сырые шаги: keep / del / ins.
  type Raw =
    | { t: 'keep'; i: number; j: number }
    | { t: 'del'; i: number }
    | { t: 'ins'; j: number }
  const raw: Raw[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (na[i] === nb[j]) {
      raw.push({ t: 'keep', i, j })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ t: 'del', i })
      i++
    } else {
      raw.push({ t: 'ins', j })
      j++
    }
  }
  while (i < m) raw.push({ t: 'del', i: i++ })
  while (j < n) raw.push({ t: 'ins', j: j++ })

  // Склейка соседних del+ins (в любом порядке) в replace; остальное как есть.
  const ops: DiffOp[] = []
  let lastOrig = -1
  let k = 0
  while (k < raw.length) {
    const cur = raw[k]
    const nxt = raw[k + 1]
    if (cur.t === 'del' && nxt && nxt.t === 'ins') {
      ops.push({ kind: 'replace', origIndex: cur.i, text: cleaned[nxt.j] })
      lastOrig = cur.i
      k += 2
    } else if (cur.t === 'ins' && nxt && nxt.t === 'del') {
      ops.push({ kind: 'replace', origIndex: nxt.i, text: cleaned[cur.j] })
      lastOrig = nxt.i
      k += 2
    } else if (cur.t === 'keep') {
      ops.push({ kind: 'keep', origIndex: cur.i, text: cleaned[cur.j] })
      lastOrig = cur.i
      k++
    } else if (cur.t === 'del') {
      ops.push({ kind: 'delete', origIndex: cur.i })
      lastOrig = cur.i
      k++
    } else {
      ops.push({ kind: 'insert', text: cleaned[cur.j], afterOrigIndex: lastOrig })
      k++
    }
  }
  return ops
}
