export const AVATAR_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const AVATAR_MAX_INPUT_BYTES = 15 * 1024 * 1024
export const AVATAR_MAX_SOURCE_DIMENSION = 12_000
export const AVATAR_MAX_SOURCE_PIXELS = 40_000_000
export const AVATAR_OUTPUT_SIZE = 512
export const AVATAR_MAX_UPLOAD_BYTES = 512 * 1024
export const AVATAR_IMAGE_HEADER_BYTES = 512 * 1024
export const AVATAR_MAX_ZOOM = 3

export type AvatarInputType = typeof AVATAR_INPUT_TYPES[number]

export interface ImageDimensions {
  width: number
  height: number
}

export interface CropFrame {
  offsetX: number
  offsetY: number
  renderedWidth: number
  renderedHeight: number
  scale: number
  sourceX: number
  sourceY: number
  sourceSize: number
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

function parsePngDimensions(bytes: Uint8Array): ImageDimensions | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function parseJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue

    const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return null
      const height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0)
      const width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0)
      return { width, height }
    }
    offset += segmentLength
  }

  return null
}

export function parseWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 20
    || String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF'
    || String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4, true) + 8 !== bytes.byteLength) return null

  let extendedDimensions: ImageDimensions | null = null
  let imageDimensions: ImageDimensions | null = null
  let hasImagePayload = false
  let offset = 12

  while (offset + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(...bytes.slice(offset, offset + 4))
    const chunkLength = view.getUint32(offset + 4, true)
    const dataOffset = offset + 8
    const chunkEnd = dataOffset + chunkLength
    if (chunkEnd > bytes.length) return null

    if (chunkType === 'VP8X' && chunkLength >= 10) {
      extendedDimensions = {
        width: readUint24LE(bytes, dataOffset + 4) + 1,
        height: readUint24LE(bytes, dataOffset + 7) + 1,
      }
    } else if (chunkType === 'VP8L' && chunkLength >= 5 && bytes[dataOffset] === 0x2f) {
      const b1 = bytes[dataOffset + 1] ?? 0
      const b2 = bytes[dataOffset + 2] ?? 0
      const b3 = bytes[dataOffset + 3] ?? 0
      const b4 = bytes[dataOffset + 4] ?? 0
      imageDimensions = {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + ((b2 >> 6) & 0x03) + (b3 << 2) + ((b4 & 0x0f) << 10),
      }
      hasImagePayload = true
    } else if (chunkType === 'VP8 ' && chunkLength >= 10
      && bytes[dataOffset + 3] === 0x9d
      && bytes[dataOffset + 4] === 0x01
      && bytes[dataOffset + 5] === 0x2a) {
      imageDimensions = {
        width: view.getUint16(dataOffset + 6, true) & 0x3fff,
        height: view.getUint16(dataOffset + 8, true) & 0x3fff,
      }
      hasImagePayload = true
    }

    offset = chunkEnd + (chunkLength % 2)
  }

  if (offset !== bytes.length || !hasImagePayload) return null
  if (extendedDimensions && imageDimensions
    && (extendedDimensions.width !== imageDimensions.width || extendedDimensions.height !== imageDimensions.height)) {
    return null
  }
  return extendedDimensions ?? imageDimensions
}

export function parseImageDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | null {
  if (mimeType === 'image/png') return parsePngDimensions(bytes)
  if (mimeType === 'image/jpeg') return parseJpegDimensions(bytes)
  if (mimeType === 'image/webp') return parseWebpDimensions(bytes)
  return null
}

export function validateAvatarSource(
  file: { type: string; size: number },
  dimensions: ImageDimensions | null,
): string | null {
  if (!AVATAR_INPUT_TYPES.includes(file.type as AvatarInputType)) {
    return 'Выберите изображение в формате JPG, PNG или WebP.'
  }
  if (file.size <= 0) return 'Выбранный файл пуст.'
  if (file.size > AVATAR_MAX_INPUT_BYTES) return 'Размер исходного изображения не должен превышать 15 МБ.'
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) return 'Не удалось прочитать изображение. Выберите другой файл.'
  if (dimensions.width > AVATAR_MAX_SOURCE_DIMENSION || dimensions.height > AVATAR_MAX_SOURCE_DIMENSION
    || dimensions.width * dimensions.height > AVATAR_MAX_SOURCE_PIXELS) {
    return 'Изображение слишком большое. Выберите файл с размером до 40 мегапикселей.'
  }
  return null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function calculateCropFrame(
  imageWidth: number,
  imageHeight: number,
  viewportSize: number,
  zoom: number,
  offset?: { x: number; y: number },
): CropFrame {
  const scale = Math.max(viewportSize / imageWidth, viewportSize / imageHeight) * zoom
  const renderedWidth = imageWidth * scale
  const renderedHeight = imageHeight * scale
  const offsetX = clamp(offset?.x ?? (viewportSize - renderedWidth) / 2, viewportSize - renderedWidth, 0)
  const offsetY = clamp(offset?.y ?? (viewportSize - renderedHeight) / 2, viewportSize - renderedHeight, 0)
  const sourceSize = viewportSize / scale

  return {
    offsetX,
    offsetY,
    renderedWidth,
    renderedHeight,
    scale,
    sourceX: clamp(-offsetX / scale, 0, imageWidth - sourceSize),
    sourceY: clamp(-offsetY / scale, 0, imageHeight - sourceSize),
    sourceSize,
  }
}
