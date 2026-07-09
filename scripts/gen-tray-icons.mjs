import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'tray')

let crcTable
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const stride = size * 4 + 1
  const raw = Buffer.alloc(size * stride)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0 // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** 4x4 supersampled coverage → anti-aliased ring (and optional center dot). */
function drawIcon(size, withDot) {
  const rgba = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  const outer = size * 0.44
  const inner = size * 0.3
  const dot = size * 0.16
  const S = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const d = Math.hypot(x + (sx + 0.5) / S - 0.5 - c, y + (sy + 0.5) / S - 0.5 - c)
          if ((d <= outer && d >= inner) || (withDot && d <= dot)) hits++
        }
      }
      const i = (y * size + x) * 4
      rgba[i + 3] = Math.round((hits / (S * S)) * 255) // black stays 0,0,0
    }
  }
  return rgba
}

mkdirSync(outDir, { recursive: true })
for (const [name, withDot] of [
  ['ringTemplate', false],
  ['ringDotTemplate', true]
]) {
  for (const [suffix, size] of [
    ['', 18],
    ['@2x', 36]
  ]) {
    const file = join(outDir, `${name}${suffix}.png`)
    writeFileSync(file, encodePng(size, drawIcon(size, withDot)))
    console.log('wrote', file)
  }
}
