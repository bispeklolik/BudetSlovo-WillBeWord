import { describe, it, expect } from 'vitest'
import { parseMicUsers, friendlyApp, CallDetector, MIC_USERS_PS } from './callDetect'

const BOOT = 134361870655000000n
const FRESH = 134361900000000000n
const STALE = 133910998311158820n

const sample = [
  'BOOT\t' + BOOT,
  'ACTIVE\tN\tC:#Users#New#AppData#Local#Discord#app-1.0.9190#Discord.exe\t' + STALE,
  'ACTIVE\tN\tC:#Users#New#AppData#Roaming#Telegram Desktop#Telegram.exe\t' + FRESH,
  'ACTIVE\tP\tMSTeams_8wekyb3d8bbwe\t' + FRESH
].join('\r\n')

describe('MIC_USERS_PS', () => {
  it('только ASCII (уходит в -Command)', () => {
    expect(/^[\x20-\x7e]*$/.test(MIC_USERS_PS)).toBe(true)
  })
})

describe('parseMicUsers', () => {
  it('разбирает BOOT, P и N, декодирует # в \\', () => {
    const r = parseMicUsers(sample)
    expect(r.bootTicks).toBe(BOOT)
    expect(r.users).toHaveLength(2)
    expect(r.users[0].packaged).toBe(false)
    expect(r.users[0].path).toBe('C:\\Users\\New\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe')
    expect(r.users[0].key).toBe(r.users[0].path + '|' + FRESH)
    expect(r.users[1].packaged).toBe(true)
    expect(r.users[1].path).toBe('MSTeams_8wekyb3d8bbwe')
    expect(r.users[1].startTicks).toBe(FRESH)
  })
  it('отбрасывает устаревшие записи (старт раньше загрузки)', () => {
    const r = parseMicUsers(sample)
    expect(r.users.some((u) => u.path.includes('Discord'))).toBe(false)
  })
  it('без BOOT ничего не отбрасывает; мусор и пустой ввод не падают', () => {
    expect(parseMicUsers('').users).toEqual([])
    expect(parseMicUsers('').bootTicks).toBeNull()
    const r = parseMicUsers('ACTIVE\tN\tC:#a#b.exe\t5\nмусор\nACTIVE\tN\tx\tabc')
    expect(r.bootTicks).toBeNull()
    expect(r.users).toHaveLength(1)
  })
})

describe('friendlyApp', () => {
  it('известные приложения по имени exe, с папками версий', () => {
    expect(friendlyApp('C:\\Users\\New\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe', false)).toEqual({
      id: 'telegram',
      name: 'Telegram'
    })
    expect(friendlyApp('C:\\Users\\x\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe', false)?.id).toBe('zoom')
    expect(friendlyApp('C:\\Users\\x\\AppData\\Local\\Discord\\app-1.0.9190\\Discord.exe', false)?.name).toBe('Discord')
    expect(friendlyApp('C:\\Program Files\\Viber\\Viber.exe', false)?.id).toBe('viber')
    expect(friendlyApp('C:\\x\\Skype.exe', false)?.id).toBe('skype')
    expect(friendlyApp('C:\\x\\Telemost\\Telemost.exe', false)).toEqual({ id: 'telemost', name: 'Яндекс Телемост' })
    expect(friendlyApp('C:\\x\\ms-teams.exe', false)?.id).toBe('teams')
    expect(friendlyApp('C:\\x\\WhatsApp.exe', false)?.id).toBe('whatsapp')
  })
  it('упакованные приложения по имени пакета', () => {
    expect(friendlyApp('MSTeams_8wekyb3d8bbwe', true)?.id).toBe('teams')
    expect(friendlyApp('5319275A.WhatsAppDesktop_cv1g1gvanyjgm', true)?.id).toBe('whatsapp')
    expect(friendlyApp('Microsoft.SkypeApp_kzf8qxf38zg5c', true)?.id).toBe('skype')
    expect(friendlyApp('ZoomVideoCommunications.Zoom_abc', true)?.id).toBe('zoom')
  })
  it('браузеры; browser.exe только Яндекс', () => {
    const b = { id: 'browser', name: 'браузере' }
    expect(friendlyApp('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', false)).toEqual(b)
    expect(friendlyApp('C:\\x\\msedge.exe', false)).toEqual(b)
    expect(friendlyApp('C:\\x\\Firefox.exe', false)).toEqual(b)
    expect(friendlyApp('C:\\x\\opera.exe', false)).toEqual(b)
    expect(friendlyApp('C:\\x\\brave.exe', false)).toEqual(b)
    expect(friendlyApp('C:\\Users\\x\\AppData\\Local\\Yandex\\YandexBrowser\\Application\\browser.exe', false)).toEqual(b)
    expect(friendlyApp('C:\\Other\\browser.exe', false)).toBeNull()
  })
  it('прочее игнорируется', () => {
    expect(friendlyApp('C:\\Program Files\\obs-studio\\bin\\obs64.exe', false)).toBeNull()
    expect(friendlyApp('Some.Package_123', true)).toBeNull()
  })
})

describe('CallDetector', () => {
  const tg = (start = 1n) => ({
    key: 'C:\\t\\Telegram.exe|' + start,
    path: 'C:\\t\\Telegram.exe',
    packaged: false,
    startTicks: start
  })
  const mk = (over: Partial<ConstructorParameters<typeof CallDetector>[0]> = {}) =>
    new CallDetector({ debounceMs: 3000, snoozeMs: 60000, isOwn: () => false, isMuted: () => false, ...over })

  it('ждёт debounce, потом даёт подсказку', () => {
    const d = mk()
    expect(d.update([tg()], 0)).toBeNull()
    expect(d.update([tg()], 2999)).toBeNull()
    expect(d.update([tg()], 3000)).toEqual({ appId: 'telegram', name: 'Telegram', key: 'C:\\t\\Telegram.exe|1' })
  })
  it('сбрасывает отсчёт, если запись пропала', () => {
    const d = mk()
    d.update([tg()], 0)
    d.update([], 2000)
    expect(d.update([tg()], 3500)).toBeNull()
    expect(d.update([tg()], 6500)).not.toBeNull()
  })
  it('один ключ - одна подсказка; новый звонок (новый ключ) - снова', () => {
    const d = mk()
    d.update([tg()], 0)
    expect(d.update([tg()], 3000)).not.toBeNull()
    expect(d.update([tg()], 4000)).toBeNull()
    d.update([tg(2n)], 5000)
    expect(d.update([tg(2n)], 8000)).not.toBeNull()
  })
  it('игнорирует свои пути, неизвестные и заглушённые приложения', () => {
    const own = mk({ isOwn: (p) => p.includes('Telegram') })
    own.update([tg()], 0)
    expect(own.update([tg()], 5000)).toBeNull()
    const muted = mk({ isMuted: (id) => id === 'telegram' })
    muted.update([tg()], 0)
    expect(muted.update([tg()], 5000)).toBeNull()
    const obs = { key: 'o|1', path: 'C:\\obs64.exe', packaged: false, startTicks: 1n }
    const d = mk()
    d.update([obs], 0)
    expect(d.update([obs], 5000)).toBeNull()
  })
  it('из нескольких подходящих возвращает первую', () => {
    const z = { key: 'z|1', path: 'C:\\Zoom.exe', packaged: false, startTicks: 1n }
    const d = mk()
    d.update([tg(), z], 0)
    expect(d.update([tg(), z], 3000)?.appId).toBe('telegram')
  })
  it('snooze блокирует подсказки до now + snoozeMs', () => {
    const d = mk()
    d.update([tg()], 0)
    d.snooze(1000)
    expect(d.update([tg()], 5000)).toBeNull()
    expect(d.update([tg()], 60999)).toBeNull()
    expect(d.update([tg()], 61000)).not.toBeNull()
  })
})
