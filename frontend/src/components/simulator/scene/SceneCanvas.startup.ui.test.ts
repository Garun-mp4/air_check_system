// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SimulatorSnapshot } from '../types'
import SceneCanvas from './SceneCanvas'
import SceneStartupBoundary from './SceneStartupBoundary'

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/fiber')>()
  const React = await import('react')
  return {
    ...actual,
    Canvas: ({ fallback, onCreated }: { fallback?: ReactNode; onCreated?: () => void }) => {
      React.useEffect(() => onCreated?.(), [onCreated])
      return React.createElement('canvas', null, fallback)
    },
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('scene startup', () => {
  it('does not report a WebGL failure when the canvas fallback mounts during successful startup', () => {
    const onSceneError = vi.fn()
    const onRendererReady = vi.fn()
    const snapshot = {
      simulation: {
        room_dimensions: { width_m: 6, depth_m: 4.2, outdoor_depth_m: 4.5 },
        camera: { field_of_view_degrees: 42, near_plane_m: 0.1, far_plane_m: 120 },
      },
    } as SimulatorSnapshot

    render(createElement(SceneCanvas, {
      snapshot,
      mode: 'normal',
      cutaway: 'hidden',
      selectedId: null,
      cameraCommand: { id: 0, focus: null },
      onSelect: vi.fn(),
      onClearSelection: vi.fn(),
      onRendererReady,
      onSceneError,
    }))

    expect(onRendererReady).toHaveBeenCalledOnce()
    expect(onSceneError).not.toHaveBeenCalled()
  })

  it('automatically remounts a failed renderer once without reporting a terminal error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let shouldFail = true
    const onError = vi.fn()
    const onRetry = vi.fn(() => { shouldFail = false })
    function Renderer() {
      if (shouldFail) throw new Error('Temporary context creation failure')
      return createElement('canvas', { 'data-testid': 'renderer' })
    }

    const view = render(createElement(SceneStartupBoundary, {
      onRetry,
      onError,
      children: createElement(Renderer),
    }))

    expect(onRetry).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    expect(view.getByTestId('renderer')).toBeTruthy()
  })

  it('stops automatic retries after a persistent failure and allows a fresh manual attempt', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let shouldFail = true
    const onError = vi.fn()
    const onRetry = vi.fn()
    function Renderer() {
      if (shouldFail) throw new Error('WebGL context creation failed')
      return createElement('canvas', { 'data-testid': 'renderer' })
    }
    const props = { onRetry, onError, children: createElement(Renderer) }
    const view = render(createElement(SceneStartupBoundary, { ...props, key: 0 }))

    expect(onRetry).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledExactlyOnceWith('WebGL context creation failed')
    expect(view.queryByTestId('renderer')).toBeNull()

    shouldFail = false
    view.rerender(createElement(SceneStartupBoundary, { ...props, key: 1 }))

    expect(view.getByTestId('renderer')).toBeTruthy()
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
