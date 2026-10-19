import { powerSaveBlocker } from 'electron'

// Не давать компьютеру уснуть, пока идёт долгая работа (расшифровка часовой
// записи, загрузка движка). Экран гаснуть может. Идея — у Vibe.
const holders = new Set<string>()
let blockerId: number | null = null

export function holdAwake(reason: string): void {
  holders.add(reason)
  if (blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension')
}

export function releaseAwake(reason: string): void {
  holders.delete(reason)
  if (!holders.size && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

export function isHeldAwake(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId)
}
