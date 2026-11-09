import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderPlus, Pencil, X } from 'lucide-react'
import type { FolderNode } from '../../../shared/folders'
import { onActivate } from '../activate'

// Дерево папок в боковом меню под пунктом «Записи» (раньше — отдельная колонка
// главной страницы). Перетаскивание карточки на папку, переименование,
// удаление и создание папки работают как раньше.

interface FolderTreeProps {
  tree: FolderNode[]
  selected: string // '' = «Все записи»
  active: boolean // открыта ли сейчас страница «Записи»
  totalCount: number
  count: (path: string) => number
  dropKey: string | null
  onSelect: (path: string) => void
  onCreateFolder: () => void
  onRenameFolder: (path: string) => void
  onDeleteFolder: (path: string) => void
  onAllowDrop: (e: React.DragEvent, key: string) => void
  onDragLeave: () => void
  onDropRecord: (e: React.DragEvent, path: string) => void
}

export default function FolderTree(props: FolderTreeProps): React.JSX.Element {
  const { tree, selected, active, dropKey } = props
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (path: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const renderNode = (node: FolderNode, depth: number): React.JSX.Element => {
    const open = !collapsed.has(node.path)
    const hasKids = node.children.length > 0
    return (
      <div key={node.path}>
        <div
          className={
            'tree-row' +
            (active && selected === node.path ? ' is-selected' : '') +
            (dropKey === node.path ? ' drop-hover' : '')
          }
          style={{ paddingLeft: 8 + depth * 14 }}
          role="button"
          tabIndex={0}
          onClick={() => props.onSelect(node.path)}
          onKeyDown={onActivate(() => props.onSelect(node.path))}
          onDragOver={(e) => props.onAllowDrop(e, node.path)}
          onDragLeave={props.onDragLeave}
          onDrop={(e) => props.onDropRecord(e, node.path)}
        >
          {hasKids ? (
            <button
              className="tree-toggle"
              aria-label={open ? 'Свернуть папку' : 'Развернуть папку'}
              aria-expanded={open}
              onClick={(e) => {
                e.stopPropagation()
                toggle(node.path)
              }}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="tree-toggle-spacer" />
          )}
          <Folder size={16} />
          <span className="tree-name">{node.name}</span>
          <span className="tree-count">{props.count(node.path)}</span>
          <span className="tree-actions">
            <button
              title="Переименовать папку"
              aria-label="Переименовать папку"
              onClick={(e) => {
                e.stopPropagation()
                props.onRenameFolder(node.path)
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              title="Удалить пустую папку"
              aria-label="Удалить пустую папку"
              onClick={(e) => {
                e.stopPropagation()
                props.onDeleteFolder(node.path)
              }}
            >
              <X size={14} />
            </button>
          </span>
        </div>
        {open && hasKids && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="folder-tree" data-tour="folder-tree">
      <button
        className={
          'tree-row root' +
          (active && selected === '' ? ' is-selected' : '') +
          (dropKey === '' ? ' drop-hover' : '')
        }
        onClick={() => props.onSelect('')}
        onDragOver={(e) => props.onAllowDrop(e, '')}
        onDragLeave={props.onDragLeave}
        onDrop={(e) => props.onDropRecord(e, '')}
      >
        <span className="tree-toggle-spacer" />
        <Folder size={16} />
        <span className="tree-name">Все записи</span>
        <span className="tree-count">{props.totalCount}</span>
      </button>

      <div className="tree-scroll">{tree.map((n) => renderNode(n, 0))}</div>

      <button className="sidebar-add" onClick={props.onCreateFolder}>
        <FolderPlus size={14} /> Новая папка
      </button>
    </div>
  )
}
