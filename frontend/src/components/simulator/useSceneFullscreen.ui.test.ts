// @vitest-environment jsdom
import React, { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSceneFullscreen } from './useSceneFullscreen'

let native: Element | null = null
const request = vi.fn<() => Promise<void>>()
const exit = vi.fn<() => Promise<void>>()
const properties = [
  [document, 'fullscreenElement'], [document, 'fullscreenEnabled'], [document, 'exitFullscreen'],
  [HTMLElement.prototype, 'requestFullscreen'],
] as const
const originals = properties.map(([object, key]) => Object.getOwnPropertyDescriptor(object, key))

function Harness() {
  const target = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const fullscreen = useSceneFullscreen(target, button)
  return React.createElement('main', null,
    React.createElement('header', { 'data-testid': 'background' }, React.createElement('button', null, 'Outside')),
    React.createElement('div', { ref: target, 'data-testid': 'workspace', 'data-mode': fullscreen.mode ?? 'closed' },
      React.createElement('button', { ref: button, onClick: () => void fullscreen.toggle(), disabled: fullscreen.pending }, fullscreen.expanded ? 'Exit' : 'Expand'),
      React.createElement('button', null, 'Last control'),
      fullscreen.error ? React.createElement('p', { role: 'alert' }, fullscreen.error) : null))
}

beforeEach(() => {
  native = null
  request.mockReset().mockImplementation(async function (this: HTMLElement) {
    native = this
    document.dispatchEvent(new Event('fullscreenchange'))
  })
  exit.mockReset().mockImplementation(async () => {
    native = null
    document.dispatchEvent(new Event('fullscreenchange'))
  })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => native })
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => {
    const rectangle = new DOMRect(0, 0, 100, 40)
    return Object.assign([rectangle], { item: (index: number) => index === 0 ? rectangle : null })
  })
})

afterEach(() => {
  cleanup()
  properties.forEach(([object, key], index) => {
    const descriptor = originals[index]
    if (descriptor) Object.defineProperty(object, key, descriptor)
    else Reflect.deleteProperty(object, key)
  })
  document.body.style.overflow = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('3D scene fullscreen', () => {
  it('enters the native workspace, exits with its control and restores focus/scroll', async () => {
    const user = userEvent.setup()
    document.body.style.overflow = 'auto'
    render(React.createElement(Harness))
    const workspace = screen.getByTestId('workspace')
    await user.click(screen.getByRole('button', { name: 'Expand' }))
    expect(native).toBe(workspace)
    expect(workspace.dataset.mode).toBe('native')
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByTestId('background').hasAttribute('inert')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Exit' }))
    expect(native).toBeNull()
    expect(document.body.style.overflow).toBe('auto')
    expect(screen.getByTestId('background').hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand' }))
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it.each(['missing', 'disabled'] as const)('fills the viewport when native fullscreen is %s and exits with Esc', async reason => {
    const user = userEvent.setup()
    if (reason === 'missing') Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: undefined })
    else Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false })
    render(React.createElement(Harness))
    await user.click(screen.getByRole('button', { name: 'Expand' }))
    expect(screen.getByTestId('workspace').dataset.mode).toBe('viewport')
    expect(request).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('workspace').dataset.mode).toBe('closed')
    expect(exit).not.toHaveBeenCalled()
  })

  it('uses the viewport fallback after a denied native request', async () => {
    request.mockRejectedValueOnce(new Error('Policy denied fullscreen'))
    render(React.createElement(Harness))
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(screen.getByTestId('workspace').dataset.mode).toBe('viewport')
    expect(screen.getByRole('button', { name: 'Exit' })).toBeTruthy()
  })

  it('synchronizes an exit initiated by the browser', async () => {
    render(React.createElement(Harness))
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    act(() => { native = null; document.dispatchEvent(new Event('fullscreenchange')) })
    expect(screen.getByTestId('workspace').dataset.mode).toBe('closed')
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps an exit failure recoverable with a visible control', async () => {
    render(React.createElement(Harness))
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    exit.mockRejectedValueOnce(new Error('Exit temporarily rejected'))
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(screen.getByRole('alert').textContent).toContain('Нажмите Esc')
    expect(screen.getByTestId('workspace').dataset.mode).toBe('native')
    await userEvent.keyboard('{Escape}')
    expect(screen.getByTestId('workspace').dataset.mode).toBe('closed')
  })

  it('wraps keyboard focus within the expanded controls', async () => {
    render(React.createElement(Harness))
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    screen.getByRole('button', { name: 'Last control' }).focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Exit' }))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last control' }))
  })

  it('does not repeat an in-flight native request or expand again after an early browser exit', async () => {
    let finish: () => void = () => undefined
    request.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    render(React.createElement(Harness))
    const button = screen.getByRole('button', { name: 'Expand' })
    fireEvent.click(button); fireEvent.click(button)
    expect(request).toHaveBeenCalledTimes(1)
    await act(async () => {
      native = screen.getByTestId('workspace'); document.dispatchEvent(new Event('fullscreenchange'))
      native = null; document.dispatchEvent(new Event('fullscreenchange'))
      finish()
    })
    expect(screen.getByTestId('workspace').dataset.mode).toBe('closed')
  })

  it('restores previous inert state and body scrolling when the expanded page unmounts', async () => {
    request.mockRejectedValueOnce(new Error('No native fullscreen'))
    document.body.style.overflow = 'scroll'
    const view = render(React.createElement(Harness))
    const background = screen.getByTestId('background')
    background.setAttribute('inert', 'previous')
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    view.unmount()
    expect(background.getAttribute('inert')).toBe('previous')
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('cleans up its native screen on unmount without exiting another element', async () => {
    const view = render(React.createElement(Harness))
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    view.unmount()
    await waitFor(() => expect(exit).toHaveBeenCalledTimes(1))
    const second = render(React.createElement(Harness))
    native = document.createElement('video')
    second.unmount()
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
