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
//  - Shift + зажатие (волна 6) → 'edit-start' … отпустил → 'edit-stop':
//    голосовая правка выделенного текста. Отдельная клавиша опасна: F10 при
//    отпускании открывает меню программы, и вставка ушла бы туда.

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

// Shift + клавиша как сочетание Electron — чтобы «проглотить» его для жеста
// правки. Home/End/Insert не трогаем: Shift+Home/End выделяют текст, Shift+Insert
// вставляет — занимать их во всех программах нельзя. У Pause и клавиш-
// модификаторов сочетания в Electron нет.
const EDIT_ACCEL: Record<string, string> = {
  F6: 'Shift+F6',
  F7: 'Shift+F7',
  F8: 'Shift+F8',
  F9: 'Shift+F9',
  F10: 'Shift+F10',
  F12: 'Shift+F12',
  ScrollLock: 'Shift+Scrolllock',
  NumpadAdd: 'Shift+numadd',
  NumpadSubtract: 'Shift+numsub'
}

export function editComboAccelerator(name: string): string | null {
  return EDIT_ACCEL[name] ?? null
}

// ASCII-only скрипт (PS 5.1 читает инлайн как есть; кириллицы избегаем).
// Опрашивает клавишу; при нажатии печатает, зажат ли Shift, и программу на
// переднем плане: «DOWN <shift 0|1>\t<процесс>\t<заголовок окна>» (UTF-8 —
// заголовки бывают русскими). Только имя и заголовок — никаких снимков экрана.
// [Console]::In.ReadLineAsync в PS 5.1 на деле синхронный (ждал строку и
// вешал опрос) — читаем stdin своим StreamReader.
// По командам из stdin нажимает Ctrl+C / Ctrl+V (дождавшись, пока человек
// отпустит Shift/Ctrl/Alt). COPY отвечает «DONE COPY <буфер изменился 0|1>
// <окно>» — буфер не нужно стирать, чтобы понять, скопировалось ли (ревью
// волны 6: стирание теряло картинки и файлы). «PASTE <окно>» жмёт Ctrl+V,
// только если на переднем плане то же окно, иначе «DONE PASTE SKIP» (ревью:
// пока ИИ думал, человек переключился — вставка ушла бы в чужое окно).
// Закрылся stdin — родитель умер, выходим (без сирот).
const PS_POLLER = (vk: number): string =>
  `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$sig = @'
[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
'@
Add-Type -MemberDefinition $sig -Name KeyPoll -Namespace Win32
function Held($k) { return ([Win32.KeyPoll]::GetAsyncKeyState($k) -band 0x8000) -ne 0 }
function FgInfo {
  try {
    $h = [Win32.KeyPoll]::GetForegroundWindow()
    $procId = [uint32]0
    [void][Win32.KeyPoll]::GetWindowThreadProcessId($h, [ref]$procId)
    $sb = New-Object System.Text.StringBuilder 512
    [void][Win32.KeyPoll]::GetWindowText($h, $sb, 512)
    $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
    $t = ($sb.ToString() -replace '[\\t\\r\\n]', ' ')
    return "$name\`t$t"
  } catch { return "\`t" }
}
function Combo($vk) {
  $w = 0
  while (((Held 0x10) -or (Held 0x11) -or (Held 0x12)) -and $w -lt 66) { Start-Sleep -Milliseconds 15; $w++ }
  [Win32.KeyPoll]::keybd_event(0x11, 0, 0, [System.UIntPtr]::Zero)
  [Win32.KeyPoll]::keybd_event($vk, 0, 0, [System.UIntPtr]::Zero)
  [Win32.KeyPoll]::keybd_event($vk, 0, 2, [System.UIntPtr]::Zero)
  [Win32.KeyPoll]::keybd_event(0x11, 0, 2, [System.UIntPtr]::Zero)
}
$down = $false
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
[Console]::Out.WriteLine('READY')
while ($true) {
  $s = Held ${vk}
  if ($s -ne $down) {
    $down = $s
    if ($s) {
      $sh = [int](${shiftCheck(vk)})
      [Console]::Out.WriteLine("DOWN $sh\`t" + (FgInfo))
    } else { [Console]::Out.WriteLine('UP') }
    [Console]::Out.Flush()
  }
  if ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($cmd -eq $null) { exit }
    $parts = "$cmd".Split(' ')
    if ($parts[0] -eq 'COPY') {
      $seq = [Win32.KeyPoll]::GetClipboardSequenceNumber()
      $hw = [Win32.KeyPoll]::GetForegroundWindow()
      Combo 0x43
      $w = 0
      while ([Win32.KeyPoll]::GetClipboardSequenceNumber() -eq $seq -and $w -lt 66) { Start-Sleep -Milliseconds 15; $w++ }
      $ch = [int]([Win32.KeyPoll]::GetClipboardSequenceNumber() -ne $seq)
      [Console]::Out.WriteLine("DONE COPY $ch $hw")
    } elseif ($parts[0] -eq 'PASTE') {
      $hw = "$([Win32.KeyPoll]::GetForegroundWindow())"
      if ($parts.Count -gt 1 -and $parts[1] -ne $hw) { [Console]::Out.WriteLine('DONE PASTE SKIP') }
      else { Combo 0x56; [Console]::Out.WriteLine('DONE PASTE OK') }
    } else { [Console]::Out.WriteLine("DONE $cmd") }
    [Console]::Out.Flush()
    $pending = $stdin.ReadLineAsync()
  }
  Start-Sleep -Milliseconds 15
}
`.trim()

/**
 * Как узнать «зажат Shift» для жеста правки. Если горячая клавиша сама Shift
 * (правый), смотрим только на другой Shift — иначе любая диктовка правым
 * Shift считалась бы правкой (ревью волны 6).
 */
function shiftCheck(vk: number): string {
  if (vk === 0xa1) return 'Held 0xA0'
  if (vk === 0xa0) return 'Held 0xA1'
  return 'Held 0x10'
}

export interface ComboResult {
  ok: boolean
  /** COPY: буфер обмена изменился (что-то было выделено). */
  changed?: boolean
  /** COPY: окно на переднем плане в момент копирования. */
  hwnd?: string
  /** PASTE: окно сменилось — Ctrl+V не нажимали. */
  skipped?: boolean
}

export interface ForegroundApp {
  proc: string
  title: string
}

// Невидимые символы направления текста (Telegram ставит их в заголовок).
const BIDI = /[‎‏‪-‮⁦-⁩]/g

class HotkeyHook extends EventEmitter {
  private vk: number | null = null
  private proc: ChildProcess | null = null
  private downTime = 0
  private lastTap = 0
  private holdTimer: NodeJS.Timeout | null = null
  private mode: 'idle' | 'push' | 'toggle' | 'edit' = 'idle'
  private waiters: { cmd: string; resolve: (r: ComboResult) => void }[] = []
  /** Программа на переднем плане в момент последнего нажатия. */
  lastApp: ForegroundApp | null = null
  /** Когда опросчик последний раз видел нажатие (мс). */
  lastDownAt = 0

  setHotkey(name: string): boolean {
    const code = KEYMAP[name]
    if (!code) return false
    this.vk = code
    return true
  }

  private onDown(shift: boolean): void {
    this.downTime = Date.now()
    if (this.mode === 'toggle') {
      // любое нажатие во время hands-free записи = стоп
      this.mode = 'idle'
      this.emit('toggle-stop')
      return
    }
    if (this.mode !== 'idle') return
    const token = this.downTime
    this.holdTimer = setTimeout(() => {
      if (this.downTime !== token || this.mode !== 'idle') return
      // Shift + клавиша — голосовая правка выделенного текста (волна 6).
      this.mode = shift ? 'edit' : 'push'
      this.emit(shift ? 'edit-start' : 'push-start')
    }, HOLD_MS)
  }

  private onUp(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer)
      this.holdTimer = null
    }
    const held = Date.now() - this.downTime
    if (this.mode === 'push' || this.mode === 'edit') {
      const was = this.mode
      this.mode = 'idle'
      this.emit(was === 'edit' ? 'edit-stop' : 'push-stop')
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

  /**
   * Нажать Ctrl+C / Ctrl+V в активном окне через уже запущенный опросчик —
   * быстрее, чем запускать новый PowerShell. ok=false — опросчик не ответил.
   * PASTE с hwnd — вставить, только если окно то же.
   */
  sendCombo(cmd: 'COPY' | 'PASTE', hwnd?: string, timeoutMs = 3000): Promise<ComboResult> {
    const p = this.proc
    if (!p?.stdin || p.stdin.destroyed) return Promise.resolve({ ok: false })
    return new Promise((resolve) => {
      const w = { cmd, resolve }
      this.waiters.push(w)
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w)
        resolve({ ok: false })
      }, timeoutMs)
      w.resolve = (r) => {
        clearTimeout(t)
        resolve(r)
      }
      p.stdin!.write((hwnd && cmd === 'PASTE' ? `PASTE ${hwnd}` : cmd) + '\n')
    })
  }

  running(): boolean {
    return !!this.proc
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
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        const down = /^DOWN (\d)(?:\t([^\t]*)\t?(.*))?$/.exec(line)
        if (down) {
          this.lastDownAt = Date.now()
          this.lastApp = {
            proc: (down[2] ?? '').trim().toLowerCase(),
            title: (down[3] ?? '').replace(BIDI, '').trim()
          }
          this.onDown(down[1] === '1')
        } else if (line === 'UP') this.onUp()
        else if (line === 'READY') this.emit('ready')
        else if (line.startsWith('DONE ')) {
          const [cmd, a, b] = line.slice(5).trim().split(' ')
          const i = this.waiters.findIndex((w) => w.cmd === cmd)
          if (i < 0) continue
          const w = this.waiters.splice(i, 1)[0]
          if (cmd === 'COPY') w.resolve({ ok: true, changed: a === '1', hwnd: b })
          else if (cmd === 'PASTE') w.resolve({ ok: a !== 'SKIP', skipped: a === 'SKIP' })
          else w.resolve({ ok: true })
        }
      }
    })
    p.on('close', () => {
      if (this.proc === p) this.proc = null
      for (const w of this.waiters.splice(0)) w.resolve({ ok: false })
    })
  }

  stop(): void {
    this.mode = 'idle'
    if (this.holdTimer) clearTimeout(this.holdTimer)
    this.proc?.stdin?.end()
    this.proc?.kill()
    this.proc = null
  }

  /** Принудительно вернуть в idle (после ошибки/отмены записи). */
  reset(): void {
    this.mode = 'idle'
  }
}

export const hotkeyHook = new HotkeyHook()
