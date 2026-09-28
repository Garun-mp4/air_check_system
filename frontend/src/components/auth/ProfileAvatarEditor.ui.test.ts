// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProfileAvatarEditor from './ProfileAvatarEditor'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  Object.assign(globalThis, { React: actual })
  return actual
})

vi.mock('./AccessSessionProvider', () => ({
  useAccessSession: () => ({ refresh: mocks.refresh }),
}))

function pngHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(new ArrayBuffer(24))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL
const originalImage = window.Image

beforeEach(() => {
  mocks.refresh.mockReset().mockResolvedValue(true)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:avatar-test') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  class TestImage {
    naturalWidth = 640
    naturalHeight = 480
    decoding = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null

    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  Object.defineProperty(window, 'Image', { configurable: true, value: TestImage })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { image: '/api/profile/avatar/test' } }), { status: 200 })))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
    callback(new Blob(['webp-avatar'], { type: type ?? 'image/webp' }))
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL })
  Object.defineProperty(window, 'Image', { configurable: true, value: originalImage })
})

describe('profile avatar editor', () => {
  it('validates a selected file, opens the cropper, uploads the prepared image and refreshes the shared session', async () => {
    render(createElement(ProfileAvatarEditor, { image: null, name: 'Garun' }))
    const file = new File([pngHeader(640, 480)], 'portrait.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Выберите фото профиля'), { target: { files: [file] } })

    expect(await screen.findByRole('dialog', { name: 'Кадрирование аватара' })).not.toBeNull()
    const cropImage = screen.getByRole('dialog').querySelector('img')
    expect(cropImage).not.toBeNull()
    fireEvent.load(cropImage as HTMLImageElement)
    fireEvent.click(screen.getByRole('button', { name: 'Установить аватар' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Аватар установлен'))
    expect(fetch).toHaveBeenCalledWith('/api/profile/avatar', expect.objectContaining({ method: 'POST' }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-test')
  })

  it('does not let a slower previous selection override a newer invalid file selection', async () => {
    render(createElement(ProfileAvatarEditor, { image: null, name: 'Garun' }))
    const input = screen.getByLabelText('Выберите фото профиля')
    const validFile = new File([pngHeader(640, 480)], 'portrait.png', { type: 'image/png' })
    const invalidFile = new File(['not an image'], 'notes.txt', { type: 'text/plain' })

    fireEvent.change(input, { target: { files: [validFile] } })
    fireEvent.change(input, { target: { files: [invalidFile] } })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('JPG, PNG или WebP')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
