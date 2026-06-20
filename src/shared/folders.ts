export interface FolderNode {
  name: string // имя сегмента («Ева»)
  path: string // полный путь («Консультации/Ева»)
  children: FolderNode[]
}

// Строит дерево папок из списка путей. Промежуточные узлы создаются автоматически
// (путь «Консультации/Ева» создаёт и «Консультации»). Дети сортируются по алфавиту.
export function buildFolderTree(paths: string[]): FolderNode[] {
  const root: FolderNode = { name: '', path: '', children: [] }
  for (const p of paths) {
    if (!p) continue
    let node = root
    let acc = ''
    for (const seg of p.split('/').filter(Boolean)) {
      acc = acc ? acc + '/' + seg : seg
      let child = node.children.find((c) => c.name === seg)
      if (!child) {
        child = { name: seg, path: acc, children: [] }
        node.children.push(child)
      }
      node = child
    }
  }
  const sortRec = (n: FolderNode): void => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    n.children.forEach(sortRec)
  }
  sortRec(root)
  return root.children
}

// Все пути-предки для набора путей (для подсчёта/проверок).
export function ancestorPaths(paths: string[]): Set<string> {
  const out = new Set<string>()
  for (const p of paths) {
    if (!p) continue
    const segs = p.split('/').filter(Boolean)
    let acc = ''
    for (const seg of segs) {
      acc = acc ? acc + '/' + seg : seg
      out.add(acc)
    }
  }
  return out
}
