import { describe, expect, it } from 'vitest'
import {
  CABINET_CABLE_PORTS,
  CONTROL_CABINET_MODULES,
  INDOOR_NODE_OFFSETS,
  OUTDOOR_NODE_OFFSETS,
  exteriorFanCenterZ,
  windowAssemblyGeometry,
  WINDOW_LIMIT_CONTACT_OFFSETS,
  WINDOW_REED_CONTACT_OFFSETS,
} from './models/geometry'
import { createWiringRoutes, wiringGeometryKey, type WiringSnapshot } from './wiringRoutes'

const snapshot: WiringSnapshot = {
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
    layout: {
      indoor_sensor_center: [-2.25, 2.05, 1.344],
      outdoor_station_center: [1.56, 2.36, 1.248],
      control_cabinet_center: [2.19, 2.02, 1.0],
      controller_drop_x: 1.8,
      rear_channel_y: 2.065,
      rear_wire_y: 2.018,
      exterior_channel_y: 2.215,
      exterior_wire_y: 2.215,
      trunk_z: 2.83,
      exterior_entry_x: 0.98,
      outdoor_gland_x: 1.41,
      outdoor_gland_z: 0.956,
      indoor_drop_x: -2.68,
    },
    mount_dimensions: {
      control_cabinet_width_m: 0.78,
      control_cabinet_height_m: 0.98,
      indoor_panel_width_m: 0.54,
      indoor_panel_height_m: 0.66,
    },
  },
}

function route(id: string) {
  const found = createWiringRoutes(snapshot).find((candidate) => candidate.id === id)
  expect(found, `route ${id}`).toBeDefined()
  return found!
}

function expectPointNear(actual: [number, number, number] | undefined, expected: [number, number, number]) {
  expect(actual).toBeDefined()
  actual!.forEach((coordinate, index) => expect(coordinate).toBeCloseTo(expected[index], 6))
}

function cabinetPin(portId: string): [number, number, number] {
  const port = CABINET_CABLE_PORTS[portId]
  const module = CONTROL_CABINET_MODULES.find(({ id }) => id === port.moduleId)!
  const { room_dimensions: dimensions, layout } = snapshot.simulation
  const innerFace = dimensions.depth_m / 2 - dimensions.wall_thickness_m / 2
  const cabinetFace = innerFace - 0.2
  return [
    layout.control_cabinet_center[0] + module.position[0] - port.position[0],
    layout.control_cabinet_center[2] + module.position[1] + port.position[1],
    cabinetFace + module.position[2] - port.position[2],
  ]
}

function outdoorPin(module: [number, number, number], pin: [number, number, number]): [number, number, number] {
  const root = snapshot.simulation.layout.outdoor_station_center
  return [root[0] + module[0] + pin[0], root[2] + module[1] + pin[1], root[1] + module[2] + pin[2]]
}

function indoorPin(module: [number, number, number], pin: [number, number, number]): [number, number, number] {
  const layout = snapshot.simulation.layout
  const root: [number, number, number] = [
    layout.indoor_sensor_center[0],
    layout.indoor_sensor_center[2],
    snapshot.simulation.room_dimensions.depth_m / 2 - snapshot.simulation.room_dimensions.wall_thickness_m / 2 - 0.041,
  ]
  return [root[0] + module[0] - pin[0], root[1] + module[1] + pin[1], root[2] + module[2] - pin[2]]
}

function windowContact(center: [number, number, number], offset: [number, number, number]): [number, number, number] {
  return [center[0] + offset[0], snapshot.simulation.room_dimensions.window_sill_height_m + center[1] + offset[1], snapshot.simulation.room_dimensions.depth_m / 2 + center[2] + offset[2]]
}

describe('web scene wiring routes', () => {
  it('creates unique finite routes for the complete cabinet, sensors and actuators', () => {
    const routes = createWiringRoutes(snapshot)
    const routeIds = routes.map(({ id }) => id)

    expect(routes.length).toBeGreaterThanOrEqual(50)
    expect(new Set(routeIds).size).toBe(routeIds.length)
    for (const current of routes) {
      expect(current.points.length).toBeGreaterThanOrEqual(2)
      expect(current.points.flat().every(Number.isFinite)).toBe(true)
      expect(current.points[0]).not.toEqual(current.points.at(-1))
    }
  })

  it('terminates each cabinet route at the actual visible screw or header pin', () => {
    for (const [routeId, portId] of [
      ['mains-live-psu', 'power.psu_12v.ac_live'],
      ['mains-neutral-psu', 'power.psu_12v.ac_neutral'],
      ['mains-earth-psu', 'power.psu_12v.protective_earth'],
      ['power12-psu-terminal', 'power.terminal_blocks.12v'],
      ['ground-psu-terminal', 'power.terminal_blocks.ground'],
      ['power12-fuse-fan-driver', 'power.mosfet_module.supply'],
      ['power12-fuse-hbridge', 'power.h_bridge.supply'],
      ['power12-fuse-dc-dc', 'power.dc_dc.input'],
      ['control-esp32-mosfet-intake', 'power.mosfet_module.intake_control'],
      ['control-esp32-mosfet-exhaust', 'power.mosfet_module.exhaust_control'],
      ['control-esp32-hbridge-open', 'power.h_bridge.control_open'],
      ['control-esp32-hbridge-close', 'power.h_bridge.control_close'],
    ] as const) {
      expectPointNear(route(routeId).points.at(-1), cabinetPin(portId))
    }

    expect(route('mains-live-psu').fromId).toBe('building.mains_230v')
    expect(route('power12-intake').fromId).toBe('power.mosfet_module')
    expect(route('power12-exhaust').fromId).toBe('power.mosfet_module')
    expect(createWiringRoutes(snapshot).some(({ fromId, toId }) => fromId === 'power.psu_12v' && toId.startsWith('fan.'))).toBe(false)
  })

  it('uses distinct pins for supply, ground and paired sensor buses', () => {
    const groups = [
      ['power3v3-indoor-scd41', 'ground-indoor-scd41', 'i2c-scd41-sda', 'i2c-scd41-scl'],
      ['power5-indoor-sps30', 'ground-indoor-sps30', 'uart-sps30-indoor-tx', 'uart-sps30-indoor-rx'],
      ['power3v3-outdoor-sht45', 'ground-outdoor-sht45', 'i2c-sht45-sda', 'i2c-sht45-scl'],
      ['power5-outdoor-sps30', 'ground-outdoor-sps30', 'uart-sps30-outdoor-tx', 'uart-sps30-outdoor-rx'],
    ]

    for (const ids of groups) {
      const ends = ids.map((id) => route(id).points.at(-1)!.join(','))
      expect(new Set(ends).size).toBe(ids.length)
    }
    expect(route('power3v3-indoor-scd41').kind).toBe('power3v3')
    expect(route('power3v3-outdoor-sht45').kind).toBe('power3v3')
    expect(route('power5-indoor-sps30').kind).toBe('power5')
    expect(route('power5-outdoor-sps30').kind).toBe('power5')
  })

  it('lands fuse wires on the outward-facing screw contacts and reserves a separate mains drop', () => {
    const { layout, mount_dimensions: mount } = snapshot.simulation
    const cabinetRight = layout.control_cabinet_center[0] + mount.control_cabinet_width_m / 2
    const mainsRoute = route('mains-live-psu')
    const mainsDropX = mainsRoute.points[0][0]
    const lvDropX = route('power12-intake').points[2][0]

    expect(mainsDropX).toBeGreaterThan(cabinetRight)
    expect(mainsDropX).not.toBeCloseTo(lvDropX, 3)

    const fuse = CONTROL_CABINET_MODULES.find(({ id }) => id === 'power.fuses')!
    const face = snapshot.simulation.room_dimensions.depth_m / 2
      - snapshot.simulation.room_dimensions.wall_thickness_m / 2
      - 0.2
    const visibleFuseScrew = [
      layout.control_cabinet_center[0] + fuse.position[0] - (-0.047),
      layout.control_cabinet_center[2] + fuse.position[1] + 0.027,
      face + fuse.position[2] - (0.015 + 0.008 + 0.006),
    ] as [number, number, number]
    expectPointNear(route('power12-fuse-feed').points.at(-1), visibleFuseScrew)
    expect(CABINET_CABLE_PORTS['power.fuses.f1_in'].position[2]).toBeCloseTo(0.029, 6)
  })

  it('routes exterior conductors inside the raceway and into the mounted node gland', () => {
    const current = route('i2c-sht45-sda')
    const outerFace = snapshot.simulation.room_dimensions.depth_m / 2 + snapshot.simulation.room_dimensions.wall_thickness_m / 2
    const gland = [
      snapshot.simulation.layout.outdoor_gland_x,
      snapshot.simulation.layout.outdoor_gland_z,
      outerFace + 0.04,
    ] as [number, number, number]

    expect(current.points.some((point) => Math.abs(point[2] - 1.995) < 0.001)).toBe(true)
    expect(current.points.some((point) => Math.abs(point[2] - snapshot.simulation.layout.exterior_channel_y) < 0.001)).toBe(true)
    expect(current.points.some((point) => point.every((value, index) => Math.abs(value - gland[index]) < 0.001))).toBe(true)
    expectPointNear(current.points.at(-1), outdoorPin(OUTDOOR_NODE_OFFSETS.sht45.module, OUTDOOR_NODE_OFFSETS.sht45.pins.sda))
    expectPointNear(route('uart-sps30-outdoor-rx').points.at(-1), outdoorPin(OUTDOOR_NODE_OFFSETS.sps30.module, OUTDOOR_NODE_OFFSETS.sps30.pins.rx))
  })

  it('keeps fans, window drive and limit-switch wiring on separate device contacts', () => {
    const motorA = route('motor-window-lead-a')
    const motorB = route('motor-window-lead-b')
    expect(motorA.fromId).toBe('power.h_bridge')
    expect(motorB.fromId).toBe('power.h_bridge')
    expect(motorA.points.at(-1)).not.toEqual(motorB.points.at(-1))
    expect(route('ground-reed-switch').points.at(-1)).not.toEqual(route('signal-window-reed').points.at(-1))
    expect(route('ground-window-limit-open').points.at(-1)).not.toEqual(route('signal-window-limit-open').points.at(-1))
    expect(route('ground-window-limit-close').points.at(-1)).not.toEqual(route('signal-window-limit-close').points.at(-1))

    const { room_dimensions: dimensions } = snapshot.simulation
    const exteriorWallFace = dimensions.depth_m / 2 + dimensions.wall_thickness_m / 2
    for (const [id, isIntake] of [['fan.intake', true], ['fan.exhaust', false]] as const) {
      const housingDepth = isIntake ? 0.104 : 0.075
      const center = exteriorFanCenterZ(dimensions.depth_m, dimensions.wall_thickness_m, isIntake)
      expect(center - housingDepth / 2).toBeCloseTo(exteriorWallFace + 0.006, 6)
      expect(route(id === 'fan.intake' ? 'power12-intake' : 'power12-exhaust').toId).toBe(id)
    }
  })

  it('mounts the sash magnet beside the fixed reed and wires each switch to its visible contact', () => {
    const dimensions = snapshot.simulation.room_dimensions
    const geometry = windowAssemblyGeometry(dimensions)
    const closedMagnet = [
      geometry.magnetLocal[0],
      dimensions.window_sill_height_m + geometry.magnetLocal[1],
      dimensions.depth_m / 2 + geometry.sashPlaneZ + geometry.magnetLocal[2],
    ] as [number, number, number]
    const fixedReed = [
      geometry.reedCenter[0],
      dimensions.window_sill_height_m + geometry.reedCenter[1],
      dimensions.depth_m / 2 + geometry.reedCenter[2],
    ] as [number, number, number]
    const closedGap = Math.hypot(...closedMagnet.map((coordinate, index) => coordinate - fixedReed[index]))
    const openY = geometry.magnetLocal[1] * Math.cos(geometry.openingAngle) - geometry.magnetLocal[2] * Math.sin(geometry.openingAngle)
    const openZ = dimensions.depth_m / 2 + geometry.sashPlaneZ
      + geometry.magnetLocal[1] * Math.sin(geometry.openingAngle)
      + geometry.magnetLocal[2] * Math.cos(geometry.openingAngle)
    const openGap = Math.hypot(geometry.magnetLocal[0] - geometry.reedCenter[0], openY - fixedReed[1], openZ - fixedReed[2])

    expect(closedGap).toBeLessThan(0.06)
    expect(openGap).toBeGreaterThan(0.25)
    expectPointNear(route('signal-window-reed').points.at(-1), windowContact(geometry.reedCenter, WINDOW_REED_CONTACT_OFFSETS[0]))
    expectPointNear(route('ground-reed-switch').points.at(-1), windowContact(geometry.reedCenter, WINDOW_REED_CONTACT_OFFSETS[1]))
    expectPointNear(route('signal-window-limit-open').points.at(-1), windowContact(geometry.openLimitCenter, WINDOW_LIMIT_CONTACT_OFFSETS[0]))
    expectPointNear(route('ground-window-limit-close').points.at(-1), windowContact(geometry.closeLimitCenter, WINDOW_LIMIT_CONTACT_OFFSETS[1]))
  })

  it('terminates indoor sensor wires at the rotated sensor connector contacts', () => {
    expectPointNear(route('power3v3-indoor-scd41').points.at(-1), indoorPin(INDOOR_NODE_OFFSETS.scd41.module, INDOOR_NODE_OFFSETS.scd41.pins.power))
    expectPointNear(route('i2c-scd41-scl').points.at(-1), indoorPin(INDOOR_NODE_OFFSETS.scd41.module, INDOOR_NODE_OFFSETS.scd41.pins.scl))
    expectPointNear(route('uart-sps30-indoor-rx').points.at(-1), indoorPin(INDOOR_NODE_OFFSETS.sps30.module, INDOOR_NODE_OFFSETS.sps30.pins.rx))
  })

  it('keeps geometry keys stable for equivalent layout snapshots', () => {
    const before = wiringGeometryKey(snapshot)
    const sameGeometry = {
      ...snapshot,
      simulation: { ...snapshot.simulation, layout: { ...snapshot.simulation.layout } },
    }

    expect(wiringGeometryKey(sameGeometry)).toBe(before)
    expect(wiringGeometryKey({
      ...snapshot,
      simulation: { ...snapshot.simulation, layout: { ...snapshot.simulation.layout, trunk_z: 2.82 } },
    })).not.toBe(before)
  })
})
