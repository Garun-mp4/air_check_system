import * as React from 'react'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Edges } from '@react-three/drei'
import { describe, expect, it, vi } from 'vitest'
import { Canvas } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { SimulatorSnapshot, VisualizationMode } from '../types'
import Airflow from './Airflow'
import CameraRig from './CameraRig'
import { Pickable } from './Pickable'
import RoomShell from './RoomShell'
import SceneCanvas from './SceneCanvas'
import Wiring from './Wiring'
import { CameraTransition } from './cameraTransition'

const { setHovered } = vi.hoisted(() => ({ setHovered: vi.fn() }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: () => [false, setHovered] }
})

Object.assign(globalThis, { React })

type SceneElement = ReactElement<{ children?: ReactNode; [key: string]: unknown }>

function elements(node: ReactNode): SceneElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child as ReactNode))
  if (!isValidElement(node)) return []
  const element = node as SceneElement
  return [element, ...elements(element.props.children)]
}

function sceneSnapshot(): SimulatorSnapshot {
  return {
    simulation: {
      room_dimensions: {
        width_m: 6,
        depth_m: 4.2,
        height_m: 3.2,
        wall_thickness_m: 0.16,
        window_width_m: 1.8,
        window_height_m: 1.25,
        window_sill_height_m: 0.9,
        window_open_angle_degrees: 55,
        outdoor_depth_m: 4.5,
      },
      camera: {
        start_position: [7, 3.1, -9],
        start_target: [0, 1.1, 0],
        field_of_view_degrees: 42,
        near_plane_m: 0.1,
        far_plane_m: 120,
      },
    },
  } as SimulatorSnapshot
}

describe('3D scene interaction wiring', () => {
  it('passes each visualization mode and cutaway through to the scene layers', () => {
    const modes: VisualizationMode[] = ['normal', 'airflow', 'sensors', 'wiring', 'technical']

    for (const mode of modes) {
      const tree = SceneCanvas({
        snapshot: sceneSnapshot(),
        mode,
        cutaway: 'transparent',
        selectedId: null,
        cameraCommand: { id: 3, focus: null },
        onSelect: vi.fn(),
        onClearSelection: vi.fn(),
      })
      const canvas = elements(tree).find((element) => element.type === Canvas)
      expect(canvas).toBeDefined()

      const scene = elements(canvas!.props.children)
      expect(scene.find((element) => element.type === RoomShell)?.props.cutaway).toBe('transparent')
      expect(scene.find((element) => element.type === Wiring)?.props.visible).toBe(mode === 'wiring' || mode === 'technical')
      expect(scene.find((element) => element.type === Airflow)?.props.visible).toBe(mode === 'airflow')
      expect(scene.find((element) => element.type === CameraRig)?.props.command).toEqual({ id: 3, focus: null })
    }
  })

  it('clears a picked object only for a left-button miss and suppresses the browser context menu', () => {
    const onClearSelection = vi.fn()
    const tree = SceneCanvas({
      snapshot: sceneSnapshot(),
      mode: 'normal',
      cutaway: 'visible',
      selectedId: 'fan.intake',
      cameraCommand: { id: 0, focus: null },
      onSelect: vi.fn(),
      onClearSelection,
    })
    const canvas = elements(tree).find((element) => element.type === Canvas)!
    const missed = canvas.props.onPointerMissed as (event: { button: number }) => void

    missed({ button: 2 })
    expect(onClearSelection).not.toHaveBeenCalled()
    missed({ button: 0 })
    expect(onClearSelection).toHaveBeenCalledOnce()

    const preventDefault = vi.fn()
    ;(canvas.props.onContextMenu as (event: { preventDefault: () => void }) => void)({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('selects pickable objects from left clicks and ignores other buttons', () => {
    const onSelect = vi.fn()
    const tree = Pickable({
      id: 'fan.intake',
      position: [-2, 2, 1.9],
      bounds: [0.3, 0.3, 0.34],
      selectedId: null,
      mode: 'normal',
      onSelect,
      children: null,
    }) as SceneElement
    const click = tree.props.onClick as (event: {
      button: number
      point: { x: number; y: number; z: number }
      stopPropagation: () => void
    }) => void
    const stopPropagation = vi.fn()

    click({ button: 2, point: { x: 1, y: 2, z: 3 }, stopPropagation })
    expect(stopPropagation).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()

    click({ button: 0, point: { x: 1, y: 2, z: 3 }, stopPropagation })
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith('fan.intake', [1, 2, 3])
    expect(tree.props.userData).toEqual({ deviceId: 'fan.intake' })
  })

  it('draws a clean object-boundary highlight without triangulated box diagonals', () => {
    const tree = Pickable({
      id: 'window.assembly',
      bounds: [1.8, 1.25, 0.11],
      selectedId: 'window.assembly',
      mode: 'normal',
      onSelect: vi.fn(),
      children: null,
    }) as SceneElement
    const descendants = elements(tree)
    const edgeHighlight = descendants.find((element) => element.type === Edges)

    expect(edgeHighlight).toBeDefined()
    expect(edgeHighlight?.props.depthTest).toBe(true)
    expect(edgeHighlight?.props.depthWrite).toBe(false)
    expect(descendants.some((element) => element.type === 'meshBasicMaterial' && element.props.wireframe)).toBe(false)
  })
})

describe('camera reset transition', () => {
  it('returns the camera and orbit target to the configured starting pose', () => {
    const transition = new CameraTransition()
    const cameraPosition = new Vector3(1, 8, 6)
    const target = new Vector3(-2, 0.5, 4)
    const startPosition = new Vector3(7, 3.1, -9)
    const startTarget = new Vector3(0, 1.1, 0)

    transition.focus(cameraPosition, target, new Vector3(3, 1, 2))
    transition.reset(startPosition, startTarget)
    transition.advance(cameraPosition, target, 30, 0.55)

    expect(transition.active).toBe(false)
    expect(cameraPosition.distanceTo(startPosition)).toBe(0)
    expect(target.distanceTo(startTarget)).toBe(0)
  })
})
