import { spawn, type ChildProcess } from 'child_process'
import { basename } from 'path'
import { MIC_USERS_PS, parseMicUsers, CallDetector, type CallPrompt } from '../../shared/callDetect'

// «Похоже, идёт звонок в Telegram — записать?». Windows сама помнит, какая
// программа сейчас держит микрофон (реестр «Конфиденциальность → Микрофон»,
// LastUsedTimeStop == 0). Один долгоживущий PowerShell раз в 4 с печатает список,
// без нативных модулей (как у Vibe: crates/meeting-detect/mic.rs).
// Логика (какие программы — звонки, антидребезг, «один звонок — одна подсказка»)
// в shared/callDetect.ts под тестами.

// UTF-8 на выходе: в путях бывает кириллица (C:\Users\Анна\…).
const LOOP = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; while ($true) { ${MIC_USERS_PS}; [Console]::Out.WriteLine('##END##'); [Console]::Out.Flush(); Start-Sleep -Seconds 4 }`
const MAX_RESTARTS = 5

let proc: ChildProcess | null = null
// Детектор живёт дольше процесса: выключение/включение подсказок посреди звонка
// не должно заново предлагать звонок, от которого уже отказались.
let detector: CallDetector | null = null
let shownKey: string | null = null
let wanted: WatchOpts | null = null
let restarts = 0

export interface WatchOpts {
  isMuted: (appId: string) => boolean
  /** идёт наша запись звонка или диктовка — подсказывать нечего */
  isBusy: () => boolean
  onCall: (p: CallPrompt) => void
  /** звонок, о котором подсказали, закончился — убрать подсказку */
  onGone: () => void
}

function spawnLoop(o: WatchOpts): void {
  const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', LOOP], { windowsHide: true })
  proc = p
  let buf = ''
  p.stdout.setEncoding('utf8')
  p.stdout.on('data', (chunk: string) => {
    restarts = 0 // процесс живой и отвечает
    buf += chunk
    let i: number
    // Маркер, которого не бывает в путях программ.
    while ((i = buf.indexOf('##END##')) >= 0) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 7)
      const snap = parseMicUsers(block)
      if (shownKey && !snap.users.some((u) => u.key === shownKey)) {
        shownKey = null
        o.onGone()
      }
      // Пока идёт наша диктовка или запись, детектор не трогаем: иначе подсказка
      // «сгорала» бы впустую и для этого звонка больше не появилась (ревью волны 3).
      if (o.isBusy()) continue
      const prompt = detector?.update(snap.users, Date.now())
      if (prompt) {
        shownKey = prompt.key
        o.onCall(prompt)
      }
    }
  })
  // Без обработчика ошибка запуска PowerShell (политика, антивирус) роняла бы main.
  p.on('error', (err) => console.error('[calls] watcher', err.message))
  p.on('close', () => {
    if (proc !== p) return
    proc = null
    // Процесс умер сам (антивирус, диспетчер задач) — поднимаем снова, но не бесконечно.
    if (wanted && restarts < MAX_RESTARTS) {
      restarts++
      setTimeout(() => {
        if (wanted && !proc) spawnLoop(wanted)
      }, 5000 * restarts)
    }
  })
}

export function startCallWatcher(o: WatchOpts): void {
  if (proc || process.platform !== 'win32') return
  wanted = o
  const own = basename(process.execPath).toLowerCase()
  detector ??= new CallDetector({
    debounceMs: 10_000, // голосовое сообщение в Telegram короче — его не считаем звонком
    snoozeMs: 5 * 60_000,
    isOwn: (p) => basename(p.replace(/#/g, '\\')).toLowerCase() === own,
    isMuted: (id) => wanted?.isMuted(id) ?? false
  })
  spawnLoop(o)
}

export function stopCallWatcher(): void {
  wanted = null
  const p = proc
  proc = null
  p?.kill()
  if (shownKey) shownKey = null
}

/** Человек закрыл подсказку — не дёргать 5 минут. */
export function snoozeCallPrompts(): void {
  detector?.snooze(Date.now())
}
