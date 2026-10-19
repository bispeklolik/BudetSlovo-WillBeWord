import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  existsSync,
  copyFileSync,
  unlinkSync,
  rmSync
} from 'fs'
import { join, basename, extname } from 'path'
import { randomUUID } from 'crypto'
import { PROJECTS_DIR } from '../paths'
import { repairAndRemux } from '../audio/import'
import { buildPeaks } from '../jobs/peaks'
import { hasAudio, toMonoM4a, mixTwo } from '../calls/ffmpeg'
import type { ProjectMeta, Turn, SpeakerInfo } from '../../shared/types'

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
  const file = join(projectDir(slug), 'project.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // project.json повреждён (например, обрыв питания) — пробуем последний .bak
    try {
      return JSON.parse(readFileSync(file + '.bak', 'utf8'))
    } catch {
      return null
    }
  }
}

export function saveProject(meta: ProjectMeta): void {
  meta.updatedAt = new Date().toISOString()
  writeJsonAtomic(join(projectDir(meta.slug), 'project.json'), meta)
}

const lastSnapshotAt = new Map<string, number>()

// Сохранение правок транскрипта: .bak (последний хороший) -> атомарная запись
// -> троттлинг-снапшот в autosave\ (на случай повреждения основного файла).
export function saveTranscript(
  slug: string,
  turns: Turn[],
  speakers: SpeakerInfo[]
): ProjectMeta | null {
  const meta = getProject(slug)
  if (!meta) return null
  meta.turns = turns
  meta.speakers = speakers
  meta.updatedAt = new Date().toISOString()

  const file = join(projectDir(slug), 'project.json')
  try {
    if (existsSync(file)) copyFileSync(file, file + '.bak')
  } catch {
    /* .bak не критичен */
  }
  writeJsonAtomic(file, meta)

  const now = Date.now()
  if (now - (lastSnapshotAt.get(slug) ?? 0) > 60000) {
    lastSnapshotAt.set(slug, now)
    try {
      const dir = join(projectDir(slug), 'autosave')
      mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      writeFileSync(join(dir, stamp + '.json'), JSON.stringify(meta), 'utf8')
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
      while (files.length > 10) {
        const f = files.shift()
        if (f) {
          try {
            unlinkSync(join(dir, f))
          } catch {
            /* игнор */
          }
        }
      }
    } catch {
      /* снапшот не критичен */
    }
  }
  return meta
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

export type ImportPhase = 'repair' | 'extract' | 'peaks' | 'done'

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
  const { prefixBytes } = await repairAndRemux(src, dir, () => onProgress?.('extract'))

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

/**
 * Запись звонка → проект. В папке записи лежат mic.webm (микрофон) и sys.webm
 * (звук компьютера). Каждая дорожка сохраняется отдельно (моно m4a) — их
 * расшифровывают по отдельности, говорящие известны заранее. Для прослушивания
 * собираем общую audio.m4a. Если одна дорожка пустая — запись из одной.
 */
export async function createProjectFromCall(
  callDir: string,
  opts: { title: string; names: [string, string]; app?: string }
): Promise<ProjectMeta> {
  const micSrc = join(callDir, 'mic.webm')
  const sysSrc = join(callDir, 'sys.webm')
  const haveMic = hasAudio(micSrc)
  const haveSys = hasAudio(sysSrc)
  if (!haveMic && !haveSys) throw new Error('Запись пустая: ни микрофон, ни звук компьютера не записались.')
  mkdirSync(PROJECTS_DIR, { recursive: true })
  const slug = uniqueSlug(slugify(opts.title))
  const dir = projectDir(slug)
  mkdirSync(dir, { recursive: true })
  let durationSec: number
  try {
    if (haveMic) await toMonoM4a(micSrc, join(dir, 'mic.m4a'))
    if (haveSys) await toMonoM4a(sysSrc, join(dir, 'sys.m4a'))
    if (haveMic && haveSys) await mixTwo(join(dir, 'mic.m4a'), join(dir, 'sys.m4a'), join(dir, 'audio.m4a'))
    else copyFileSync(join(dir, haveMic ? 'mic.m4a' : 'sys.m4a'), join(dir, 'audio.m4a'))
    ;({ durationSec } = await buildPeaks(join(dir, 'audio.m4a'), join(dir, 'peaks.bin'), 50))
  } catch (err) {
    // Недостроенную папку убираем: без project.json её не видно в списке и не удалить,
    // а восстановление при каждом запуске плодило бы новые (ревью волны 3).
    // Исходные дорожки в calls\<id> остаются — запись не потеряна.
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
  const now = new Date().toISOString()
  const meta: ProjectMeta = {
    version: 1,
    id: randomUUID(),
    slug,
    title: opts.title,
    createdAt: now,
    updatedAt: now,
    audio: {
      file: 'audio.m4a',
      originalPath: '',
      durationSec: Math.round(durationSec * 100) / 100,
      repairedPrefixBytes: 0,
      peaks: { file: 'peaks.bin', perSec: 50 }
    },
    channels: {
      mic: haveMic ? 'mic.m4a' : '',
      sys: haveSys ? 'sys.m4a' : '',
      names: opts.names,
      app: opts.app
    }
  }
  writeJsonAtomic(join(dir, 'project.json'), meta)
  return meta
}
