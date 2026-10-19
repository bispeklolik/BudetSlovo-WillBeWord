import { spawn } from 'child_process'

// Пауза музыки/видео на время диктовки (идея — OpenWhispr: GSMTC на Windows).
// Через системные «Медиа-элементы управления» ставим на паузу только то, что
// ИГРАЛО, и потом возобновляем ровно эти источники — чужую паузу не трогаем.
// Клавиша Play/Pause не годится: если ничего не играло, она бы ЗАПУСТИЛА музыку.

const PRELUDE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(3000) | Out-Null; $task.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
`

const PAUSE = `${PRELUDE}
$out = @()
foreach ($s in $mgr.GetSessions()) {
  if ($s.GetPlaybackInfo().PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing) {
    if (Await ($s.TryPauseAsync()) ([bool])) { $out += $s.SourceAppUserModelId }
  }
}
[Console]::Out.WriteLine('PAUSED:' + ($out -join '|'))
`

const RESUME = (ids: string[]): string => `${PRELUDE}
$ids = @(${ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',')})
foreach ($s in $mgr.GetSessions()) {
  if ($ids -contains $s.SourceAppUserModelId) { Await ($s.TryPlayAsync()) ([bool]) | Out-Null }
}
`

function runPs(script: string): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true })
    let out = ''
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (s: string) => (out += s))
    p.on('error', () => resolve(''))
    p.on('close', () => resolve(out))
    setTimeout(() => p.kill(), 8000)
  })
}

/** Разобрать ответ скрипта паузы: какие источники мы поставили на паузу. */
export function parsePaused(out: string): string[] {
  const line = out.split(/\r?\n/).find((l) => l.startsWith('PAUSED:'))
  if (!line) return []
  return line
    .slice('PAUSED:'.length)
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Поставить на паузу всё, что играет. Возвращает, что именно поставили. */
export async function pauseMedia(): Promise<string[]> {
  return parsePaused(await runPs(PAUSE))
}

export async function resumeMedia(ids: string[]): Promise<void> {
  if (ids.length) await runPs(RESUME(ids))
}
