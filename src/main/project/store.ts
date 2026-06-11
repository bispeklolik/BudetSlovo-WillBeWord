import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'fs'
import { join, basename, extname } from 'path'
import { randomUUID } from 'crypto'
import { PROJECTS_DIR } from '../paths'
import { repairAndRemux } from '../audio/import'
import { buildPeaks } from '../jobs/peaks'
import type { ProjectMeta } from '../../shared/types'

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya'
}

// Движок падает на кириллице/пробелах в путях — slug строго ASCII.
export function slugify(title: string): string {
  const lower = title.toLowerCase()
  let out = ''
  for (const ch of lower) {
    if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch]
    else if (/[a-z0-9]/.test(ch)) out += ch
    else out += '-'
  }
  out = out.replace(/-+/g, '-').replace(/^-|-$/g, '')
  return out || 'zapis'
}

function uniqueSlug(base: string): string {
  let slug = base
  let n = 2
  while (existsSync(join(PROJECTS_DIR, slug))) {
    slug = `${base}-${n++}`
  }
  return slug
}

export function writeJsonAtomic(file: string, obj: unknown): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function projectDir(slug: string): string {
  return join(PROJECTS_DIR, slug)
}

export function getProject(slug: string): ProjectMeta | null {
  try {
    return JSON.parse(readFileSync(join(projectDir(slug), 'project.json'), 'utf8'))
  } catch {
    return null
  }
}

export function saveProject(meta: ProjectMeta): void {
  meta.updatedAt = new Date().toISOString()
  writeJsonAtomic(join(projectDir(meta.slug), 'project.json'), meta)
}

export function listProjects(): ProjectMeta[] {
  if (!existsSync(PROJECTS_DIR)) return []
  const out: ProjectMeta[] = []
  for (const name of readdirSync(PROJECTS_DIR)) {
    const meta = getProject(name)
    if (meta) out.push(meta)
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return out
}

export function readPeaks(slug: string): Buffer | null {
  try {
    return readFileSync(join(projectDir(slug), 'peaks.bin'))
  } catch {
    return null
  }
}

export type ImportPhase = 'repair' | 'peaks' | 'done'

export async function createProjectFromFile(
  src: string,
  onProgress?: (phase: ImportPhase) => void
): Promise<ProjectMeta> {
  mkdirSync(PROJECTS_DIR, { recursive: true })
  const title = basename(src, extname(src))
  const slug = uniqueSlug(slugify(title))
  const dir = projectDir(slug)
  mkdirSync(dir, { recursive: true })

  onProgress?.('repair')
  const { prefixBytes } = await repairAndRemux(src, dir)

  onProgress?.('peaks')
  const { durationSec } = await buildPeaks(join(dir, 'audio.m4a'), join(dir, 'peaks.bin'), 50)

  const now = new Date().toISOString()
  const meta: ProjectMeta = {
    version: 1,
    id: randomUUID(),
    slug,
    title,
    createdAt: now,
    updatedAt: now,
    audio: {
      file: 'audio.m4a',
      originalPath: src,
      durationSec: Math.round(durationSec * 100) / 100,
      repairedPrefixBytes: prefixBytes,
      peaks: { file: 'peaks.bin', perSec: 50 }
    }
  }
  writeJsonAtomic(join(dir, 'project.json'), meta)
  onProgress?.('done')
  return meta
}
