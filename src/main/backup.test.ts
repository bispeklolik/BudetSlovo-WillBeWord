import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { backupItems, createBackup, restoreBackup } from './backup'

describe('backupItems', () => {
  it('без моделей, движка, профиля браузера и прошлых откатов', () => {
    expect(
      backupItems(['projects', 'notes.json', 'settings.json', 'electron', 'models', 'engine', 'temp', '_before-restore-2026', 'консультации', 'x.tmp'])
    ).toEqual(['projects', 'notes.json', 'settings.json', 'консультации'])
  })
})

describe('createBackup → restoreBackup (настоящий tar.exe)', () => {
  it('туда-обратно: данные вернулись, старые отложены, тяжёлое не попало', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slovo-bk-'))
    const data = join(root, 'data')
    mkdirSync(join(data, 'projects', 'zapis-1'), { recursive: true })
    writeFileSync(join(data, 'projects', 'zapis-1', 'project.json'), '{"title":"Сессия с Евой"}')
    writeFileSync(join(data, 'notes.json'), '[{"title":"конспект"}]')
    writeFileSync(join(data, 'settings.json'), '{"theme":"dark"}')
    mkdirSync(join(data, 'консультации'))
    writeFileSync(join(data, 'консультации', 'заметка.txt'), 'текст')
    mkdirSync(join(data, 'models'))
    writeFileSync(join(data, 'models', 'huge.bin'), 'x'.repeat(1000))

    const zip = join(root, 'Слово-копия.zip')
    const r = await createBackup(data, zip)
    expect(r.items).toBe(4)
    expect(r.bytes).toBeGreaterThan(0)

    // Портим текущие данные — восстановление должно вернуть как было.
    writeFileSync(join(data, 'settings.json'), '{"theme":"light"}')
    rmSync(join(data, 'projects'), { recursive: true })

    const res = await restoreBackup(data, zip)
    expect(res.restored.sort()).toEqual(['notes.json', 'projects', 'settings.json', 'консультации'].sort())
    expect(readFileSync(join(data, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(readFileSync(join(data, 'projects', 'zapis-1', 'project.json'), 'utf8')).toContain('Евой')
    expect(readFileSync(join(data, 'консультации', 'заметка.txt'), 'utf8')).toBe('текст')
    // испорченная версия не пропала — лежит в откате
    expect(readFileSync(join(res.savedTo, 'settings.json'), 'utf8')).toBe('{"theme":"light"}')
    // модели не тронуты и в копию не попадали
    expect(existsSync(join(data, 'models', 'huge.bin'))).toBe(true)
    expect(readdirSync(data).includes('.restore-tmp')).toBe(false)
    rmSync(root, { recursive: true, force: true })
  }, 30000)

  it('чужой архив не восстанавливается', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slovo-bk-'))
    const other = join(root, 'other')
    mkdirSync(other)
    writeFileSync(join(other, 'readme.txt'), 'hi')
    const zip = join(root, 'other.zip')
    await createBackup(other, zip)
    const data = join(root, 'data')
    mkdirSync(data)
    await expect(restoreBackup(data, zip)).rejects.toThrow(/не похоже/)
    rmSync(root, { recursive: true, force: true })
  }, 30000)
})
