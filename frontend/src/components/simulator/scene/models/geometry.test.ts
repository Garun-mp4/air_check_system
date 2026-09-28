import { describe, expect, it } from 'vitest'
import {
  INDOOR_SENSOR_AIR_INLET_Z_M,
  INDOOR_SENSOR_ENCLOSURE_DEPTH_M,
  mountingScrewPositions,
  OUTDOOR_NODE_COVER_SCREWS,
  OUTDOOR_NODE_SIDE_RAIL,
  WINDOW_OPEN_LIMIT_BRACKET_SIZE,
  WINDOW_OPEN_LIMIT_SWITCH_SIZE,
  windowAssemblyGeometry,
} from './geometry'

describe('wall sensor mounting geometry', () => {
  it('places the outdoor cover screws on the exposed side rails', () => {
    const screws = mountingScrewPositions(OUTDOOR_NODE_COVER_SCREWS)
    const rails = [OUTDOOR_NODE_SIDE_RAIL.leftX, OUTDOOR_NODE_SIDE_RAIL.rightX]
    const railFront = OUTDOOR_NODE_SIDE_RAIL.centerZ + OUTDOOR_NODE_SIDE_RAIL.depth / 2
    const railBottom = OUTDOOR_NODE_SIDE_RAIL.centerY - OUTDOOR_NODE_SIDE_RAIL.height / 2
    const railTop = OUTDOOR_NODE_SIDE_RAIL.centerY + OUTDOOR_NODE_SIDE_RAIL.height / 2

    expect(screws).toHaveLength(4)
    for (const [x, y, z] of screws) {
      const nearestRailX = rails.reduce((nearest, railX) => Math.abs(railX - x) < Math.abs(nearest - x) ? railX : nearest)
      expect(Math.abs(x - nearestRailX)).toBeLessThanOrEqual(OUTDOOR_NODE_SIDE_RAIL.width / 2)
      expect(y).toBeGreaterThanOrEqual(railBottom)
      expect(y).toBeLessThanOrEqual(railTop)
      expect(z).toBeCloseTo(railFront, 6)
    }
  })

  it('places the indoor sampling grille beside the room-facing enclosure surface', () => {
    const roomFacingSurface = -INDOOR_SENSOR_ENCLOSURE_DEPTH_M / 2

    expect(INDOOR_SENSOR_AIR_INLET_Z_M).toBeLessThan(0)
    expect(Math.abs(INDOOR_SENSOR_AIR_INLET_Z_M - roomFacingSurface)).toBeLessThan(0.01)
  })

  it('keeps the open limit switch mounted at the fixed actuator bracket as the sash angle changes', () => {
    const dimensions = {
      depth_m: 4,
      wall_thickness_m: 0.24,
      window_width_m: 1.8,
      window_height_m: 1.25,
      window_sill_height_m: 0.9,
      window_open_angle_degrees: 55,
    }
    const closedGeometry = windowAssemblyGeometry(dimensions)
    const alternateOpeningGeometry = windowAssemblyGeometry({ ...dimensions, window_open_angle_degrees: 35 })
    const distanceToFixedActuator = Math.hypot(...closedGeometry.openLimitCenter.map(
      (coordinate, index) => coordinate - closedGeometry.actuatorBase[index],
    ))
    const bracketBottom = closedGeometry.openLimitBracketCenter[1] - WINDOW_OPEN_LIMIT_BRACKET_SIZE[1] / 2
    const bracketTop = closedGeometry.openLimitBracketCenter[1] + WINDOW_OPEN_LIMIT_BRACKET_SIZE[1] / 2
    const actuatorTop = closedGeometry.actuatorBase[1] + 0.075 / 2
    const switchBottom = closedGeometry.openLimitCenter[1] - WINDOW_OPEN_LIMIT_SWITCH_SIZE[1] / 2

    expect(distanceToFixedActuator).toBeLessThan(0.18)
    expect(alternateOpeningGeometry.openLimitCenter).toEqual(closedGeometry.openLimitCenter)
    expect(bracketBottom).toBeCloseTo(actuatorTop, 6)
    expect(bracketTop).toBeCloseTo(switchBottom, 6)
    for (const axis of [0, 2] as const) {
      expect(closedGeometry.openLimitCenter[axis] - WINDOW_OPEN_LIMIT_SWITCH_SIZE[axis] / 2)
        .toBeGreaterThanOrEqual(closedGeometry.openLimitBracketCenter[axis] - WINDOW_OPEN_LIMIT_BRACKET_SIZE[axis] / 2)
      expect(closedGeometry.openLimitCenter[axis] + WINDOW_OPEN_LIMIT_SWITCH_SIZE[axis] / 2)
        .toBeLessThanOrEqual(closedGeometry.openLimitBracketCenter[axis] + WINDOW_OPEN_LIMIT_BRACKET_SIZE[axis] / 2)
    }
  })
})
