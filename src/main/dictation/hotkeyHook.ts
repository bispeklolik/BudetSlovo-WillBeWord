import { EventEmitter } from 'events'
import { spawn, type ChildProcess } from 'child_process'

// Глобальная клавиша диктовки БЕЗ нативных модулей: дочерний PowerShell
// опрашивает клавишу через WinAPI GetAsyncKeyState (~66 Гц, незаметно для CPU)
// и печатает DOWN/UP. Нативный uiohook-napi фатально падал внутри Electron
// (napi_define_properties) — поймано живым прогоном; globalShortcut не видит
// отпускание клавиши, поэтому push-to-talk без опроса невозможен.
//
// Жесты (тайминги — из разбора OpenWhispr):
//  - зажатие ≥150 мс  → 'push-start' … отпустил → 'push-stop'
//  - короткий тап ×2 за 400 мс → 'toggle-start'; следующий тап → 'toggle-stop'

const HOLD_MS = 150
const DOUBLE_TAP_MS = 400

// Имена в стиле e.code → Windows virtual-key коды.
const KEYMAP: Record<string, number> = {
  F6: 0x75,
  F7: 0x76,
  F8: 0x77,
  F9: 0x78,
  F10: 0x79,
  F12: 0x7b,
  Pause: 0x13,
  ScrollLock: 0x91,
  Insert: 0x2d,
  Home: 0x24,
  End: 0x23,
  ControlRight: 0xa3,
  AltRight: 0xa5,
  ShiftRight: 0xa1,
  MetaRight: 0x5c,
  CapsLock: 0x14,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d
}

export const HOTKEY_CHOICES = Object.keys(KEYMAP)

// ASCII-only скрипт (PS 5.1 читает инлайн как есть; кириллицы избегаем).
const PS_POLLER = (vk: number): string =>
  `
$sig = '[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);'
Add-Type -MemberDefinition $sig -Name KeyPoll -Namespace Win32
$down = $false
[Console]::Out.WriteLine('READY')
while ($true) {
  $s = ([Win32.KeyPoll]::GetAsyncKeyState(${vk}) -band 0x8000) -ne 0
  if ($s -ne $down) {
    $down = $s
    if ($s) { [Console]::Out.WriteLine('DOWN') } else { [Console]::Out.WriteLine('UP') }
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds 15
}
`.trim()

class HotkeyHook extends EventEmitter {
  private vk: number | null = null
  private proc: ChildProcess | null = null
  private downTime = 0
  private lastTap = 0
  private holdTimer: NodeJS.Timeout | null = null
  private mode: 'idle' | 'push' | 'toggle' = 'idle'

  setHotkey(name: string): boolean {
    const code = KEYMAP[name]
    if (!code) return false
    this.vk = code
    return true
  }

  private onDown(): void {
    this.downTime = Date.now()
    if (this.mode === 'toggle') {
      // любое нажатие во время hands-free записи = стоп
      this.mode = 'idle'
      this.emit('toggle-stop')
      return
    }
    if (this.mode === 'push') return
    const token = this.downTime
    this.holdTimer = setTimeout(() => {
      if (this.downTime !== token) return
      this.mode = 'push'
      this.emit('push-start')
    }, HOLD_MS)
  }

  private onUp(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer)
      this.holdTimer = null
    }
    const held = Date.now() - this.downTime
    if (this.mode === 'push') {
      this.mode = 'idle'
      this.emit('push-stop')
      return
    }
    if (this.mode === 'idle' && held < HOLD_MS) {
      const now = Date.now()
      if (now - this.lastTap <= DOUBLE_TAP_MS) {
        this.lastTap = 0
        this.mode = 'toggle'
        this.emit('toggle-start')
      } else {
        this.lastTap = now
      }
    }
  }

  start(): void {
    if (this.proc || this.vk === null) return
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_POLLER(this.vk)], {
      windowsHide: true
    })
    this.proc = p
    let buf = ''
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (chunk: string) => {
      buf += chunk
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (line === 'DOWN') this.onDown()
        else if (line === 'UP') this.onUp()
      }
    })
    p.on('close', () => {
      if (this.proc === p) this.proc = null
    })
  }

  stop(): void {
    this.mode = 'idle'
    if (this.holdTimer) clearTimeout(this.holdTimer)
    this.proc?.kill()
    this.proc = null
  }

  /** Принудительно вернуть в idle (после ошибки/отмены записи). */
  reset(): void {
    this.mode = 'idle'
  }
}

export const hotkeyHook = new HotkeyHook()
