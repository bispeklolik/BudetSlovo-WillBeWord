// Детектор «идёт звонок»: смотрим, какие приложения прямо сейчас держат
// микрофон (реестр приватности Windows). Чистая логика без Node/Electron —
// сам скрипт запускает main, сюда приходит только его вывод.

// ASCII-only PowerShell 5.1 (идёт через -Command). Печатает BOOT и по строке
// ACTIVE на приложение, у которого LastUsedTimeStop == 0 (микрофон занят сейчас).
// Ошибки глушим: отсутствие ключей - не повод падать.
export const MIC_USERS_PS =
  "$ErrorActionPreference='SilentlyContinue'; $t=[char]9; " +
  '$b=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToFileTimeUtc(); ' +
  "Write-Output ('BOOT'+$t+$b); " +
  "$r='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'; " +
  'foreach($k in @(Get-ChildItem -LiteralPath $r)){ ' +
  "if($k.PSChildName -eq 'NonPackaged'){ " +
  'foreach($c in @(Get-ChildItem -LiteralPath $k.PSPath)){ ' +
  "$a=$c.GetValue('LastUsedTimeStart'); $o=$c.GetValue('LastUsedTimeStop'); " +
  // Программа должна быть ЗАПУЩЕНА: с «быстрым запуском» Windows время загрузки
  // не обновляется неделями, и запись упавшей программы (Stop==0) иначе выглядела
  // бы идущим звонком при каждом старте «Слова» (ревью волны 3).
  "if($a -gt 0 -and $o -eq 0){ $n=[IO.Path]::GetFileNameWithoutExtension(($c.PSChildName -replace '#','\\')); " +
  "if(Get-Process -Name $n){ Write-Output ('ACTIVE'+$t+'N'+$t+$c.PSChildName+$t+$a) } } } } " +
  "else { $a=$k.GetValue('LastUsedTimeStart'); $o=$k.GetValue('LastUsedTimeStop'); " +
  "if($a -gt 0 -and $o -eq 0){ Write-Output ('ACTIVE'+$t+'P'+$t+$k.PSChildName+$t+$a) } } }"

export interface MicUser {
  key: string
  path: string
  packaged: boolean
  startTicks: bigint
}

export interface MicSnapshot {
  bootTicks: bigint | null
  users: MicUser[]
}

function toBig(s: string): bigint | null {
  return /^\d+$/.test(s) ? BigInt(s) : null
}

export function parseMicUsers(out: string): MicSnapshot {
  let bootTicks: bigint | null = null
  const raw: MicUser[] = []
  for (const line of out.split(/\r?\n/)) {
    const f = line.split('\t')
    if (f[0] === 'BOOT' && f.length >= 2) {
      bootTicks = toBig(f[1].trim())
    } else if (f[0] === 'ACTIVE' && f.length >= 4) {
      const start = toBig(f[3].trim())
      if (start === null || (f[1] !== 'P' && f[1] !== 'N')) continue
      const packaged = f[1] === 'P'
      // В реестре '\' заменён на '#', возвращаем обратно
      const path = packaged ? f[2] : f[2].replace(/#/g, '\\')
      raw.push({ key: path + '|' + start, path, packaged, startTicks: start })
    }
  }
  // Запись со стартом раньше загрузки ОС - «зависшая» (приложение упало, не
  // записав Stop; Discord так висел месяцами), это не текущий звонок.
  const boot = bootTicks
  return { bootTicks, users: boot === null ? raw : raw.filter((u) => u.startTicks >= boot) }
}

export interface FriendlyApp {
  id: string
  name: string
}

const BROWSER: FriendlyApp = { id: 'browser', name: 'браузере' }

export function friendlyApp(path: string, packaged: boolean): FriendlyApp | null {
  const full = path.toLowerCase()
  if (packaged) {
    if (full.includes('zoom')) return { id: 'zoom', name: 'Zoom' }
    if (full.startsWith('msteams_')) return { id: 'teams', name: 'Microsoft Teams' }
    if (full.includes('whatsappdesktop')) return { id: 'whatsapp', name: 'WhatsApp' }
    if (full.startsWith('microsoft.skypeapp')) return { id: 'skype', name: 'Skype' }
    return null
  }
  // По имени файла: перед ним бывают папки версий (app-1.0.9190)
  const base = full.split(/[\\/]/).pop() ?? ''
  switch (base) {
    case 'telegram.exe':
      return { id: 'telegram', name: 'Telegram' }
    case 'zoom.exe':
      return { id: 'zoom', name: 'Zoom' }
    case 'ms-teams.exe':
    case 'teams.exe':
      return { id: 'teams', name: 'Microsoft Teams' }
    case 'whatsapp.exe':
      return { id: 'whatsapp', name: 'WhatsApp' }
    case 'skype.exe':
      return { id: 'skype', name: 'Skype' }
    case 'discord.exe':
      return { id: 'discord', name: 'Discord' }
    case 'viber.exe':
      return { id: 'viber', name: 'Viber' }
    case 'chrome.exe':
    case 'msedge.exe':
    case 'firefox.exe':
    case 'opera.exe':
    case 'brave.exe':
      return BROWSER
    case 'browser.exe':
      // Просто browser.exe встречается у чего угодно; берём только Яндекс
      return full.includes('\\yandex\\') ? BROWSER : null
  }
  if (base.includes('telemost')) return { id: 'telemost', name: 'Яндекс Телемост' }
  return null
}

export interface CallDetectorOpts {
  debounceMs: number
  snoozeMs: number
  isOwn: (path: string) => boolean
  isMuted: (appId: string) => boolean
}

export interface CallPrompt {
  appId: string
  name: string
  key: string
}

export class CallDetector {
  private firstSeen = new Map<string, number>()
  private prompted = new Set<string>()
  private snoozeUntil = -Infinity

  constructor(private opts: CallDetectorOpts) {}

  update(users: MicUser[], nowMs: number): CallPrompt | null {
    const present = new Set<string>()
    let result: CallPrompt | null = null
    for (const u of users) {
      if (this.opts.isOwn(u.path)) continue
      const app = friendlyApp(u.path, u.packaged)
      if (!app || this.opts.isMuted(app.id)) continue
      present.add(u.key)
      if (!this.firstSeen.has(u.key)) this.firstSeen.set(u.key, nowMs)
      if (result || this.prompted.has(u.key) || nowMs < this.snoozeUntil) continue
      // Короткий всплеск микрофона (не звонок) отсекаем выдержкой
      if (nowMs - (this.firstSeen.get(u.key) as number) >= this.opts.debounceMs) {
        this.prompted.add(u.key)
        result = { appId: app.id, name: app.name, key: u.key }
      }
    }
    // Пропавшие записи забываем: вернётся - отсчёт с нуля
    for (const k of [...this.firstSeen.keys()]) if (!present.has(k)) this.firstSeen.delete(k)
    return result
  }

  snooze(nowMs: number): void {
    this.snoozeUntil = nowMs + this.opts.snoozeMs
  }
}
