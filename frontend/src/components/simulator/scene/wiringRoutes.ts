import type { SimulatorSnapshot } from '../types'
import {
  CABINET_CABLE_PORTS,
  CONTROL_CABINET_MODULES,
  FAN_CABLE_OFFSETS,
  MAINS_ENTRY_CLEARANCE_M,
  INDOOR_NODE_OFFSETS,
  OUTDOOR_NODE_OFFSETS,
  WINDOW_LIMIT_CONTACT_OFFSETS,
  WINDOW_REED_CONTACT_OFFSETS,
  WINDOW_ACTUATOR_WIRE_OFFSETS,
  windowAssemblyGeometry,
  type Point3,
} from './models/geometry'

export type { Point3 }
export type WireKind = 'mains_live' | 'mains_neutral' | 'protective_earth' | 'power12' | 'power5' | 'power3v3' | 'ground' | 'i2c' | 'uart' | 'control' | 'motor' | 'motor_return'

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
  mains_live: '#8c4c3e',
  mains_neutral: '#4c78a5',
  protective_earth: '#5a9c52',
  power12: '#bd574d',
  ground: '#394648',
  power5: '#dc9b43',
  power3v3: '#c69a44',
  i2c: '#398aa0',
  uart: '#287c71',
  control: '#b98737',
  motor: '#bc5146',
  motor_return: '#465154',
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

/** Convert a device-local terminal coordinate into the scene's x/height/depth frame. */
export function cabinetPortPosition(snapshot: WiringSnapshot, portId: string): Point3 {
  const port = CABINET_CABLE_PORTS[portId]
  if (!port) throw new Error(`Missing cabinet cable port: ${portId}`)
  const module = CONTROL_CABINET_MODULES.find(({ id }) => id === port.moduleId)
  if (!module) throw new Error(`Missing cabinet module for cable port: ${portId}`)

  const { room_dimensions: d, layout } = snapshot.simulation
  const cabinetX = layout.control_cabinet_center[0]
  const cabinetY = layout.control_cabinet_center[2]
  const innerFace = d.depth_m / 2 - d.wall_thickness_m / 2
  const cabinetFace = innerFace - 0.200
  return [
    cabinetX + module.position[0] - port.position[0],
    cabinetY + module.position[1] + port.position[1],
    cabinetFace + module.position[2] - port.position[2],
  ]
}

export function createWiringRoutes(snapshot: WiringSnapshot): WireRoute[] {
  const { room_dimensions: d, layout } = snapshot.simulation
  const innerFace = d.depth_m / 2 - d.wall_thickness_m / 2
  const insideWireZ = innerFace - 0.025
  const outsideWireZ = layout.exterior_wire_y
  const trunkY = layout.trunk_z
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
  const windowGeometry = windowAssemblyGeometry(d)
  const cabinetTop = layout.control_cabinet_center[2] + snapshot.simulation.mount_dimensions.control_cabinet_height_m / 2
  const mainsEntryX = layout.control_cabinet_center[0] + snapshot.simulation.mount_dimensions.control_cabinet_width_m / 2 + MAINS_ENTRY_CLEARANCE_M

  const cabinetModuleId = (portId: string): string => {
    const port = CABINET_CABLE_PORTS[portId]
    if (!port) throw new Error(`Missing cabinet cable port: ${portId}`)
    return port.moduleId
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
  const windowWorldPoint = (local: Point3): Point3 => [
    local[0],
    d.window_sill_height_m + local[1],
    d.depth_m / 2 + local[2],
  ]

  const fanY = d.height_m * 0.81
  const fanX = d.width_m * 0.37
  const fanDepth = innerFace - 0.11
  const fanPort = (side: -1 | 1, lead: 0 | 1): Point3 => [
    side * fanX + FAN_CABLE_OFFSETS[lead][0],
    fanY + FAN_CABLE_OFFSETS[lead][1],
    fanDepth + FAN_CABLE_OFFSETS[lead][2],
  ]
  const actuatorBase = windowWorldPoint(windowGeometry.actuatorBase)
  const actuatorPorts = WINDOW_ACTUATOR_WIRE_OFFSETS.map((offset) => addPoint(actuatorBase, offset)) as [Point3, Point3]
  const reedContacts = WINDOW_REED_CONTACT_OFFSETS.map((offset) => windowWorldPoint(addPoint(windowGeometry.reedCenter, offset))) as [Point3, Point3]
  const openLimitContacts = WINDOW_LIMIT_CONTACT_OFFSETS.map((offset) => windowWorldPoint(addPoint(windowGeometry.openLimitCenter, offset))) as [Point3, Point3]
  const closeLimitContacts = WINDOW_LIMIT_CONTACT_OFFSETS.map((offset) => windowWorldPoint(addPoint(windowGeometry.closeLimitCenter, offset))) as [Point3, Point3]
  const outdoorGland = addPoint(outdoorRoot, OUTDOOR_NODE_OFFSETS.cableGland)
  const outdoorGlandHeight = layout.outdoor_gland_z
  const outdoorRacewayZ = layout.exterior_channel_y
  const outsideEntryX = layout.exterior_entry_x
  const outsideGlandX = layout.outdoor_gland_x

  const routeInside = (
    id: string,
    fromPortId: string,
    toId: string,
    kind: WireKind,
    target: Point3,
    dropX: number,
  ): WireRoute => {
    const source = cabinetPortPosition(snapshot, fromPortId)
    return makeRoute(id, cabinetModuleId(fromPortId), toId, kind, [
      source,
      [source[0], source[1], insideWireZ],
      [controllerDropX, source[1], insideWireZ],
      [controllerDropX, trunkY, insideWireZ],
      [dropX, trunkY, insideWireZ],
      [dropX, target[1], insideWireZ],
      [target[0], target[1], insideWireZ],
      target,
    ])
  }

  const routeCabinet = (id: string, fromPortId: string, toPortId: string, kind: WireKind): WireRoute => {
    const source = cabinetPortPosition(snapshot, fromPortId)
    const target = cabinetPortPosition(snapshot, toPortId)
    return makeRoute(id, cabinetModuleId(fromPortId), cabinetModuleId(toPortId), kind, [source, target])
  }

  const routeOutside = (
    id: string,
    fromPortId: string,
    toId: string,
    kind: WireKind,
    target: Point3,
  ): WireRoute => {
    const source = cabinetPortPosition(snapshot, fromPortId)
    return makeRoute(id, cabinetModuleId(fromPortId), toId, kind, [
      source,
      [source[0], source[1], insideWireZ],
      [controllerDropX, source[1], insideWireZ],
      [controllerDropX, trunkY, insideWireZ],
      [outsideEntryX, trunkY, insideWireZ],
      [outsideEntryX, trunkY, outsideWireZ],
      [outsideGlandX, trunkY, outsideWireZ],
      [outsideGlandX, outdoorGlandHeight, outsideWireZ],
      [outsideGlandX, outdoorGlandHeight, outdoorRacewayZ],
      outdoorGland,
      [outdoorGland[0], target[1], outdoorGland[2]],
      [target[0], target[1], target[2]],
      target,
    ])
  }

  const routeMains = (id: string, toPortId: string, kind: WireKind, lane: number): WireRoute => {
    const sourceX = mainsEntryX + lane * 0.008
    const source: Point3 = [sourceX, d.height_m, insideWireZ]
    const target = cabinetPortPosition(snapshot, toPortId)
    const cabinetEntryY = cabinetTop + 0.025
    return makeRoute(id, 'building.mains_230v', 'power.psu_12v', kind, [
      source,
      [sourceX, cabinetEntryY, insideWireZ],
      [target[0], cabinetEntryY, insideWireZ],
      [target[0], target[1], insideWireZ],
      target,
    ])
  }

  const indoorSCD = (pin: Point3) => indoorPort(INDOOR_NODE_OFFSETS.scd41.module, pin)
  const indoorSPS = (pin: Point3) => indoorPort(INDOOR_NODE_OFFSETS.sps30.module, pin)
  const outdoorSHT = (pin: Point3) => outdoorPort(OUTDOOR_NODE_OFFSETS.sht45.module, pin)
  const outdoorSPS = (pin: Point3) => outdoorPort(OUTDOOR_NODE_OFFSETS.sps30.module, pin)
  const windowX = (target: Point3) => Math.max(-d.window_width_m / 2 - 0.08, Math.min(d.window_width_m / 2 + 0.08, target[0]))

  const routes = [
    // A three-core mains feed uses a dedicated route and terminates at PSU L/N/PE.
    routeMains('mains-live-psu', 'power.psu_12v.ac_live', 'mains_live', -1),
    routeMains('mains-neutral-psu', 'power.psu_12v.ac_neutral', 'mains_neutral', 0),
    routeMains('mains-earth-psu', 'power.psu_12v.protective_earth', 'protective_earth', 1),

    // The 12 V and GND outputs terminate at their correctly coloured distribution terminals.
    routeCabinet('power12-psu-terminal', 'power.psu_12v.12v', 'power.terminal_blocks.12v', 'power12'),
    routeCabinet('ground-psu-terminal', 'power.psu_12v.ground', 'power.terminal_blocks.ground', 'ground'),

    // Three protected branches feed the fan driver, window H-bridge and 12-to-5 V converter.
    routeCabinet('power12-fuse-feed', 'power.terminal_blocks.12v', 'power.fuses.f1_in', 'power12'),
    routeCabinet('power12-fuse-bus-f1-f2', 'power.fuses.f1_in', 'power.fuses.f2_in', 'power12'),
    routeCabinet('power12-fuse-bus-f2-f3', 'power.fuses.f2_in', 'power.fuses.f3_in', 'power12'),
    routeCabinet('power12-fuse-fan-driver', 'power.fuses.f1_out', 'power.mosfet_module.supply', 'power12'),
    routeCabinet('power12-fuse-hbridge', 'power.fuses.f2_out', 'power.h_bridge.supply', 'power12'),
    routeCabinet('power12-fuse-dc-dc', 'power.fuses.f3_out', 'power.dc_dc.input', 'power12'),
    routeCabinet('ground-terminal-dc-dc-input', 'power.terminal_blocks.ground', 'power.dc_dc.input_ground', 'ground'),
    routeCabinet('ground-terminal-dc-dc-output', 'power.dc_dc.output_ground', 'power.terminal_blocks.ground', 'ground'),
    routeCabinet('ground-terminal-mosfet', 'power.terminal_blocks.ground', 'power.mosfet_module.ground', 'ground'),
    routeCabinet('ground-terminal-hbridge', 'power.terminal_blocks.ground', 'power.h_bridge.ground', 'ground'),
    routeCabinet('power5-dc-dc-terminal', 'power.dc_dc.output', 'power.terminal_blocks.5v', 'power5'),

    // The two MOSFET outputs, rather than direct PSU bypasses, feed the fans.
    routeInside('power12-intake', 'power.mosfet_module.intake', 'fan.intake', 'power12', fanPort(-1, 0), -fanX),
    routeInside('power12-exhaust', 'power.mosfet_module.exhaust', 'fan.exhaust', 'power12', fanPort(1, 0), fanX),
    routeInside('ground-intake', 'power.terminal_blocks.ground', 'fan.intake', 'ground', fanPort(-1, 1), -fanX),
    routeInside('ground-exhaust', 'power.terminal_blocks.ground', 'fan.exhaust', 'ground', fanPort(1, 1), fanX),
    routeCabinet('control-esp32-mosfet-intake', 'device.esp32.mosfet_intake', 'power.mosfet_module.intake_control', 'control'),
    routeCabinet('control-esp32-mosfet-exhaust', 'device.esp32.mosfet_exhaust', 'power.mosfet_module.exhaust_control', 'control'),

    routeCabinet('control-esp32-hbridge-open', 'device.esp32.hbridge_open', 'power.h_bridge.control_open', 'control'),
    routeCabinet('control-esp32-hbridge-close', 'device.esp32.hbridge_close', 'power.h_bridge.control_close', 'control'),
    routeInside('motor-window-lead-a', 'power.h_bridge.motor_a', 'window.actuator', 'motor', actuatorPorts[0], 0),
    routeInside('motor-window-lead-b', 'power.h_bridge.motor_b', 'window.actuator', 'motor_return', actuatorPorts[1], 0),

    routeCabinet('power5-esp32', 'power.terminal_blocks.5v', 'device.esp32.5v', 'power5'),
    routeCabinet('ground-esp32', 'power.terminal_blocks.ground', 'device.esp32.ground', 'ground'),

    // SCD41/SHT45 use the ESP32's 3.3 V rail; SPS30 modules require 5 V.
    routeInside('power3v3-indoor-scd41', 'device.esp32.3v3', 'sensor.scd41.indoor', 'power3v3', indoorSCD(INDOOR_NODE_OFFSETS.scd41.pins.power), layout.indoor_drop_x),
    routeOutside('power3v3-outdoor-sht45', 'device.esp32.3v3', 'sensor.sht45.outdoor', 'power3v3', outdoorSHT(OUTDOOR_NODE_OFFSETS.sht45.pins.power)),
    routeInside('power5-indoor-sps30', 'power.terminal_blocks.5v', 'sensor.sps30.indoor', 'power5', indoorSPS(INDOOR_NODE_OFFSETS.sps30.pins.power), layout.indoor_drop_x),
    routeOutside('power5-outdoor-sps30', 'power.terminal_blocks.5v', 'sensor.sps30.outdoor', 'power5', outdoorSPS(OUTDOOR_NODE_OFFSETS.sps30.pins.power)),
    routeInside('ground-indoor-scd41', 'power.terminal_blocks.ground', 'sensor.scd41.indoor', 'ground', indoorSCD(INDOOR_NODE_OFFSETS.scd41.pins.ground), layout.indoor_drop_x),
    routeInside('ground-indoor-sps30', 'power.terminal_blocks.ground', 'sensor.sps30.indoor', 'ground', indoorSPS(INDOOR_NODE_OFFSETS.sps30.pins.ground), layout.indoor_drop_x),
    routeOutside('ground-outdoor-sht45', 'power.terminal_blocks.ground', 'sensor.sht45.outdoor', 'ground', outdoorSHT(OUTDOOR_NODE_OFFSETS.sht45.pins.ground)),
    routeOutside('ground-outdoor-sps30', 'power.terminal_blocks.ground', 'sensor.sps30.outdoor', 'ground', outdoorSPS(OUTDOOR_NODE_OFFSETS.sps30.pins.ground)),

    routeInside('i2c-scd41-sda', 'device.esp32.i2c_sda', 'sensor.scd41.indoor', 'i2c', indoorSCD(INDOOR_NODE_OFFSETS.scd41.pins.sda), layout.indoor_drop_x),
    routeInside('i2c-scd41-scl', 'device.esp32.i2c_scl', 'sensor.scd41.indoor', 'i2c', indoorSCD(INDOOR_NODE_OFFSETS.scd41.pins.scl), layout.indoor_drop_x),
    routeOutside('i2c-sht45-sda', 'device.esp32.i2c_sda', 'sensor.sht45.outdoor', 'i2c', outdoorSHT(OUTDOOR_NODE_OFFSETS.sht45.pins.sda)),
    routeOutside('i2c-sht45-scl', 'device.esp32.i2c_scl', 'sensor.sht45.outdoor', 'i2c', outdoorSHT(OUTDOOR_NODE_OFFSETS.sht45.pins.scl)),
    routeInside('uart-sps30-indoor-tx', 'device.esp32.uart_indoor_tx', 'sensor.sps30.indoor', 'uart', indoorSPS(INDOOR_NODE_OFFSETS.sps30.pins.tx), layout.indoor_drop_x),
    routeInside('uart-sps30-indoor-rx', 'device.esp32.uart_indoor_rx', 'sensor.sps30.indoor', 'uart', indoorSPS(INDOOR_NODE_OFFSETS.sps30.pins.rx), layout.indoor_drop_x),
    routeOutside('uart-sps30-outdoor-tx', 'device.esp32.uart_outdoor_tx', 'sensor.sps30.outdoor', 'uart', outdoorSPS(OUTDOOR_NODE_OFFSETS.sps30.pins.tx)),
    routeOutside('uart-sps30-outdoor-rx', 'device.esp32.uart_outdoor_rx', 'sensor.sps30.outdoor', 'uart', outdoorSPS(OUTDOOR_NODE_OFFSETS.sps30.pins.rx)),

    routeInside('ground-reed-switch', 'power.terminal_blocks.ground', 'window.reed_switch', 'ground', reedContacts[1], windowX(reedContacts[1])),
    routeInside('signal-window-reed', 'device.esp32.reed_input', 'window.reed_switch', 'control', reedContacts[0], windowX(reedContacts[0])),
    routeInside('ground-window-limit-close', 'power.terminal_blocks.ground', 'window.limit_close', 'ground', closeLimitContacts[1], windowX(closeLimitContacts[1])),
    routeInside('signal-window-limit-close', 'device.esp32.limit_close_input', 'window.limit_close', 'control', closeLimitContacts[0], windowX(closeLimitContacts[0])),
    routeInside('ground-window-limit-open', 'power.terminal_blocks.ground', 'window.limit_open', 'ground', openLimitContacts[1], windowX(openLimitContacts[1])),
    routeInside('signal-window-limit-open', 'device.esp32.limit_open_input', 'window.limit_open', 'control', openLimitContacts[0], windowX(openLimitContacts[0])),
  ]

  if (cabinetTop >= trunkY) throw new Error('Controller cabinet must remain below the cable trunk')
  if (Math.abs(outdoorGland[0] - outsideGlandX) > 0.001 || Math.abs(outdoorGland[2] - outdoorRacewayZ) > 0.01) {
    throw new Error('Outdoor cable gland must meet the exterior raceway')
  }
  if (Math.abs(outsideWireZ - outdoorRacewayZ) > EPSILON) {
    throw new Error('Outdoor conductors must stay inside the exterior raceway')
  }
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
