import { describe, it, expect } from 'vitest'
import { buildFolderTree, ancestorPaths } from './folders'

describe('buildFolderTree', () => {
  it('строит вложенное дерево и создаёт промежуточные узлы', () => {
    const tree = buildFolderTree(['Консультации/Ева', 'Консультации/Семён', 'Видео'])
    expect(tree.map((n) => n.name)).toEqual(['Видео', 'Консультации'])
    const kons = tree.find((n) => n.name === 'Консультации')!
    expect(kons.path).toBe('Консультации')
    expect(kons.children.map((c) => c.name)).toEqual(['Ева', 'Семён'])
    expect(kons.children[0].path).toBe('Консультации/Ева')
  })

  it('пустые и дублирующиеся пути не ломают дерево', () => {
    const tree = buildFolderTree(['', 'Видео', 'Видео'])
    expect(tree.map((n) => n.name)).toEqual(['Видео'])
  })

  it('путь только из глубокого узла создаёт всю цепочку', () => {
    const tree = buildFolderTree(['Работа/Проект/Этап'])
    expect(tree[0].name).toBe('Работа')
    expect(tree[0].children[0].name).toBe('Проект')
    expect(tree[0].children[0].children[0].path).toBe('Работа/Проект/Этап')
  })
})

describe('ancestorPaths', () => {
  it('возвращает все пути-предки', () => {
    expect([...ancestorPaths(['Консультации/Ева'])].sort()).toEqual([
      'Консультации',
      'Консультации/Ева'
    ])
  })
})
