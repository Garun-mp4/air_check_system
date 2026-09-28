import { MOUSE, TOUCH } from 'three'

const CAMERA_KEYS_BY_CODE = {
  KeyW: 'w',
  KeyA: 'a',
  KeyS: 's',
  KeyD: 'd',
  KeyQ: 'q',
  KeyE: 'e',
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
} as const

export type CameraMovementKey = (typeof CAMERA_KEYS_BY_CODE)[keyof typeof CAMERA_KEYS_BY_CODE]

export const CAMERA_MOUSE_BUTTONS = {
  LEFT: MOUSE.PAN,
  MIDDLE: MOUSE.DOLLY,
  RIGHT: MOUSE.ROTATE,
} as const

export const CAMERA_TOUCHES = {
  ONE: TOUCH.ROTATE,
  TWO: TOUCH.DOLLY_PAN,
} as const

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false

  const element = target as HTMLElement
  const tagName = 'tagName' in element ? String(element.tagName).toUpperCase() : ''
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true
  if ('isContentEditable' in element && element.isContentEditable) return true

  return typeof element.closest === 'function' && Boolean(element.closest('[contenteditable="true"]'))
}

export function trackCameraKeyDown(event: KeyboardEvent, keys: Set<string>): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || isTextEntryTarget(event.target)) return false

  const key = CAMERA_KEYS_BY_CODE[event.code as keyof typeof CAMERA_KEYS_BY_CODE]
  if (!key) return false

  keys.add(key)
  if (key !== 'shift' && event.cancelable) event.preventDefault()
  return true
}

export function trackCameraKeyUp(event: KeyboardEvent, keys: Set<string>): void {
  const key = CAMERA_KEYS_BY_CODE[event.code as keyof typeof CAMERA_KEYS_BY_CODE]
  if (key) keys.delete(key)
}
