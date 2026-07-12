import { join } from 'path'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import type { ProjectMeta, Turn, SpeakerInfo } from '../../shared/types'
import { getProject, saveTranscript, projectDir, writeJsonAtomic } from '../project/store'
import { getProvider } from './provider'
import { applyCleanup } from './apply'
import { ensureOllama } from './ollamaServer'

export interface CleanupProgress {
  done: number
  total: number
  phase: string
}

const backupPath = (slug: string): string => join(projectDir(slug), 'ai-backup.json')

interface Snapshot {
  turns: Turn[]
  speakers: SpeakerInfo[]
}

// Бережная ИИ-чистка проекта по репликам. Снимок оригинала кладётся в
// ai-backup.json (для отката и идемпотентности: повторный запуск чистит заново
// от оригинала). Мусорные ответы модели (пустые/дико расходящиеся по длине)
// пропускаются — реплика остаётся как есть, задача не падает.
export async function runCleanup(
  slug: string,
  providerId: string,
  onProgress: (p: CleanupProgress) => void
): Promise<ProjectMeta | null> {
  const meta = getProject(slug)
  if (!meta || !meta.turns) return null
  const provider = getProvider(providerId)
  if (!provider) throw new Error('AI_PROVIDER_NOT_FOUND')
  if (provider.isLocal && !(await ensureOllama())) throw new Error('AI_UNAVAILABLE')
  if (!(await provider.isAvailable())) throw new Error('AI_MODEL_MISSING')

  // База для чистки = оригинал. Если бэкап уже есть (чистили раньше) — чистим от
  // него и НЕ перезаписываем (храним самый первый оригинал).
  let baseTurns: Turn[]
  let speakers: SpeakerInfo[]
  if (existsSync(backupPath(slug))) {
    const snap = JSON.parse(readFileSync(backupPath(slug), 'utf8')) as Snapshot
    baseTurns = snap.turns
    speakers = snap.speakers ?? meta.speakers ?? []
  } else {
    baseTurns = meta.turns
    speakers = meta.speakers ?? []
    writeJsonAtomic(backupPath(slug), { turns: baseTurns, speakers } satisfies Snapshot)
  }

  // Уникальные id для вставок — от максимума по всему проекту.
  let maxId = 0
  for (const t of baseTurns) for (const w of t.words) if (w.id > maxId) maxId = w.id
  const nextId = (): number => ++maxId

  const total = baseTurns.length
  const out: Turn[] = new Array(total)
  let done = 0

  const cleanOne = async (i: number): Promise<void> => {
    const t = baseTurns[i]
    const text = t.words
      .map((w) => w.t)
      .join(' ')
      .trim()
    let words = t.words
    if (text) {
      try {
        const { cleaned, suspect } = await provider.cleanupTurn(text, {})
        // Guard от молчаливой порчи: чистка убирает паразитов (обычно ≤25%
        // текста). Усадка сильнее 30% — почти наверняка обрезанный моделью
        // ввод (переполнение контекста), применять нельзя.
        if (cleaned && cleaned.length >= text.length * 0.7 && cleaned.length <= text.length * 2.5) {
          words = applyCleanup(t.words, cleaned, nextId, suspect)
        }
      } catch {
        // оставляем реплику как есть
      }
    }
    out[i] = { ...t, words }
    onProgress({ done: ++done, total, phase: 'Причёсываю' })
  }

  // Облако тянет параллель (4 реплики разом — в разы быстрее на длинной
  // сессии); локальная Ollama обрабатывает по одной (GPU и так занят).
  const concurrency = provider.isLocal ? 1 : 4
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < total) {
      const i = next++
      await cleanOne(i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()))

  onProgress({ done: total, total, phase: 'Сохранение' })
  return saveTranscript(slug, out, speakers)
}

export function revertCleanup(slug: string): ProjectMeta | null {
  const f = backupPath(slug)
  if (!existsSync(f)) return null
  const snap = JSON.parse(readFileSync(f, 'utf8')) as Snapshot
  const saved = saveTranscript(slug, snap.turns, snap.speakers ?? [])
  unlinkSync(f)
  return saved
}

export function hasAiBackup(slug: string): boolean {
  return existsSync(backupPath(slug))
}
