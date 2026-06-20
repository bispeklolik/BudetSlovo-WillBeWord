import { useState } from 'react'
import type { FolderNode } from '../../../shared/folders'
import Icon from './Icon'

interface SidebarProps {
  tree: FolderNode[]
  selected: string // '' = «Все записи», '@notes' = Конспекты
  totalCount: number
  notesCount: number
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

export const NOTES_KEY = '@notes'

export default function Sidebar(props: SidebarProps): React.JSX.Element {
  const { tree, selected, dropKey } = props
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
            (selected === node.path ? ' is-selected' : '') +
            (dropKey === node.path ? ' drop-hover' : '')
          }
          style={{ paddingLeft: 8 + depth * 14 }}
          role="button"
          tabIndex={0}
          onClick={() => props.onSelect(node.path)}
          onDragOver={(e) => props.onAllowDrop(e, node.path)}
          onDragLeave={props.onDragLeave}
          onDrop={(e) => props.onDropRecord(e, node.path)}
        >
          {hasKids ? (
            <button
              className="tree-toggle"
              onClick={(e) => {
                e.stopPropagation()
                toggle(node.path)
              }}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="tree-toggle-spacer" />
          )}
          <Icon name="folder" size={16} />
          <span className="tree-name">{node.name}</span>
          <span className="tree-count">{props.count(node.path)}</span>
          <span className="tree-actions">
            <button
              title="Переименовать папку"
              onClick={(e) => {
                e.stopPropagation()
                props.onRenameFolder(node.path)
              }}
            >
              <Icon name="edit" size={14} />
            </button>
            <button
              title="Удалить пустую папку"
              onClick={(e) => {
                e.stopPropagation()
                props.onDeleteFolder(node.path)
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </span>
        </div>
        {open && hasKids && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <button
        className={
          'tree-row root' +
          (selected === '' ? ' is-selected' : '') +
          (dropKey === '' ? ' drop-hover' : '')
        }
        onClick={() => props.onSelect('')}
        onDragOver={(e) => props.onAllowDrop(e, '')}
        onDragLeave={props.onDragLeave}
        onDrop={(e) => props.onDropRecord(e, '')}
      >
        <span className="tree-toggle-spacer" />
        <Icon name="folder" size={16} />
        <span className="tree-name">Все записи</span>
        <span className="tree-count">{props.totalCount}</span>
      </button>

      <div className="tree-scroll">{tree.map((n) => renderNode(n, 0))}</div>

      <button className="sidebar-add" onClick={props.onCreateFolder}>
        + Папка
      </button>

      <button
        className={'tree-row notes' + (selected === NOTES_KEY ? ' is-selected' : '')}
        onClick={() => props.onSelect(NOTES_KEY)}
      >
        <span className="tree-toggle-spacer" />
        <Icon name="sparkles" size={16} />
        <span className="tree-name">Конспекты</span>
        <span className="tree-count">{props.notesCount}</span>
      </button>
    </aside>
  )
}
