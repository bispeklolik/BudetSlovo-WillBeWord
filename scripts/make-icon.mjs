// Генератор иконки приложения из фирменного знака-волны — без внешних зависимостей.
// Рисует 256×256 RGBA в памяти, кодирует PNG (zlib из Node) и заворачивает в .ico
// (Windows Vista+ понимает PNG внутри ICO). Результат: build/icon.ico и build/icon.png.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SIZE = 256
const TEAL = [13, 130, 118] // #0d8276 — accent-solid
const WHITE = [255, 255, 255]

// Точка внутри прямоугольника со скруглёнными углами?
function inRoundRect(px, py, left, top, right, bottom, r) {
  if (px < left || px > right || py < top || py > bottom) return false
  const cx = px < left + r ? left + r : px > right - r ? right - r : px
  const cy = py < top + r ? top + r : py > bottom - r ? bottom - r : py
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

// 5 вертикальных столбиков-волны (высоты повторяют SVG-знак: 4/12/18/12/4).
const BARS = [70, 130, 170, 130, 70]
const BAR_W = 24
const GAP = 26
const totalW = BARS.length * BAR_W + (BARS.length - 1) * GAP
const startX = (SIZE - totalW) / 2
const midY = SIZE / 2

function isBar(px, py) {
  for (let i = 0; i < BARS.length; i++) {
    const left = startX + i * (BAR_W + GAP)
    const halfH = BARS[i] / 2
    if (inRoundRect(px, py, left, midY - halfH, left + BAR_W, midY + halfH, BAR_W / 2)) return true
  }
  return false
}

// --- собрать пиксели ---
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1)) // +1 байт фильтра на строку
let o = 0
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    let rgb = null
    let a = 0
    if (inRoundRect(x + 0.5, y + 0.5, 0, 0, SIZE, SIZE, 48)) {
      rgb = isBar(x + 0.5, y + 0.5) ? WHITE : TEAL
      a = 255
    }
    raw[o++] = rgb ? rgb[0] : 0
    raw[o++] = rgb ? rgb[1] : 0
    raw[o++] = rgb ? rgb[2] : 0
    raw[o++] = a
  }
}

// --- PNG ---
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return (buf) => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
})()

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(CRC(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type RGBA
// 10,11,12 = 0 (compression/filter/interlace)

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

// --- ICO (одна запись с PNG внутри) ---
const dir = Buffer.alloc(6)
dir.writeUInt16LE(0, 0) // reserved
dir.writeUInt16LE(1, 2) // type: icon
dir.writeUInt16LE(1, 4) // count
const entry = Buffer.alloc(16)
entry[0] = 0 // width 0 == 256
entry[1] = 0 // height 0 == 256
entry[2] = 0 // palette
entry[3] = 0 // reserved
entry.writeUInt16LE(1, 4) // planes
entry.writeUInt16LE(32, 6) // bpp
entry.writeUInt32LE(png.length, 8) // size
entry.writeUInt32LE(22, 12) // offset (6 + 16)
const ico = Buffer.concat([dir, entry, png])

const buildDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
mkdirSync(buildDir, { recursive: true })
writeFileSync(join(buildDir, 'icon.png'), png)
writeFileSync(join(buildDir, 'icon.ico'), ico)
console.log(`icon.png ${png.length} B, icon.ico ${ico.length} B → ${buildDir}`)
