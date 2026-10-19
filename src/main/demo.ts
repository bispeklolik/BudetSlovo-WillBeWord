import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { projectDir, getProject, writeJsonAtomic } from './project/store'
import { saveNote, listNotes } from './notes/store'
import { DEMO_TITLE, DEMO_SPEAKERS, DEMO_RESULTS, demoTurns } from '../shared/demo'
import type { ProjectMeta } from '../shared/types'

// Дверь «Посмотреть на примере»: готовая запись + два результата в «Конспектах».
// Повторное нажатие не плодит копии — открывает тот же пример.
const SLUG = 'primer-konsultacii'

export function createDemoProject(): ProjectMeta {
  const existing = getProject(SLUG)
  if (existing?.demo) return existing
  const dir = projectDir(SLUG)
  mkdirSync(dir, { recursive: true })
  const { turns, durationSec } = demoTurns()
  const now = new Date().toISOString()
  const meta: ProjectMeta = {
    version: 1,
    id: 'demo-' + Date.now().toString(36),
    slug: SLUG,
    title: DEMO_TITLE,
    createdAt: now,
    updatedAt: now,
    audio: {
      file: 'audio.m4a',
      originalPath: '',
      durationSec,
      repairedPrefixBytes: 0,
      peaks: { file: 'peaks.bin', perSec: 50 }
    },
    transcription: { numSpeakers: 2, enhance: false },
    engine: { model: 'demo', completedAt: now },
    speakers: DEMO_SPEAKERS,
    turns,
    demo: true
  }
  writeJsonAtomic(join(dir, 'project.json'), meta)
  const have = new Set(listNotes().filter((n) => n.sourceSlug === SLUG).map((n) => n.title))
  for (const r of DEMO_RESULTS) {
    if (!have.has(r.title)) saveNote({ title: r.title, body: r.body, kind: 'summary', sourceSlug: SLUG, sourceTitle: DEMO_TITLE })
  }
  return meta
}

export function demoExists(): boolean {
  return existsSync(join(projectDir(SLUG), 'project.json'))
}
