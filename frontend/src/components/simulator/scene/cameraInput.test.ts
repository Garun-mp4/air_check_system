import { describe, expect, it, vi } from 'vitest'
import { MOUSE, TOUCH } from 'three'

import { CAMERA_MOUSE_BUTTONS, CAMERA_TOUCHES, trackCameraKeyDown, trackCameraKeyUp } from './cameraInput'

function keyEvent(code: string, target: object | null = null, modifiers: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey'>> = {}) {
  return {
    code,
    target,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    cancelable: true,
    preventDefault: vi.fn(),
    ...modifiers,
  } as unknown as KeyboardEvent
}

describe('camera input', () => {
  it('assigns left-drag to pan and right-drag to rotation', () => {
    expect(CAMERA_MOUSE_BUTTONS).toEqual({
      LEFT: MOUSE.PAN,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.ROTATE,
    })
  })

  it('uses one-finger orbit and two-finger zoom/pan on touch screens', () => {
    expect(CAMERA_TOUCHES).toEqual({
      ONE: TOUCH.ROTATE,
      TWO: TOUCH.DOLLY_PAN,
    })
  })

  it('tracks WASD independently of pointer location and button focus', () => {
    const keys = new Set<string>()
    const event = keyEvent('KeyW', { tagName: 'BUTTON' })

    expect(trackCameraKeyDown(event, keys)).toBe(true)
    expect(keys.has('w')).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()

    trackCameraKeyUp(keyEvent('KeyW'), keys)
    expect(keys.has('w')).toBe(false)
  })

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])(
    'leaves keyboard input in %s controls alone',
    (tagName) => {
      const keys = new Set<string>()
      const event = keyEvent('KeyW', { tagName })

      expect(trackCameraKeyDown(event, keys)).toBe(false)
      expect(keys.size).toBe(0)
      expect(event.preventDefault).not.toHaveBeenCalled()
    },
  )

  it('leaves editable text regions alone', () => {
    const keys = new Set<string>()
    const event = keyEvent('KeyW', { tagName: 'DIV', isContentEditable: true })

    expect(trackCameraKeyDown(event, keys)).toBe(false)
    expect(keys.size).toBe(0)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not take modified browser shortcuts', () => {
    const keys = new Set<string>()
    const event = keyEvent('KeyW', null, { ctrlKey: true })

    expect(trackCameraKeyDown(event, keys)).toBe(false)
    expect(keys.size).toBe(0)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
