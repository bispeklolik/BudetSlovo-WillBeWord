import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../paths'
import type { Note, NoteInput } from '../../shared/types'

const NOTES_FILE = join(DATA_DIR, 'notes.json')

function read(): Note[] {
  try {
    const data = JSON.parse(readFileSync(NOTES_FILE, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function write(notes: Note[]): void {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf8')
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
