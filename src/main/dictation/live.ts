// Текст во время речи (волна 6): пока человек диктует, слова появляются в
// плашке. Облачный путь — потоковое распознавание Deepgram (Nova-3, русский):
// куски webm/opus из MediaRecorder идут в сокет как есть, без перекодирования.
// Итог потока годится как сырой текст — после отпускания клавиши не нужно
// ещё раз отправлять весь клип (быстрее и не дороже). Но только если поток
// закончился чисто: сокет оборвался, кусок не дошёл, сервер не ответил на
// CloseStream — итог неполный, и тогда распознаём клип целиком (ревью волны 6).
// Как у Superwhisper Realtime и Aqua: живой черновик — только в своём окне,
// в поле вставляется готовый текст после чистки.

interface DgResult {
  type?: string
  is_final?: boolean
  channel?: { alternatives?: { transcript?: string }[] }
}

export interface LiveResult {
  text: string
  /** Поток дошёл до конца без обрывов и потерь — текст полный. */
  clean: boolean
}

export interface LiveSession {
  push(chunk: ArrayBuffer): void
  /** Дослать хвост и закрыть поток; вернуть итоговый текст и «полный ли он». */
  finish(timeoutMs?: number): Promise<LiveResult>
  abort(): void
}

/** Параметры потока Deepgram для русской диктовки (документация «Live Streaming Audio»). */
export function deepgramLiveUrl(): string {
  const p = new URLSearchParams({
    model: 'nova-3',
    language: 'ru',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    endpointing: '300'
  })
  return `wss://api.deepgram.com/v1/listen?${p.toString()}`
}

/** Итоговые куски + последний промежуточный → текст для плашки. */
export function joinLive(finals: string[], interim: string): string {
  return [...finals, interim].map((s) => s.trim()).filter(Boolean).join(' ')
}

export function openDeepgramLive(key: string, onText: (text: string) => void): LiveSession {
  const finals: string[] = []
  let interim = ''
  let closed = false
  let finishing = false
  let clean = true
  const queue: ArrayBuffer[] = []
  let doneResolve: (() => void) | null = null
  const done = new Promise<void>((r) => (doneResolve = r))

  // Авторизация через подпротокол 'token' — документированный способ для сокетов.
  const ws = new WebSocket(deepgramLiveUrl(), ['token', key])
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => {
    for (const c of queue.splice(0)) ws.send(c)
  }
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return
    let msg: DgResult
    try {
      msg = JSON.parse(ev.data) as DgResult
    } catch {
      return
    }
    if (msg.type !== 'Results') return
    const t = msg.channel?.alternatives?.[0]?.transcript ?? ''
    if (msg.is_final) {
      if (t.trim()) finals.push(t)
      interim = ''
    } else interim = t
    onText(joinLive(finals, interim))
  }
  const end = (): void => {
    closed = true
    doneResolve?.()
  }
  ws.onclose = (ev) => {
    // Закрылся сам до CloseStream или с ошибкой — текст неполный.
    if (!finishing || ev.code !== 1000) clean = false
    end()
  }
  ws.onerror = () => {
    clean = false
    end()
  }

  return {
    push(chunk) {
      if (ws.readyState === WebSocket.OPEN && !closed) ws.send(chunk)
      else if (ws.readyState === WebSocket.CONNECTING && !closed) queue.push(chunk)
      else clean = false // кусок потерян
    },
    async finish(timeoutMs = 4000) {
      finishing = true
      if (!closed) {
        const send = (): void => {
          try {
            ws.send(JSON.stringify({ type: 'CloseStream' }))
          } catch {
            /* сокет уже закрыт */
          }
        }
        if (ws.readyState === WebSocket.OPEN) send()
        else if (ws.readyState === WebSocket.CONNECTING) ws.addEventListener('open', send, { once: true })
        await Promise.race([done, new Promise((r) => setTimeout(r, timeoutMs))])
        if (!closed) {
          clean = false // сервер не дослал итог вовремя
          ws.close()
        }
      }
      return { text: joinLive(finals, interim), clean }
    },
    abort() {
      closed = true
      try {
        ws.close()
      } catch {
        /* уже закрыт */
      }
    }
  }
}
