import { describe, expect, it } from 'vitest'

import {
  calculateCropFrame,
  parseImageDimensions,
  parseWebpDimensions,
  validateAvatarSource,
} from './avatar-image'

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ])
}

function webpHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(12 + 8 + 10 + 8 + 6)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)
  bytes.set([0x56, 0x50, 0x38, 0x58], 12)
  new DataView(bytes.buffer).setUint32(16, 10, true)
  bytes.set([
    (width - 1) & 0xff,
    ((width - 1) >> 8) & 0xff,
    ((width - 1) >> 16) & 0xff,
  ], 24)
  bytes.set([
    (height - 1) & 0xff,
    ((height - 1) >> 8) & 0xff,
    ((height - 1) >> 16) & 0xff,
  ], 27)
  bytes.set([0x56, 0x50, 0x38, 0x4c], 30)
  new DataView(bytes.buffer).setUint32(34, 5, true)
  bytes.set([
    0x2f,
    (width - 1) & 0xff,
    (((width - 1) >> 8) & 0x3f) | (((height - 1) & 0x03) << 6),
    ((height - 1) >> 2) & 0xff,
    ((height - 1) >> 10) & 0x0f,
  ], 38)
  return bytes
}

describe('avatar image preparation', () => {
  it('reads dimensions from supported image headers before decoding', () => {
    expect(parseImageDimensions(pngHeader(1200, 800), 'image/png')).toEqual({ width: 1200, height: 800 })
    expect(parseImageDimensions(jpegHeader(1920, 1080), 'image/jpeg')).toEqual({ width: 1920, height: 1080 })
    expect(parseWebpDimensions(webpHeader(512, 512))).toEqual({ width: 512, height: 512 })
  })

  it('rejects malformed headers, unsupported formats and source images over the pixel limit', () => {
    const mismatchedWebp = webpHeader(512, 512)
    mismatchedWebp[39] = 0
    expect(parseWebpDimensions(webpHeader(512, 512).slice(0, 30))).toBeNull()
    expect(parseWebpDimensions(mismatchedWebp)).toBeNull()
    expect(parseImageDimensions(pngHeader(512, 512), 'image/gif')).toBeNull()
    expect(validateAvatarSource({ type: 'image/gif', size: 100 }, { width: 20, height: 20 })).toContain('JPG, PNG или WebP')
    expect(validateAvatarSource({ type: 'image/png', size: 100 }, { width: 8000, height: 6000 })).toContain('40 мегапикселей')
    expect(validateAvatarSource({ type: 'image/png', size: 16 * 1024 * 1024 }, { width: 100, height: 100 })).toContain('15 МБ')
  })

  it('maps the visible square crop to a square source region without exposing empty space', () => {
    const wide = calculateCropFrame(800, 400, 280, 1)
    expect(wide).toMatchObject({ offsetX: -140, offsetY: 0, sourceX: 200, sourceY: 0, sourceSize: 400 })

    const zoomed = calculateCropFrame(800, 400, 280, 2, { x: -10_000, y: 10_000 })
    expect(zoomed.offsetX).toBe(280 - zoomed.renderedWidth)
    expect(zoomed.offsetY).toBe(0)
    expect(zoomed.sourceSize).toBe(200)
    expect(zoomed.sourceX + zoomed.sourceSize).toBeLessThanOrEqual(800)
    expect(zoomed.sourceY + zoomed.sourceSize).toBeLessThanOrEqual(400)
  })
})
