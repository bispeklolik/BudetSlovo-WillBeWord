import { spawnSync } from 'child_process'
import { existsSync, statfsSync } from 'fs'
import { dirname, parse } from 'path'
import type { GpuInfo } from '../../shared/localModels'

// Железо для двери «На этом компьютере»: есть ли NVIDIA и сколько места.

let gpuCache: GpuInfo | null | undefined

/** Строка nvidia-smi «NVIDIA GeForce RTX 3060, 12288» → {name, vramMb}. */
export function parseNvidiaSmi(out: string): GpuInfo | null {
  const line = out.split(/\r?\n/).find((l) => l.trim())
  if (!line) return null
  const i = line.lastIndexOf(',')
  if (i < 0) return null
  const vramMb = Number(line.slice(i + 1).trim())
  const name = line.slice(0, i).trim()
  return name && Number.isFinite(vramMb) ? { name, vramMb } : null
}

export function detectGpu(): GpuInfo | null {
  if (gpuCache !== undefined) return gpuCache
  try {
    const r = spawnSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], {
      windowsHide: true,
      timeout: 8000,
      encoding: 'utf8'
    })
    gpuCache = r.status === 0 ? parseNvidiaSmi(r.stdout) : null
  } catch {
    gpuCache = null
  }
  return gpuCache
}

/** Свободное место на диске, где лежит (или будет лежать) путь. */
export function freeBytes(path: string): number | null {
  let p = path
  while (!existsSync(p)) {
    const up = dirname(p)
    if (up === p) {
      p = parse(path).root
      break
    }
    p = up
  }
  try {
    const s = statfsSync(p)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return null
  }
}
