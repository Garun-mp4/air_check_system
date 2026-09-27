import type { SimulatorSnapshot } from '../types'
import {
  CABINET_CABLE_PORTS,
  CONTROL_CABINET_MODULES,
  INDOOR_NODE_OFFSETS,
  OUTDOOR_NODE_OFFSETS,
  type Point3,
} from './models/geometry'

export type { Point3 }
export type WireKind = 'power12' | 'ground' | 'power5' | 'i2c' | 'uart' | 'control'

export interface WireRoute {
  id: string
  fromId: string
  toId: string
  kind: WireKind
  points: Point3[]
}

type WiringSimulation = Pick<SimulatorSnapshot['simulation'], 'room_dimensions' | 'layout' | 'mount_dimensions'>
export type WiringSnapshot = {
  simulation: WiringSimulation
}

const WIRE_COLORS: Record<WireKind, string> = {
  power12: '#bd574d',
  ground: '#394648',
  power5: '#dc9b43',
  i2c: '#398aa0',
  uart: '#287c71',
  control: '#b98737',
}

const EPSILON = 0.0001

export function wireColor(kind: WireKind): string {
  return WIRE_COLORS[kind]
}

export function wiringGeometryKey(snapshot: WiringSnapshot): string {
  const { room_dimensions: d, layout, mount_dimensions: mount } = snapshot.simulation
  return [
    d.width_m, d.depth_m, d.height_m, d.wall_thickness_m,
    d.window_width_m, d.window_height_m, d.window_sill_height_m, d.window_open_angle_degrees,
    ...Object.values(layout).flatMap((value) => Array.isArray(value) ? value : [value]),
    mount.control_cabinet_width_m, mount.control_cabinet_height_m,
    mount.indoor_panel_width_m, mount.indoor_panel_height_m,
  ].join(':')
}

export function createWiringRoutes(snapshot: WiringSnapshot): WireRoute[] {
  const { room_dimensions: d, layout, mount_dimensions: mount } = snapshot.simulation
  const innerFace = d.depth_m / 2 - d.wall_thickness_m / 2
  const outerFace = d.depth_m / 2 + d.wall_thickness_m / 2
  const insideWireZ = innerFace - 0.025
  const outsideWireZ = layout.exterior_channel_y
  const trunkY = layout.trunk_z
  const cabinetX = layout.control_cabinet_center[0]
  const cabinetY = layout.control_cabinet_center[2]
  const cabinetFace = innerFace - 0.200
  const controllerDropX = layout.controller_drop_x
  const indoorRoot: Point3 = [
    layout.indoor_sensor_center[0],
    layout.indoor_sensor_center[2],
    innerFace - 0.041,
  ]
  const outdoorRoot: Point3 = [
    layout.outdoor_station_center[0],
    layout.outdoor_station_center[2],
    layout.outdoor_station_center[1],
  ]
  const cabinetModules = new Map(CONTROL_CABINET_MODULES.map((module) => [module.id, module]))

  const cabinetPort = (id: keyof typeof CABINET_CABLE_PORTS): Point3 => {
    const module = cabinetModules.get(id)
    const connector = CABINET_CABLE_PORTS[id]
    if (!module || !connector) throw new Error(`Missing cabinet cable port: ${id}`)
    return [
      cabinetX + module.position[0] - connector[0],
      cabinetY + module.position[1] + connector[1],
      cabinetFace + module.position[2] - connector[2],
    ]
  }

  const indoorPort = (moduleOffset: Point3, connectorOffset: Point3): Point3 => [
    indoorRoot[0] + moduleOffset[0] - connectorOffset[0],
    indoorRoot[1] + moduleOffset[1] + connectorOffset[1],
    indoorRoot[2] + moduleOffset[2] - connectorOffset[2],
  ]
  const outdoorPort = (moduleOffset: Point3, connectorOffset: Point3): Point3 => [
    outdoorRoot[0] + moduleOffset[0] + connectorOffset[0],
    outdoorRoot[1] + moduleOffset[1] + connectorOffset[1],
    outdoorRoot[2] + moduleOffset[2] + connectorOffset[2],
  ]

  const fanY = d.height_m * 0.81
  const fanX = d.width_m * 0.37
  const fanDepth = innerFace - 0.11
  const fanPort = (side: -1 | 1): Point3 => [side * fanX + 0.083, fanY - 0.109, fanDepth + 0.065]
  const actuatorBase: Point3 = [0, d.window_sill_height_m + 0.13, innerFace - 0.245]
  const sashWidth = d.window_width_m - 0.07
  const sashHeight = d.window_height_m - 0.07
  const sashPlaneZ = -d.wall_thickness_m / 2 - 0.022
  const openingAngle = d.window_open_angle_degrees * Math.PI / 180
  const openLimitLocal = rotateAboutBottom([sashWidth * 0.38, sashHeight - 0.07, 0.028], openingAngle)
  const windowRootZ = d.depth_m / 2
  const reedPort: Point3 = [
    sashWidth * 0.31 - 0.08,
    d.window_sill_height_m + 0.31 - 0.012,
    windowRootZ + sashPlaneZ + 0.032 + 0.010,
  ]
  const closeLimitPort: Point3 = [
    sashWidth * 0.34,
    d.window_sill_height_m + 0.040 + 0.030,
    windowRootZ + sashPlaneZ - 0.065 + 0.010,
  ]
  const openLimitPort: Point3 = [
    openLimitLocal[0],
    d.window_sill_height_m + openLimitLocal[1],
    windowRootZ + sashPlaneZ + openLimitLocal[2] + 0.04 + 0.015,
  ]
  const outdoorGland = addPoint(outdoorRoot, OUTDOOR_NODE_OFFSETS.cableGland)
  const outdoorGlandHeight = layout.outdoor_gland_z
  const outdoorRacewayZ = layout.exterior_channel_y
  const outsideEntryX = layout.exterior_entry_x
  const outsideGlandX = layout.outdoor_gland_x

  const routeInside = (
    id: string,
    fromId: string,
    toId: string,
    kind: WireKind,
    source: Point3,
    target: Point3,
    dropX: number,
  ): WireRoute => makeRoute(id, fromId, toId, kind, [
    source,
    [source[0], source[1], insideWireZ],
    [controllerDropX, source[1], insideWireZ],
    [controllerDropX, trunkY, insideWireZ],
    [dropX, trunkY, insideWireZ],
    [dropX, target[1], insideWireZ],
    [target[0], target[1], insideWireZ],
    target,
  ])

  const routeCabinet = (id: string, fromId: keyof typeof CABINET_CABLE_PORTS, toId: keyof typeof CABINET_CABLE_PORTS, kind: WireKind): WireRoute => makeRoute(
    id, fromId, toId, kind, [cabinetPort(fromId), cabinetPort(toId)],
  )

  const routeOutside = (
    id: string,
    fromId: string,
    toId: string,
    kind: WireKind,
    source: Point3,
    target: Point3,
  ): WireRoute => makeRoute(id, fromId, toId, kind, [
    source,
    [source[0], source[1], insideWireZ],
    [controllerDropX, source[1], insideWireZ],
    [controllerDropX, trunkY, insideWireZ],
    [outsideEntryX, trunkY, insideWireZ],
    [outsideEntryX, trunkY, outsideWireZ],
    [outsideGlandX, trunkY, outsideWireZ],
    [outsideGlandX, outdoorGlandHeight, outsideWireZ],
    [outsideGlandX, outdoorGlandHeight, outdoorGland[2]],
    outdoorGland,
    [outdoorGland[0], target[1], outdoorGland[2]],
    [target[0], target[1], target[2]],
    target,
  ])

  const psu = cabinetPort('power.psu_12v')
  const dc = cabinetPort('power.dc_dc')
  const esp = cabinetPort('device.esp32')
  const mosfet = cabinetPort('power.mosfet_module')
  const hbridge = cabinetPort('power.h_bridge')
  const terminals = cabinetPort('power.terminal_blocks')
  const indoorSCD = indoorPort(INDOOR_NODE_OFFSETS.scd41.module, INDOOR_NODE_OFFSETS.scd41.connector)
  const indoorSPS = indoorPort(INDOOR_NODE_OFFSETS.sps30.module, INDOOR_NODE_OFFSETS.sps30.connector)
  const outdoorSHT = outdoorPort(OUTDOOR_NODE_OFFSETS.sht45.module, OUTDOOR_NODE_OFFSETS.sht45.connector)
  const outdoorSPS = outdoorPort(OUTDOOR_NODE_OFFSETS.sps30.module, OUTDOOR_NODE_OFFSETS.sps30.connector)
  const windowX = (target: Point3) => Math.max(-d.window_width_m / 2 - 0.08, Math.min(d.window_width_m / 2 + 0.08, target[0]))

  const routes = [
    routeInside('power12-intake', 'power.psu_12v', 'fan.intake', 'power12', psu, fanPort(-1), -fanX),
    routeInside('power12-exhaust', 'power.psu_12v', 'fan.exhaust', 'power12', psu, fanPort(1), fanX),
    routeCabinet('power12-window', 'power.psu_12v', 'power.h_bridge', 'power12'),
    routeInside('power12-window-actuator', 'power.h_bridge', 'window.actuator', 'power12', hbridge, actuatorBase, 0),
    routeCabinet('power12-buck', 'power.psu_12v', 'power.dc_dc', 'power12'),
    routeCabinet('power5-esp32', 'power.dc_dc', 'device.esp32', 'power5'),
    routeInside('power5-indoor-scd41', 'power.dc_dc', 'sensor.scd41.indoor', 'power5', dc, indoorSCD, layout.indoor_drop_x),
    routeInside('power5-indoor-sps30', 'power.dc_dc', 'sensor.sps30.indoor', 'power5', dc, indoorSPS, layout.indoor_drop_x),
    routeOutside('power5-outdoor-sht45', 'power.dc_dc', 'sensor.sht45.outdoor', 'power5', dc, outdoorSHT),
    routeOutside('power5-outdoor-sps30', 'power.dc_dc', 'sensor.sps30.outdoor', 'power5', dc, outdoorSPS),
    routeInside('ground-intake', 'power.terminal_blocks', 'fan.intake', 'ground', terminals, fanPort(-1), -fanX),
    routeInside('ground-exhaust', 'power.terminal_blocks', 'fan.exhaust', 'ground', terminals, fanPort(1), fanX),
    routeInside('ground-window', 'power.terminal_blocks', 'window.actuator', 'ground', terminals, actuatorBase, 0),
    routeCabinet('ground-esp32', 'power.terminal_blocks', 'device.esp32', 'ground'),
    routeInside('ground-indoor-scd41', 'power.terminal_blocks', 'sensor.scd41.indoor', 'ground', terminals, indoorSCD, layout.indoor_drop_x),
    routeInside('ground-indoor-sps30', 'power.terminal_blocks', 'sensor.sps30.indoor', 'ground', terminals, indoorSPS, layout.indoor_drop_x),
    routeOutside('ground-outdoor-sht45', 'power.terminal_blocks', 'sensor.sht45.outdoor', 'ground', terminals, outdoorSHT),
    routeOutside('ground-outdoor-sps30', 'power.terminal_blocks', 'sensor.sps30.outdoor', 'ground', terminals, outdoorSPS),
    routeInside('i2c-scd41-indoor', 'device.esp32', 'sensor.scd41.indoor', 'i2c', esp, indoorSCD, layout.indoor_drop_x),
    routeInside('uart-sps30-indoor', 'device.esp32', 'sensor.sps30.indoor', 'uart', esp, indoorSPS, layout.indoor_drop_x),
    routeOutside('i2c-sht45-outdoor', 'device.esp32', 'sensor.sht45.outdoor', 'i2c', esp, outdoorSHT),
    routeOutside('uart-sps30-outdoor', 'device.esp32', 'sensor.sps30.outdoor', 'uart', esp, outdoorSPS),
    routeCabinet('control-esp32-mosfet', 'device.esp32', 'power.mosfet_module', 'control'),
    routeInside('control-mosfet-intake', 'power.mosfet_module', 'fan.intake', 'control', mosfet, fanPort(-1), -fanX),
    routeInside('control-mosfet-exhaust', 'power.mosfet_module', 'fan.exhaust', 'control', mosfet, fanPort(1), fanX),
    routeCabinet('control-esp32-hbridge', 'device.esp32', 'power.h_bridge', 'control'),
    routeInside('control-hbridge-window', 'power.h_bridge', 'window.actuator', 'control', hbridge, actuatorBase, 0),
    routeInside('signal-window-reed', 'device.esp32', 'window.reed_switch', 'control', esp, reedPort, windowX(reedPort)),
    routeInside('signal-window-limit-close', 'device.esp32', 'window.limit_close', 'control', esp, closeLimitPort, windowX(closeLimitPort)),
    routeInside('signal-window-limit-open', 'device.esp32', 'window.limit_open', 'control', esp, openLimitPort, windowX(openLimitPort)),
  ]

  const cabinetTop = cabinetY + mount.control_cabinet_height_m / 2
  if (cabinetTop >= trunkY) throw new Error('Controller cabinet must remain below the cable trunk')
  return routes
}

function makeRoute(id: string, fromId: string, toId: string, kind: WireKind, points: Point3[]): WireRoute {
  const compact = points.filter((point, index) => index === 0 || !samePoint(points[index - 1], point))
  if (compact.some((point) => point.some((coordinate) => !Number.isFinite(coordinate)))) {
    throw new Error(`Wire route ${id} contains a non-finite point`)
  }
  return { id, fromId, toId, kind, points: compact }
}

function samePoint(first: Point3, second: Point3): boolean {
  return first.every((coordinate, index) => Math.abs(coordinate - second[index]) < EPSILON)
}

function addPoint(first: Point3, second: Point3): Point3 {
  return [first[0] + second[0], first[1] + second[1], first[2] + second[2]]
}

function rotateAboutBottom(point: Point3, angle: number): Point3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return [point[0], point[1] * cosine - point[2] * sine, point[1] * sine + point[2] * cosine]
}
