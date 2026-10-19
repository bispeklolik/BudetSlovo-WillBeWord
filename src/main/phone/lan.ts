// Приём записи с телефона (волна 5): чистые помощники — адреса компьютера в
// домашней сети и безопасное имя файла. Под тестами.

export interface Iface {
  address: string
  family: string | number
  internal: boolean
}

const rank = (ip: string): number =>
  ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3

/**
 * Адреса IPv4, по которым телефон в той же Wi-Fi сети достучится до компьютера.
 * Домашние сети (192.168.*) — первыми; служебные 169.254.* и петлю — выкидываем.
 */
export function lanAddresses(ifaces: Record<string, Iface[] | undefined>): string[] {
  const out: string[] = []
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      const v4 = i.family === 'IPv4' || i.family === 4
      if (!v4 || i.internal || i.address.startsWith('169.254.') || i.address.startsWith('127.')) continue
      if (!out.includes(i.address)) out.push(i.address)
    }
  }
  return out.sort((a, b) => rank(a) - rank(b))
}

const MEDIA_EXT = /\.(m4a|mp3|wav|aac|ogg|oga|flac|opus|wma|amr|3gp|3ga|mp4|mov|mkv|avi|webm|m4v)$/i

/** Имя файла с телефона → безопасное имя на диске (без путей и служебных знаков). */
export function safeFileName(name: string): string | null {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim().slice(-120)
  if (!base || base.startsWith('.') || !MEDIA_EXT.test(base)) return null
  return base
}

/** Сравнение токена без утечки по времени (на всякий случай: сеть общая). */
export function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
