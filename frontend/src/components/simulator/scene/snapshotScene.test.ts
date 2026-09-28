import * as React from 'react'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { FanState, SimulatorSnapshot } from '../types'
import Airflow from './Airflow'
import FanAssembly from './FanAssembly'
import { Pickable } from './Pickable'
import RoomShell from './RoomShell'
import WindowAssembly from './WindowAssembly'
import { windowAssemblyGeometry } from './models/geometry'

Object.assign(globalThis, { React })

type SceneElement = ReactElement<{ children?: ReactNode; [key: string]: unknown }>

function elements(node: ReactNode): SceneElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child as ReactNode))
  if (!isValidElement(node)) return []
  const element = node as SceneElement
  return [element, ...elements(element.props.children)]
}

function elementName(element: SceneElement): string {
  if (typeof element.type === 'string') return element.type
  if (typeof element.type === 'function') return element.type.name
  return ''
}

const defaultIntake: FanState = {
  enabled: true,
  rpm: 780,
  airflow_m3_h: 62,
  nominal_rpm: 1200,
  nominal_airflow_m3_h: 96,
  rated_power_w: 18,
}

const defaultExhaust: FanState = {
  enabled: false,
  rpm: 0,
  airflow_m3_h: 0,
  nominal_rpm: 1200,
  nominal_airflow_m3_h: 96,
  rated_power_w: 18,
}

type SnapshotOptions = {
  actualPositionPercent?: number
  intake?: FanState
  exhaust?: FanState
  windowAirflow?: number
  intakeAirflow?: number
  exhaustAirflow?: number
}

function sceneSnapshot(options: SnapshotOptions = {}): SimulatorSnapshot {
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
    },
    window: {
      target_position_percent: 80,
      actual_position_percent: options.actualPositionPercent ?? 0,
      motor_state: 'opening',
      reed_switch: false,
      open_limit_switch: false,
      close_limit_switch: true,
    },
    ventilation: {
      intake: options.intake ?? defaultIntake,
      exhaust: options.exhaust ?? defaultExhaust,
      filter_enabled: true,
      filter_efficiency: 0.75,
    },
    airflow: {
      infiltration_m3_h: 2,
      window_m3_h: options.windowAirflow ?? 18,
      intake_m3_h: options.intakeAirflow ?? 61,
      exhaust_m3_h: options.exhaustAirflow ?? 0,
      total_effective_m3_h: 81,
      air_changes_per_hour: 3.2,
    },
  } as SimulatorSnapshot
}

describe('snapshot-driven scene state', () => {
  it('places the room fan assemblies from snapshot dimensions and forwards actual fan states', () => {
    const snapshot = sceneSnapshot()
    const fans = elements(FanAssembly({ snapshot, selectedId: null, mode: 'normal', onSelect: () => {} }))
      .filter((element) => elementName(element) === 'Fan')

    expect(fans).toHaveLength(2)
    const intake = fans.find((element) => element.props.id === 'fan.intake')!
    const exhaust = fans.find((element) => element.props.id === 'fan.exhaust')!
    expect(intake.props.state).toBe(snapshot.ventilation.intake)
    expect(exhaust.props.state).toBe(snapshot.ventilation.exhaust)
    const intakePosition = intake.props.position as number[]
    const exhaustPosition = exhaust.props.position as number[]
    expect(intakePosition[0]).toBeCloseTo(-2.22, 6)
    expect(exhaustPosition[0]).toBeCloseTo(2.22, 6)
    expect(intakePosition[1]).toBeCloseTo(2.592, 6)
    expect(exhaustPosition[1]).toBeCloseTo(2.592, 6)
    expect(intakePosition[2]).toBeCloseTo(1.91, 6)
    expect(exhaustPosition[2]).toBeCloseTo(1.91, 6)
  })

  it('exposes the window sash and both fans as selectable device IDs', () => {
    const snapshot = sceneSnapshot()
    const onSelect = () => {}
    const windowPickables = elements(WindowAssembly({ snapshot, selectedId: null, mode: 'normal', onSelect }))
      .filter((element) => element.type === Pickable)
    expect(windowPickables.map((element) => element.props.id)).toContain('window.assembly')

    const fanPickables = elements(FanAssembly({ snapshot, selectedId: null, mode: 'normal', onSelect }))
      .filter((element) => elementName(element) === 'Fan')
      .flatMap((fan) => elements((fan.type as (props: SceneElement['props']) => ReactNode)(fan.props)))
      .filter((element) => element.type === Pickable)
    expect(fanPickables.map((element) => element.props.id).sort()).toEqual(['fan.exhaust', 'fan.intake'])
    expect([...windowPickables, ...fanPickables].every((element) => element.props.onSelect === onSelect)).toBe(true)
  })

  it('mounts the open limit switch on the fixed actuator bracket instead of the open sash position', () => {
    const closed = sceneSnapshot({ actualPositionPercent: 0 })
    const open = sceneSnapshot({ actualPositionPercent: 100 })
    const renderWindow = (snapshot: SimulatorSnapshot) => elements(WindowAssembly({
      snapshot,
      selectedId: null,
      mode: 'normal',
      onSelect: () => {},
    }))
    const closedElements = renderWindow(closed)
    const openElements = renderWindow(open)
    const openSwitch = (scene: SceneElement[]) => scene.find((element) => element.type === Pickable
      && element.props.id === 'window.limit_open')!
    const geometry = windowAssemblyGeometry(closed.simulation.room_dimensions)
    const bracket = closedElements.find((element) => elementName(element) === 'Housing'
      && JSON.stringify(element.props.position) === JSON.stringify(geometry.openLimitBracketCenter))

    expect(openSwitch(closedElements).props.position).toEqual(geometry.openLimitCenter)
    expect(openSwitch(openElements).props.position).toEqual(geometry.openLimitCenter)
    expect(bracket?.props.size).toEqual(geometry.openLimitBracketSize)
  })

  it('uses the reported window opening percentage to rotate the sash', () => {
    const closed = sceneSnapshot({ actualPositionPercent: 0 })
    const open = sceneSnapshot({ actualPositionPercent: 40 })
    const openingAngle = windowAssemblyGeometry(open.simulation.room_dimensions).openingAngle

    const rotationOf = (snapshot: SimulatorSnapshot) => elements(WindowAssembly({
      snapshot,
      selectedId: null,
      mode: 'normal',
      onSelect: () => {},
    })).find((element) => element.type === 'group'
      && Array.isArray(element.props.rotation)
      && (element.props.rotation as number[])[0] > 0)?.props.rotation

    expect(rotationOf(closed)).toBeUndefined()
    const openRotation = rotationOf(open) as number[]
    expect(openRotation[0]).toBeCloseTo(openingAngle * 0.4, 12)
    expect(openRotation.slice(1)).toEqual([0, 0])
  })

  it('feeds each reported airflow volume and visibility into its matching flow track', () => {
    const snapshot = sceneSnapshot({ windowAirflow: 12.5, intakeAirflow: 48, exhaustAirflow: 47 })
    const tracks = elements(Airflow({ snapshot, visible: true })).filter((element) => elementName(element) === 'FlowTrack')

    expect(tracks.map((track) => track.props.volume)).toEqual([12.5, 48, 47])
    expect(tracks.every((track) => track.props.visible === true)).toBe(true)

    const hiddenTracks = elements(Airflow({ snapshot, visible: false })).filter((element) => elementName(element) === 'FlowTrack')
    expect(hiddenTracks.every((track) => track.props.visible === false)).toBe(true)
  })

  it('leaves rear wall apertures at the snapshot window and fan sleeve locations', () => {
    const snapshot = sceneSnapshot()
    const { width_m: width, depth_m: depth, height_m: height, window_sill_height_m: sill, window_height_m: windowHeight } = snapshot.simulation.room_dimensions
    const backZ = depth / 2
    const panels = elements(RoomShell({ snapshot, cutaway: 'visible' }))
      .filter((element) => elementName(element) === 'WallPanel'
        && (element.props.position as number[] | undefined)?.[2] === backZ)

    const fanX = width * 0.37
    const openings = [
      [0, sill + windowHeight / 2],
      [-fanX, height * 0.81],
      [fanX, height * 0.81],
    ] as const

    for (const [x, y] of openings) {
      const coveredByWall = panels.some((panel) => {
        const [panelX, panelY] = panel.props.position as number[]
        const [panelWidth, panelHeight] = panel.props.size as number[]
        return Math.abs(x - panelX) < panelWidth / 2 && Math.abs(y - panelY) < panelHeight / 2
      })
      expect(coveredByWall, `rear-wall panel covers opening at x=${x}, y=${y}`).toBe(false)
    }
  })

  it('applies visible and transparent facade modes and removes the facade when hidden', () => {
    const snapshot = sceneSnapshot()
    const d = snapshot.simulation.room_dimensions
    const facade = (mode: 'visible' | 'transparent' | 'hidden') => elements(RoomShell({ snapshot, cutaway: mode }))
      .find((element) => elementName(element) === 'WallPanel'
        && (element.props.position as number[] | undefined)?.[0] === 0
        && (element.props.position as number[] | undefined)?.[1] === d.height_m / 2
        && (element.props.position as number[] | undefined)?.[2] === -d.depth_m / 2)

    const visibleFacade = facade('visible')!
    const transparentFacade = facade('transparent')!
    expect(facade('hidden')).toBeUndefined()

    const materialOpacity = (panel: SceneElement) => elements(
      (panel.type as (props: SceneElement['props']) => ReactNode)(panel.props),
    ).find((element) => element.type === 'meshStandardMaterial')?.props.opacity

    expect(materialOpacity(visibleFacade)).toBe(1)
    expect(materialOpacity(transparentFacade)).toBe(0.22)
  })
})
