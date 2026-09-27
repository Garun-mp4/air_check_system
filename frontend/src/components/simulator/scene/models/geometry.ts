export type Point3 = [number, number, number]

export type CabinetModuleKind = 'esp' | 'psu' | 'buck' | 'mosfet' | 'hbridge' | 'fuse' | 'terminals'

export interface CabinetModuleGeometry {
  id: string
  position: Point3
  bounds: Point3
  label: string
  kind: CabinetModuleKind
}

export const CONTROL_CABINET_MODULES: CabinetModuleGeometry[] = [
  { id: 'power.psu_12v', position: [-0.190, 0.205, 0.115], bounds: [0.205, 0.137, 0.118], label: '12 V PSU', kind: 'psu' },
  { id: 'device.esp32', position: [0.175, 0.205, 0.095], bounds: [0.120, 0.078, 0.048], label: 'ESP32', kind: 'esp' },
  { id: 'power.dc_dc', position: [-0.185, 0.015, 0.095], bounds: [0.157, 0.099, 0.058], label: '12 → 5 V', kind: 'buck' },
  { id: 'power.mosfet_module', position: [0.175, 0.015, 0.095], bounds: [0.157, 0.102, 0.066], label: 'MOSFET ×2', kind: 'mosfet' },
  { id: 'power.fuses', position: [-0.185, -0.175, 0.095], bounds: [0.190, 0.066, 0.046], label: 'F1–F3', kind: 'fuse' },
  { id: 'power.h_bridge', position: [0.175, -0.175, 0.095], bounds: [0.166, 0.105, 0.069], label: 'H-мост', kind: 'hbridge' },
  { id: 'power.terminal_blocks', position: [0, -0.340, 0.095], bounds: [0.510, 0.073, 0.058], label: '+12 V · GND · +5 V · I/O', kind: 'terminals' },
]

export const CABINET_CABLE_PORTS: Record<string, Point3> = {
  'power.psu_12v': [0.060, 0.023, 0.044],
  'device.esp32': [-0.044, -0.020, 0.044],
  'power.dc_dc': [-0.045, -0.020, 0.044],
  'power.mosfet_module': [0.045, -0.021, 0.044],
  'power.h_bridge': [0.048, -0.030, 0.044],
  'power.terminal_blocks': [-0.220, -0.007, 0.035],
}

export const INDOOR_NODE_OFFSETS = {
  scd41: {
    module: [-0.105, 0.137, -0.030] as Point3,
    connector: [0, -0.073, 0.063] as Point3,
  },
  sps30: {
    module: [0.112, -0.120, -0.030] as Point3,
    connector: [0, -0.084, 0.063] as Point3,
  },
} as const

export const OUTDOOR_NODE_OFFSETS = {
  sht45: {
    module: [-0.080, 0.107, 0.092] as Point3,
    connector: [-0.012, -0.023, 0.029] as Point3,
  },
  sps30: {
    module: [0.090, -0.116, 0.090] as Point3,
    connector: [0.071, -0.060, 0.042] as Point3,
  },
  cableGland: [0, -0.292, 0.102] as Point3,
} as const
