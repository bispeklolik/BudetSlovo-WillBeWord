import { create } from 'zustand'
import { useMemo } from 'react'
import type { ProjectMeta, JobInfo, Settings } from '../../shared/types'
import type { DictationStats } from '../../shared/dictStats'
import { buildChecklist, type ChecklistItem } from '../../shared/setupChecklist'
import { buildFolderTree, ancestorPaths } from '../../shared/folders'
import { api } from './api'
import { showToast, humanError } from './toast'

// Общее состояние библиотеки: им пользуются боковое меню (дерево папок),
// страница «Записи» и «Главная». Раньше всё это жило внутри Home.tsx.

/** Факты для чек-листа и сводки: настройки, статистика диктовки, что установлено. */
export interface SetupFacts {
  settings: Settings
  stats: DictationStats
  localSttInstalled: boolean
  localAiInstalled: boolean
}

interface LibraryState {
  /** null — ещё не загружено. Обновляется при смене страницы, после диктовки и закрытия настроек. */
  setup: SetupFacts | null
  refreshSetup: () => Promise<void>
  /** null — список ещё не пришёл (показываем скелетон, а не «Добро пожаловать»). */
  projects: ProjectMeta[] | null
  error: string | null
  folderList: string[]
  /** Выбранная папка: '' — все записи, иначе путь. */
  folder: string
  notesCount: number
  /** Очередь расшифровок — общая для всех страниц (ревью волны 7). */
  jobs: JobInfo[]
  /** Подписаться на очередь; вернуть отписку. Вызывается один раз в App. */
  watchJobs: () => () => void
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
  setup: null,
  refreshSetup: async () => {
    try {
      const [settings, stats, info] = await Promise.all([api.getSettings(), api.dictStats(), api.setupInfo()])
      // Локальный ИИ спрашиваем тихо (Ollama не запускаем) и только если ключей нет.
      let localAiInstalled = false
      if (!settings.anthropicKey?.trim() && !settings.openrouterKey?.trim()) {
        const o = await api.ollamaStatus(true).catch(() => null)
        localAiInstalled = !!o && o.installed && o.models.length > 0
      }
      set({ setup: { settings, stats, localSttInstalled: info.engine.installed, localAiInstalled } })
    } catch {
      /* прежние данные остаются */
    }
  },
  projects: null,
  error: null,
  folderList: [],
  folder: '',
  notesCount: 0,
  jobs: [],

  watchJobs: () => {
    api
      .listJobs()
      .then((jobs) => set({ jobs }))
      .catch(() => {})
    return api.onJobUpdate((j) => {
      const prev = get().jobs
      const i = prev.findIndex((x) => x.id === j.id)
      set({ jobs: i >= 0 ? [...prev.slice(0, i), { ...j }, ...prev.slice(i + 1)] : [...prev, { ...j }] })
      if (j.status === 'done') void get().refresh()
    })
  },

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

/** Чек-лист «Настройка»: null, пока данные не пришли. */
export function useChecklist(): ChecklistItem[] | null {
  const setup = useLibrary((s) => s.setup)
  const projects = useLibrary((s) => s.projects)
  return useMemo(() => {
    if (!setup || !projects) return null
    return buildChecklist({
      settings: setup.settings,
      localSttInstalled: setup.localSttInstalled,
      localAiInstalled: setup.localAiInstalled,
      dictations: setup.stats.total,
      ownRecords: projects.filter((p) => !p.demo).length
    })
  }, [setup, projects])
}
