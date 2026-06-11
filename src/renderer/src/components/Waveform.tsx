import { useEffect, useRef } from 'react'

export interface Lane {
  startFrac: number
  endFrac: number
  colorKey: string
}

interface Props {
  peaks: Int8Array | null
  durationSec: number
  currentTime: number
  lanes?: Lane[]
  onSeek: (sec: number) => void
}

const LANE_H = 5

export default function Waveform({
  peaks,
  durationSec,
  currentTime,
  lanes,
  onSeek
}: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, w, h)

      const css = getComputedStyle(document.documentElement)
      const waveH = lanes && lanes.length > 0 ? h - LANE_H - 3 : h

      ctx.fillStyle = css.getPropertyValue('--wave').trim() || '#888'
      if (peaks && peaks.length >= 2) {
        const buckets = peaks.length / 2
        const mid = waveH / 2
        for (let x = 0; x < w; x++) {
          const b0 = Math.floor((x / w) * buckets)
          const b1 = Math.max(b0 + 1, Math.floor(((x + 1) / w) * buckets))
          let min = 127
          let max = -128
          for (let b = b0; b < b1 && b < buckets; b++) {
            const lo = peaks[b * 2]
            const hi = peaks[b * 2 + 1]
            if (lo < min) min = lo
            if (hi > max) max = hi
          }
          const y1 = mid - (max / 128) * (mid - 2)
          const y2 = mid - (min / 128) * (mid - 2)
          ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1))
        }
      } else {
        ctx.fillRect(0, waveH / 2, w, 1)
      }

      if (lanes && lanes.length > 0) {
        const y = h - LANE_H
        for (const lane of lanes) {
          const x0 = lane.startFrac * w
          const x1 = Math.max(x0 + 1, lane.endFrac * w)
          ctx.fillStyle = css.getPropertyValue('--' + lane.colorKey).trim() || '#888'
          ctx.fillRect(x0, y, x1 - x0, LANE_H)
        }
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [peaks, lanes])

  const playheadPct = durationSec > 0 ? Math.min(100, (currentTime / durationSec) * 100) : 0

  return (
    <div
      ref={wrapRef}
      className="waveform"
      data-testid="waveform"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const frac = (e.clientX - rect.left) / rect.width
        onSeek(Math.max(0, Math.min(1, frac)) * durationSec)
      }}
    >
      <canvas ref={canvasRef} />
      <div className="playhead" style={{ left: playheadPct + '%' }} />
    </div>
  )
}
