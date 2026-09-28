export type Point3 = [number, number, number]
type WindowGeometryInput = {
  depth_m: number
  wall_thickness_m: number
  window_width_m: number
  window_height_m: number
  window_sill_height_m: number
  window_open_angle_degrees: number
}

export type CabinetModuleKind = 'esp' | 'psu' | 'buck' | 'mosfet' | 'hbridge' | 'fuse' | 'terminals'

export interface CabinetModuleGeometry {
  id: string
  position: Point3
  bounds: Point3
  label: string
  kind: CabinetModuleKind
}

export interface CabinetCablePort {
  moduleId: string
  /** Coordinates in the module mesh's unrotated local frame. */
  position: Point3
}

export const CONTROL_CABINET_MODULES: CabinetModuleGeometry[] = [
  { id: 'power.psu_12v', position: [-0.190, 0.205, 0.115], bounds: [0.205, 0.137, 0.140], label: '12 V PSU', kind: 'psu' },
  { id: 'device.esp32', position: [0.175, 0.205, 0.095], bounds: [0.120, 0.078, 0.048], label: 'ESP32', kind: 'esp' },
  { id: 'power.dc_dc', position: [-0.185, 0.015, 0.095], bounds: [0.157, 0.099, 0.058], label: '12 → 5 V', kind: 'buck' },
  { id: 'power.mosfet_module', position: [0.175, 0.015, 0.095], bounds: [0.157, 0.102, 0.066], label: 'MOSFET ×2', kind: 'mosfet' },
  { id: 'power.fuses', position: [-0.185, -0.175, 0.095], bounds: [0.190, 0.066, 0.058], label: 'F1–F3', kind: 'fuse' },
  { id: 'power.h_bridge', position: [0.175, -0.175, 0.095], bounds: [0.166, 0.105, 0.069], label: 'H-мост', kind: 'hbridge' },
  { id: 'power.terminal_blocks', position: [0, -0.340, 0.095], bounds: [0.510, 0.073, 0.058], label: '+12 V · GND · +5 V · I/O', kind: 'terminals' },
]

export const CABINET_CABLE_PORTS: Record<string, CabinetCablePort> = {
  'power.psu_12v.ac_live': { moduleId: 'power.psu_12v', position: [-0.072, -0.034, 0.065] },
  'power.psu_12v.ac_neutral': { moduleId: 'power.psu_12v', position: [-0.072, -0.023, 0.065] },
  'power.psu_12v.protective_earth': { moduleId: 'power.psu_12v', position: [-0.072, -0.012, 0.065] },
  'power.psu_12v.12v': { moduleId: 'power.psu_12v', position: [0.057, -0.024, 0.065] },
  'power.psu_12v.ground': { moduleId: 'power.psu_12v', position: [0.071, -0.024, 0.065] },
  'power.dc_dc.input': { moduleId: 'power.dc_dc', position: [-0.0515, -0.01776, 0.018] },
  'power.dc_dc.input_ground': { moduleId: 'power.dc_dc', position: [-0.01716, -0.01776, 0.018] },
  'power.dc_dc.output_ground': { moduleId: 'power.dc_dc', position: [0.01716, -0.01776, 0.018] },
  'power.dc_dc.output': { moduleId: 'power.dc_dc', position: [0.0515, -0.01776, 0.018] },
  'device.esp32.5v': { moduleId: 'device.esp32', position: [-0.039, -0.023, 0.005] },
  'device.esp32.ground': { moduleId: 'device.esp32', position: [-0.0319, -0.023, 0.005] },
  'device.esp32.3v3': { moduleId: 'device.esp32', position: [-0.0248, -0.023, 0.005] },
  'device.esp32.i2c_sda': { moduleId: 'device.esp32', position: [-0.0177, -0.023, 0.005] },
  'device.esp32.i2c_scl': { moduleId: 'device.esp32', position: [-0.0106, -0.023, 0.005] },
  'device.esp32.uart_indoor_tx': { moduleId: 'device.esp32', position: [-0.0035, -0.023, 0.005] },
  'device.esp32.uart_indoor_rx': { moduleId: 'device.esp32', position: [0.0036, -0.023, 0.005] },
  'device.esp32.uart_outdoor_tx': { moduleId: 'device.esp32', position: [0.0107, -0.023, 0.005] },
  'device.esp32.uart_outdoor_rx': { moduleId: 'device.esp32', position: [0.0178, -0.023, 0.005] },
  'device.esp32.mosfet_intake': { moduleId: 'device.esp32', position: [0.0249, -0.023, 0.005] },
  'device.esp32.mosfet_exhaust': { moduleId: 'device.esp32', position: [0.032, -0.023, 0.005] },
  'device.esp32.hbridge_open': { moduleId: 'device.esp32', position: [0.0391, -0.023, 0.005] },
  'device.esp32.hbridge_close': { moduleId: 'device.esp32', position: [-0.039, 0.023, 0.005] },
  'device.esp32.reed_input': { moduleId: 'device.esp32', position: [-0.0319, 0.023, 0.005] },
  'device.esp32.limit_open_input': { moduleId: 'device.esp32', position: [-0.0248, 0.023, 0.005] },
  'device.esp32.limit_close_input': { moduleId: 'device.esp32', position: [-0.0177, 0.023, 0.005] },
  'power.mosfet_module.supply': { moduleId: 'power.mosfet_module', position: [-0.05265, -0.01872, 0.018] },
  'power.mosfet_module.ground': { moduleId: 'power.mosfet_module', position: [-0.03159, -0.01872, 0.018] },
  'power.mosfet_module.intake_control': { moduleId: 'power.mosfet_module', position: [-0.01053, -0.01872, 0.018] },
  'power.mosfet_module.intake': { moduleId: 'power.mosfet_module', position: [0.01053, -0.01872, 0.018] },
  'power.mosfet_module.exhaust_control': { moduleId: 'power.mosfet_module', position: [0.03159, -0.01872, 0.018] },
  'power.mosfet_module.exhaust': { moduleId: 'power.mosfet_module', position: [0.05265, -0.01872, 0.018] },
  'power.h_bridge.supply': { moduleId: 'power.h_bridge', position: [-0.05655, -0.02016, 0.018] },
  'power.h_bridge.ground': { moduleId: 'power.h_bridge', position: [-0.03393, -0.02016, 0.018] },
  'power.h_bridge.control_open': { moduleId: 'power.h_bridge', position: [-0.01131, -0.02016, 0.018] },
  'power.h_bridge.control_close': { moduleId: 'power.h_bridge', position: [0.01131, -0.02016, 0.018] },
  'power.h_bridge.motor_a': { moduleId: 'power.h_bridge', position: [0.03393, -0.02016, 0.018] },
  'power.h_bridge.motor_b': { moduleId: 'power.h_bridge', position: [0.05655, -0.02016, 0.018] },
  'power.fuses.f1_in': { moduleId: 'power.fuses', position: [-0.047, 0.027, 0.029] },
  'power.fuses.f1_out': { moduleId: 'power.fuses', position: [-0.047, -0.027, 0.029] },
  'power.fuses.f2_in': { moduleId: 'power.fuses', position: [0, 0.027, 0.029] },
  'power.fuses.f2_out': { moduleId: 'power.fuses', position: [0, -0.027, 0.029] },
  'power.fuses.f3_in': { moduleId: 'power.fuses', position: [0.047, 0.027, 0.029] },
  'power.fuses.f3_out': { moduleId: 'power.fuses', position: [0.047, -0.027, 0.029] },
  'power.terminal_blocks.12v': { moduleId: 'power.terminal_blocks', position: [-0.217, 0.006, 0.025] },
  'power.terminal_blocks.ground': { moduleId: 'power.terminal_blocks', position: [-0.031, 0.006, 0.025] },
  'power.terminal_blocks.5v': { moduleId: 'power.terminal_blocks', position: [0.217, 0.006, 0.025] },
}

export const INDOOR_NODE_OFFSETS = {
  scd41: {
    module: [-0.105, 0.137, -0.030] as Point3,
    pins: {
      power: [-0.021, -0.073, 0.063] as Point3,
      ground: [-0.007, -0.073, 0.063] as Point3,
      sda: [0.007, -0.073, 0.063] as Point3,
      scl: [0.021, -0.073, 0.063] as Point3,
    },
  },
  sps30: {
    module: [0.112, -0.120, -0.030] as Point3,
    pins: {
      power: [-0.021, -0.084, 0.058] as Point3,
      ground: [-0.007, -0.084, 0.058] as Point3,
      tx: [0.007, -0.084, 0.058] as Point3,
      rx: [0.021, -0.084, 0.058] as Point3,
    },
  },
} as const

export const INDOOR_SENSOR_ENCLOSURE_DEPTH_M = 0.082
export const INDOOR_SENSOR_AIR_INLET_Z_M = -0.047

export const OUTDOOR_NODE_SIDE_RAIL = {
  leftX: -0.16,
  rightX: 0.16,
  width: 0.032,
  centerY: 0.015,
  height: 0.49,
  centerZ: 0.035,
  depth: 0.22,
} as const

export const OUTDOOR_NODE_COVER_SCREWS = {
  width: 0.36,
  height: 0.42,
  inset: 0.016,
  z: OUTDOOR_NODE_SIDE_RAIL.centerZ + OUTDOOR_NODE_SIDE_RAIL.depth / 2,
} as const

export function mountingScrewPositions({
  width,
  height,
  inset,
  z,
}: {
  width: number
  height: number
  inset: number
  z: number
}): Point3[] {
  return [-1, 1].flatMap((xSide) => [-1, 1].map((ySide) => [
    xSide * (width / 2 - inset),
    ySide * (height / 2 - inset),
    z,
  ] as Point3))
}

export const OUTDOOR_NODE_OFFSETS = {
  sht45: {
    module: [-0.080, 0.107, 0.092] as Point3,
    pins: {
      power: [-0.012, -0.023, 0.029] as Point3,
      ground: [-0.004, -0.023, 0.029] as Point3,
      sda: [0.004, -0.023, 0.029] as Point3,
      scl: [0.012, -0.023, 0.029] as Point3,
    },
  },
  sps30: {
    module: [0.090, -0.116, 0.090] as Point3,
    pins: {
      power: [0.047, -0.060, 0.052] as Point3,
      ground: [0.053, -0.060, 0.052] as Point3,
      tx: [0.059, -0.060, 0.052] as Point3,
      rx: [0.065, -0.060, 0.052] as Point3,
    },
  },
  cableGland: [-0.15, -0.292, -0.14] as Point3,
} as const

export const FAN_CABLE_OFFSETS: [Point3, Point3] = [
  [-0.010, -0.109, 0.065],
  [0.010, -0.109, 0.065],
]

export const WINDOW_ACTUATOR_WIRE_OFFSETS: Point3[] = [
  [-0.022, -0.025, -0.045],
  [0.022, -0.025, -0.045],
]

export const WINDOW_REED_CONTACT_OFFSETS: [Point3, Point3] = [
  [-0.007, -0.028, 0],
  [0.007, -0.028, 0],
]

export const WINDOW_LIMIT_CONTACT_OFFSETS: [Point3, Point3] = [
  [-0.018, 0.008, 0.018],
  [0.018, 0.008, 0.018],
]

export const WINDOW_OPEN_LIMIT_BRACKET_SIZE: Point3 = [0.085, 0.012, 0.09]
export const WINDOW_OPEN_LIMIT_BRACKET_OFFSET: Point3 = [0.005, 0.0435, -0.005]
export const WINDOW_OPEN_LIMIT_SWITCH_SIZE: Point3 = [0.061, 0.047, 0.029]
export const WINDOW_OPEN_LIMIT_SWITCH_OFFSET: Point3 = [0.005, 0.073, -0.005]
export const WINDOW_OPEN_LIMIT_BRACKET_FASTENER_OFFSETS: Point3[] = [
  [-0.032, 0.051, -0.005],
  [0.042, 0.051, -0.005],
]

export function windowAssemblyGeometry(dimensions: WindowGeometryInput) {
  const sashWidth = dimensions.window_width_m - 0.07
  const sashHeight = dimensions.window_height_m - 0.07
  const sashPlaneZ = -dimensions.wall_thickness_m / 2 - 0.022
  const openingAngle = dimensions.window_open_angle_degrees * Math.PI / 180
  // The magnet sits on the sash's right stile; the reed is fixed to the adjacent jamb.
  const magnetLocal: Point3 = [sashWidth / 2 - 0.015, sashHeight * 0.31, -0.010]
  const actuatorBase = [0, 0.13, -dimensions.wall_thickness_m / 2 - 0.245] as Point3

  return {
    sashWidth,
    sashHeight,
    sashPlaneZ,
    openingAngle,
    actuatorBase,
    magnetLocal,
    reedCenter: [dimensions.window_width_m / 2, magnetLocal[1], sashPlaneZ - 0.023] as Point3,
    openLimitBracketCenter: addPoint(actuatorBase, WINDOW_OPEN_LIMIT_BRACKET_OFFSET),
    openLimitBracketSize: WINDOW_OPEN_LIMIT_BRACKET_SIZE,
    openLimitBracketFasteners: WINDOW_OPEN_LIMIT_BRACKET_FASTENER_OFFSETS.map((offset) => addPoint(actuatorBase, offset)),
    openLimitCenter: addPoint(actuatorBase, WINDOW_OPEN_LIMIT_SWITCH_OFFSET),
    closeLimitCenter: [sashWidth * 0.34, 0.040, sashPlaneZ - 0.065] as Point3,
  }
}

function addPoint(left: Point3, right: Point3): Point3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function rotateAboutBottom(point: Point3, angle: number): Point3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return [point[0], point[1] * cosine - point[2] * sine, point[1] * sine + point[2] * cosine]
}

export const EXTERIOR_FAN_MOUNT_CLEARANCE_M = 0.006
export const INTAKE_FILTER_HOUSING_DEPTH_M = 0.104
export const EXHAUST_HOOD_HOUSING_DEPTH_M = 0.075
export const MAINS_ENTRY_CLEARANCE_M = 0.08

export function exteriorFanCenterZ(depth: number, wallThickness: number, intake: boolean): number {
  const exteriorWallFace = depth / 2 + wallThickness / 2
  const housingDepth = intake ? INTAKE_FILTER_HOUSING_DEPTH_M : EXHAUST_HOOD_HOUSING_DEPTH_M
  return exteriorWallFace + housingDepth / 2 + EXTERIOR_FAN_MOUNT_CLEARANCE_M
}
