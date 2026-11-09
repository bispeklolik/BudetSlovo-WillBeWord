import { useState } from 'react'
import {
  AudioLines,
  BookText,
  FolderOpen,
  House,
  MessageCircleQuestion,
  Mic,
  NotebookText,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Plus,
  Settings,
  SlidersHorizontal
} from 'lucide-react'
import { useLibrary, useChecklist, folderTree, folderCount, SLUG_TYPE } from '../library'
import { doneCount } from '../../../shared/setupChecklist'
import AddMenu from './AddMenu'
import FolderTree from './FolderTree'
import InputModal from './InputModal'
import Tip from './Tip'

// Боковое меню (вариант B): сверху две закреплённые кнопки, затем группа
// «Записи» (главная, записи с деревом папок, конспекты, спросить) и группа
// «Диктовка». Внизу — настройки. 232 px, сворачивается в рейку 56 px.

export type NavPage = 'home' | 'library' | 'notes' | 'dictation' | 'settings'

function NavItem({
  icon,
  label,
  active,
  collapsed,
  count,
  onClick,
  testid
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  collapsed: boolean
  count?: number
  onClick: () => void
  testid?: string
}): React.JSX.Element {
  return (
    <Tip label={label} side="right" disabled={!collapsed}>
      <button
        className={'nav-item' + (active ? ' is-active' : '')}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        onClick={onClick}
        data-testid={testid}
      >
        <span className="nav-ico" aria-hidden="true">
          {icon}
        </span>
        <span className="nav-label">{label}</span>
        {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
      </button>
    </Tip>
  )
}

export default function AppSidebar({
  page,
  collapsed,
  onToggleCollapsed,
  onNavigate,
  onRecordCall,
  onImport,
  importBusy,
  onAdd,
  onAsk,
  onVocab,
  onSettings
}: {
  page: NavPage
  collapsed: boolean
  onToggleCollapsed: () => void
  onNavigate: (p: NavPage) => void
  onRecordCall: () => void
  onImport: () => void
  importBusy: string | null
  onAdd: (kind: 'phone' | 'link' | 'watch') => void
  onAsk: () => void
  onVocab: (tab: 'words' | 'modes') => void
  onSettings: () => void
}): React.JSX.Element {
  const projects = useLibrary((s) => s.projects)
  const folderList = useLibrary((s) => s.folderList)
  const folder = useLibrary((s) => s.folder)
  const notesCount = useLibrary((s) => s.notesCount)
  const setFolder = useLibrary((s) => s.setFolder)
  const createFolder = useLibrary((s) => s.createFolder)
  const renameFolder = useLibrary((s) => s.renameFolder)
  const deleteFolder = useLibrary((s) => s.deleteFolder)
  const moveRecord = useLibrary((s) => s.moveRecord)

  const [dropKey, setDropKey] = useState<string | null>(null)
  const [modal, setModal] = useState<{ kind: 'create' } | { kind: 'rename'; path: string } | null>(
    null
  )

  const list = projects ?? []
  const tree = folderTree(list, folderList)

  const allowDrop = (e: React.DragEvent, key: string): void => {
    if (e.dataTransfer.types.includes(SLUG_TYPE)) {
      e.preventDefault()
      if (dropKey !== key) setDropKey(key)
    }
  }
  const dropRecord = (e: React.DragEvent, dest: string): void => {
    e.preventDefault()
    setDropKey(null)
    const slug = e.dataTransfer.getData(SLUG_TYPE)
    if (slug) {
      const cur = list.find((p) => p.slug === slug)
      if (cur && (cur.folder ?? '') !== dest) void moveRecord(slug, dest)
    }
  }

  const checklist = useChecklist()
  const setupDone = checklist ? doneCount(checklist) : 0
  const setupTotal = checklist?.length ?? 0

  const folderTitle = folder === '' ? '' : folder.split('/').pop()

  return (
    <aside className={'app-sidebar' + (collapsed ? ' is-collapsed' : '')} aria-label="Меню">
      <div className="sb-head">
        <span className="sb-brand">
          <span className="app-logo" aria-hidden="true">
            <AudioLines size={17} />
          </span>
          <span className="sb-title">Слово</span>
        </span>
        <Tip label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} side="right">
          <button
            className="btn-icon sb-toggle"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
            data-testid="sidebar-toggle"
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </Tip>
      </div>

      <div className="sb-pinned">
        <Tip label="Записать звонок" side="right" disabled={!collapsed}>
          <button
            className="sb-btn sb-btn-primary"
            onClick={onRecordCall}
            aria-label="Записать звонок"
            data-testid="sidebar-call"
          >
            <Phone size={16} aria-hidden="true" />
            <span className="sb-btn-label">Записать звонок</span>
          </button>
        </Tip>
        <AddMenu
          onFile={onImport}
          onPhone={() => onAdd('phone')}
          onLink={() => onAdd('link')}
          onWatch={() => onAdd('watch')}
          side="right"
          align="start"
          trigger={
            <button
              className="sb-btn"
              aria-label="Добавить запись"
              disabled={importBusy !== null}
              data-testid="sidebar-add"
            >
              <Plus size={16} aria-hidden="true" />
              <span className="sb-btn-label">{importBusy ?? 'Добавить запись'}</span>
            </button>
          }
        />
      </div>

      <nav className="sb-nav" aria-label="Разделы">
        <NavItem
          icon={<House size={18} />}
          label="Главная"
          active={page === 'home'}
          collapsed={collapsed}
          onClick={() => onNavigate('home')}
          testid="nav-home"
        />
        <NavItem
          icon={<FolderOpen size={18} />}
          label="Записи"
          active={page === 'library'}
          collapsed={collapsed}
          onClick={() => {
            setFolder('')
            onNavigate('library')
            // В свёрнутом меню папок нет — разворачиваем, чтобы их было видно (ревью волны 7).
            if (collapsed) onToggleCollapsed()
          }}
          testid="nav-library"
        />
        {!collapsed && (
          <FolderTree
            tree={tree}
            selected={folder}
            active={page === 'library'}
            totalCount={list.length}
            count={(p) => folderCount(list, p)}
            dropKey={dropKey}
            onSelect={(p) => {
              setFolder(p)
              onNavigate('library')
            }}
            onCreateFolder={() => setModal({ kind: 'create' })}
            onRenameFolder={(path) => setModal({ kind: 'rename', path })}
            onDeleteFolder={deleteFolder}
            onAllowDrop={allowDrop}
            onDragLeave={() => setDropKey(null)}
            onDropRecord={dropRecord}
          />
        )}
        <NavItem
          icon={<NotebookText size={18} />}
          label="Конспекты"
          active={page === 'notes'}
          collapsed={collapsed}
          count={notesCount}
          onClick={() => onNavigate('notes')}
          testid="nav-notes"
        />
        <NavItem
          icon={<MessageCircleQuestion size={18} />}
          label="Спросить"
          collapsed={collapsed}
          onClick={onAsk}
          testid="nav-ask"
        />

        <div className="sb-group" role="presentation">
          <span>Диктовка</span>
        </div>
        <NavItem
          icon={<Mic size={18} />}
          label="Диктовка"
          active={page === 'dictation'}
          collapsed={collapsed}
          onClick={() => onNavigate('dictation')}
          testid="nav-dictation"
        />
        <NavItem
          icon={<BookText size={18} />}
          label="Словарь"
          collapsed={collapsed}
          onClick={() => onVocab('words')}
          testid="nav-vocab"
        />
        <NavItem
          icon={<SlidersHorizontal size={18} />}
          label="Режимы"
          collapsed={collapsed}
          onClick={() => onVocab('modes')}
          testid="nav-modes"
        />
      </nav>

      <div className="sb-foot">
        {checklist && setupDone < setupTotal && (
          <Tip label={`Настройка: ${setupDone} из ${setupTotal}`} side="right" disabled={!collapsed}>
            <button
              className="sb-setup"
              onClick={() => onNavigate('home')}
              aria-label={`Настройка: ${setupDone} из ${setupTotal}. Открыть главную`}
              data-testid="sidebar-setup"
            >
              <span className="sb-setup-text">
                Настройка: {setupDone} из {setupTotal}
              </span>
              <span className="sb-setup-count" aria-hidden="true">
                {setupDone}/{setupTotal}
              </span>
              <span className="sb-setup-track" aria-hidden="true">
                <span className="sb-setup-fill" style={{ width: `${(setupDone / setupTotal) * 100}%` }} />
              </span>
            </button>
          </Tip>
        )}
        <NavItem
          icon={<Settings size={18} />}
          label="Настройки"
          active={page === 'settings'}
          collapsed={collapsed}
          onClick={onSettings}
          testid="settings-btn"
        />
      </div>

      {modal?.kind === 'create' && (
        <InputModal
          title="Новая папка"
          label={folderTitle ? `Внутри «${folderTitle}»` : 'В корне'}
          placeholder="Название папки"
          submitLabel="Создать"
          onSubmit={(name) => {
            createFolder(name)
            setModal(null)
            onNavigate('library')
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'rename' && (
        <InputModal
          title="Переименовать папку"
          initial={modal.path.split('/').pop()}
          submitLabel="Сохранить"
          onSubmit={(n) => {
            void renameFolder(modal.path, n)
            setModal(null)
          }}
          onClose={() => setModal(null)}
        />
      )}
    </aside>
  )
}
