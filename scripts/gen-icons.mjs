import fs from 'node:fs'
import zlib from 'node:zlib'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function png(size, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const stride = size * 3 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < size; x++) {
      const i = y * stride + 1 + x * 3
      const cx = x - size / 2
      const cy = y - size / 2
      const inCircle = cx * cx + cy * cy < size * 0.38 * (size * 0.38)
      if (inCircle) {
        raw[i] = r
        raw[i + 1] = g
        raw[i + 2] = b
      } else {
        raw[i] = 243
        raw[i + 1] = 239
        raw[i + 2] = 230
      }
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

fs.mkdirSync('public', { recursive: true })
fs.writeFileSync('public/pwa-192.png', png(192, 180, 83, 9))
fs.writeFileSync('public/pwa-512.png', png(512, 180, 83, 9))
fs.writeFileSync('public/apple-touch-icon.png', png(180, 180, 83, 9))
fs.writeFileSync(
  'public/favicon.svg',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f3efe6"/><circle cx="32" cy="32" r="18" fill="#b45309"/></svg>',
)
console.log('icons ok')
