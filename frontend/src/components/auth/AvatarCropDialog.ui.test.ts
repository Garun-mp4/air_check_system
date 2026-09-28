// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AvatarCropDialog from './AvatarCropDialog'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  Object.assign(globalThis, { React: actual })
  return actual
})

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

describe('avatar crop dialog', () => {
  it('supports keyboard repositioning, zoom and cancellation', () => {
    const onCancel = vi.fn()
    const onSave = vi.fn()
    render(
      createElement(AvatarCropDialog, {
        source: { url: 'blob:test-avatar', width: 640, height: 480, fileName: 'portrait.jpg' },
        busy: false,
        onCancel,
        onSave,
      }),
    )

    const stage = screen.getByRole('group', { name: /область кадрирования/i })
    const image = screen.getByRole('dialog').querySelector('img')
    expect(image).not.toBeNull()
    const initialLeft = image?.getAttribute('style')

    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    expect(image?.getAttribute('style')).not.toBe(initialLeft)

    fireEvent.change(screen.getByRole('slider', { name: 'Масштаб изображения' }), { target: { value: '2' } })
    expect(screen.getByText('2.0×')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('prevents closing while the avatar is being saved', () => {
    const onCancel = vi.fn()
    render(
      createElement(AvatarCropDialog, {
        source: { url: 'blob:test-avatar', width: 480, height: 480, fileName: 'portrait.jpg' },
        busy: true,
        onCancel,
        onSave: vi.fn(),
      }),
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    for (const button of screen.getAllByRole('button', { name: 'Отмена' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
    expect(onCancel).not.toHaveBeenCalled()
  })
})
