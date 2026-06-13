import type { ProjectMeta } from '../../shared/types'
import { applyPatch, type Patch } from '../../shared/patches'

// Иммутабельное применение патча: клонируем проект, мутируем клон.
// Прежний объект остаётся нетронутым — его кладём в стек отмены.
export function withPatch(meta: ProjectMeta, patch: Patch): ProjectMeta {
  const clone: ProjectMeta = structuredClone(meta)
  applyPatch(clone, patch)
  clone.updatedAt = new Date().toISOString()
  return clone
}
