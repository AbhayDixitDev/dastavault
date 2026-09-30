// Generates simple PWA icons (PNG) without any dependency.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BG = [91, 79, 230]
const FG = [255, 255, 255]
function draw(size) {
  const s = size / 64
  const inRound = (x, y, x0, y0, w, h, r) => {
    if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false
    const cx = Math.max(x0 + r, Math.min(x, x0 + w - r))
    const cy = Math.max(y0 + r, Math.min(y, y0 + h - r))
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  return (px, py) => {
    const x = px / s, y = py / s
    if (!inRound(x, y, 0, 0, 64, 64, 14)) return [0, 0, 0, 0]
    // "D" shape: bar + half circle
    const inBar = x >= 22 && x < 30 && y >= 18 && y < 38
    const inArc = (x - 30) ** 2 + (y - 28) ** 2 <= 100 && x >= 30 && !((x - 30) ** 2 + (y - 28) ** 2 <= 16)
    const inBase = x >= 22 && x < 42 && y >= 38 && y < 46
    const inDot = (x - 44) ** 2 + (y - 44) ** 2 <= 25
    if (inBar || inArc || inBase || inDot) return [...FG, 255]
    return [...BG, 255]
  }
}

mkdirSync('public/icons', { recursive: true })
for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, png(size, draw(size)))
  console.log(`wrote public/icons/icon-${size}.png`)
}
