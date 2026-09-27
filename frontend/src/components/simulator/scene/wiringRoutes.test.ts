import { describe, expect, it } from 'vitest'
import { createWiringRoutes, wiringGeometryKey, type WiringSnapshot } from './wiringRoutes'

const snapshot: WiringSnapshot = {
  simulation: {
    room_dimensions: {
      width_m: 6,
      depth_m: 3,
      height_m: 3,
      wall_thickness_m: 0.2,
      window_width_m: 1.4,
      window_height_m: 1.2,
      window_sill_height_m: 0.9,
      window_open_angle_degrees: 25,
      outdoor_depth_m: 1.2,
    },
    layout: {
      indoor_sensor_center: [-2.25, 1.45, 1.26],
      outdoor_station_center: [1.56, 1.78, 1.17],
      control_cabinet_center: [2.19, 1.4, 0.9375],
      controller_drop_x: 1.8,
      rear_channel_y: 1.465,
      rear_wire_y: 1.418,
      exterior_channel_y: 1.735,
      exterior_wire_y: 1.81,
      trunk_z: 2.63,
      exterior_entry_x: 0.8,
      outdoor_gland_x: 1.21,
      outdoor_gland_z: 0.878,
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

describe('web scene wiring routes', () => {
  it('connects each electrical destination to a unique, finite route', () => {
    const routes = createWiringRoutes(snapshot)
    const routeIds = routes.map((route) => route.id)

    expect(routes).toHaveLength(30)
    expect(new Set(routeIds).size).toBe(routeIds.length)
    for (const route of routes) {
      expect(route.points.length).toBeGreaterThanOrEqual(2)
      expect(route.points.flat().every(Number.isFinite)).toBe(true)
      expect(route.fromId).not.toBe(route.toId)
    }
  })

  it('routes outdoor sensor cables through the wall sleeve and exterior raceway', () => {
    const routes = createWiringRoutes(snapshot)
    const route = routes.find(({ id }) => id === 'i2c-sht45-outdoor')

    expect(route).toBeDefined()
    expect(route?.points.some((point) => Math.abs(point[2] - 1.375) < 0.001)).toBe(true)
    expect(route?.points.some((point) => Math.abs(point[2] - snapshot.simulation.layout.exterior_channel_y) < 0.001)).toBe(true)
    expect(route?.points.at(-1)).toEqual([1.468, 1.254, 1.901])
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
      simulation: { ...snapshot.simulation, layout: { ...snapshot.simulation.layout, trunk_z: 2.62 } },
    })).not.toBe(before)
  })

  it('keeps cabinet wiring inside the enclosure and routes actuator power through the H-bridge', () => {
    const routes = createWiringRoutes(snapshot)
    const buck = routes.find(({ id }) => id === 'power12-buck')
    const windowMotor = routes.find(({ id }) => id === 'power12-window-actuator')

    expect(buck?.points).toHaveLength(2)
    expect(windowMotor?.fromId).toBe('power.h_bridge')
    expect(windowMotor?.toId).toBe('window.actuator')
    expect(windowMotor?.points.length).toBeGreaterThan(2)
  })
})
