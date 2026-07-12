import { readFileSync, mkdirSync, existsSync, copyFileSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../paths'
import { writeJsonAtomic } from '../project/store'
import type { Note, NoteInput } from '../../shared/types'

const NOTES_FILE = join(DATA_DIR, 'notes.json')

// Конспекты — самый ценный файл после записей. Схема защиты как у project.json:
// .bak перед записью → атомарная запись (tmp→rename) → при повреждении читаем .bak.
// ВАЖНО: read() различает «файла нет» (пустой список) и «файл битый» (fallback в
// .bak); раньше битый файл читался как [], и следующий saveNote затирал всё пустотой.

function parseNotes(file: string): Note[] | null {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

function read(): Note[] {
  if (!existsSync(NOTES_FILE)) return []
  const main = parseNotes(NOTES_FILE)
  if (main) return main
  const bak = parseNotes(NOTES_FILE + '.bak')
  if (bak) return bak
  // Оба файла битые — не притворяемся пустым списком, чтобы не затереть остатки.
  throw new Error(
    'Файл конспектов повреждён (notes.json). Скопируйте его из папки данных и обратитесь за восстановлением.'
  )
}

function write(notes: Note[]): void {
  mkdirSync(DATA_DIR, { recursive: true })
  try {
    if (existsSync(NOTES_FILE)) copyFileSync(NOTES_FILE, NOTES_FILE + '.bak')
  } catch {
    /* .bak не критичен */
  }
  writeJsonAtomic(NOTES_FILE, notes)
}

export function listNotes(): Note[] {
  return read().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// Сохранить новый (без id) или обновить существующий (с id) конспект.
export function saveNote(input: NoteInput): Note {
  const notes = read()
  const now = new Date().toISOString()
  if (input.id) {
    const i = notes.findIndex((n) => n.id === input.id)
    if (i >= 0) {
      notes[i] = { ...notes[i], ...input, id: notes[i].id, updatedAt: now }
      write(notes)
      return notes[i]
    }
  }
  const note: Note = {
    id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: input.title,
    body: input.body,
    kind: input.kind,
    sourceSlug: input.sourceSlug,
    sourceTitle: input.sourceTitle,
    createdAt: now,
    updatedAt: now
  }
  notes.push(note)
  write(notes)
  return note
}

export function deleteNote(id: string): void {
  write(read().filter((n) => n.id !== id))
}
