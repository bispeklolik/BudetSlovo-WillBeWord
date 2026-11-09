import { create } from 'zustand'
import type { ProjectMeta } from '../../shared/types'
import { buildFolderTree, ancestorPaths } from '../../shared/folders'
import { api } from './api'
import { showToast, humanError } from './toast'

// Общее состояние библиотеки: им пользуются боковое меню (дерево папок),
// страница «Записи» и «Главная». Раньше всё это жило внутри Home.tsx.

interface LibraryState {
  /** null — список ещё не пришёл (показываем скелетон, а не «Добро пожаловать»). */
  projects: ProjectMeta[] | null
  error: string | null
  folderList: string[]
  /** Выбранная папка: '' — все записи, иначе путь. */
  folder: string
  notesCount: number
  refresh: () => Promise<void>
  refreshNotes: () => void
  loadFolders: () => void
  setFolder: (path: string) => void
  persistFolders: (next: string[]) => Promise<void>
  createFolder: (name: string) => void
  renameFolder: (oldPath: string, newName: string) => Promise<void>
  deleteFolder: (path: string) => void
  moveRecord: (slug: string, dest: string) => Promise<void>
}

export const useLibrary = create<LibraryState>((set, get) => ({
  projects: null,
  error: null,
  folderList: [],
  folder: '',
  notesCount: 0,

  refresh: async () => {
    try {
      const list = await api.listProjects()
      set({ projects: list, error: null })
    } catch (e) {
      // Уже загруженный список не затираем ошибкой фонового обновления.
      if (get().projects === null) set({ error: humanError(e) })
    }
  },
  refreshNotes: () => {
    api
      .listNotes()
      .then((n) => set({ notesCount: n.length }))
      .catch(() => {})
  },
  loadFolders: () => {
    api.getSettings().then((s) => set({ folderList: s.folders ?? [] }))
  },
  setFolder: (path) => set({ folder: path }),

  persistFolders: async (next) => {
    set({ folderList: next })
    await api.setSettings({ folders: next })
  },
  createFolder: (name) => {
    const { folder, folderList, persistFolders } = get()
    const np = (folder ? folder + '/' : '') + name
    if (!folderList.includes(np)) void persistFolders([...folderList, np])
    set({ folder: np })
  },
  renameFolder: async (oldPath, newName) => {
    const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/') + 1) : ''
    const np = parent + newName
    if (np === oldPath) return
    await api.renameFolder(oldPath, np) // переписывает префиксы у записей
    const { folderList, folder, persistFolders, refresh } = get()
    const nl = folderList.map((f) =>
      f === oldPath ? np : f.startsWith(oldPath + '/') ? np + f.slice(oldPath.length) : f
    )
    await persistFolders(nl)
    if (folder === oldPath || folder.startsWith(oldPath + '/'))
      set({ folder: np + folder.slice(oldPath.length) })
    await refresh()
  },
  deleteFolder: (path) => {
    const { projects, folderList, folder, persistFolders } = get()
    const n = (projects ?? []).filter((p) => {
      const f = p.folder ?? ''
      return f === path || f.startsWith(path + '/')
    }).length
    if (n > 0) {
      showToast('В папке есть записи. Сначала переместите их в другую папку.', 'info')
      return
    }
    void persistFolders(folderList.filter((f) => f !== path && !f.startsWith(path + '/')))
    if (folder === path || folder.startsWith(path + '/')) set({ folder: '' })
  },
  moveRecord: async (slug, dest) => {
    await api.setFolder(slug, dest)
    await get().refresh()
  }
}))

/** Дерево папок: явные + выведенные из записей + все предки. */
export function folderPaths(projects: ProjectMeta[], folderList: string[]): string[] {
  const all = new Set<string>(folderList)
  for (const p of projects) if (p.folder) all.add(p.folder)
  return [...ancestorPaths([...all])]
}

export function folderTree(projects: ProjectMeta[], folderList: string[]) {
  return buildFolderTree(folderPaths(projects, folderList))
}

export function folderCount(projects: ProjectMeta[], path: string): number {
  return projects.filter((p) => {
    const f = p.folder ?? ''
    return f === path || f.startsWith(path + '/')
  }).length
}

/** Тип данных при перетаскивании карточки записи (на папку в боковом меню). */
export const SLUG_TYPE = 'text/slovo-slug'
