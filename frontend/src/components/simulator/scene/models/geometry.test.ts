import { describe, expect, it } from 'vitest'
import {
  INDOOR_SENSOR_AIR_INLET_Z_M,
  INDOOR_SENSOR_ENCLOSURE_DEPTH_M,
  mountingScrewPositions,
  OUTDOOR_NODE_COVER_SCREWS,
  OUTDOOR_NODE_SIDE_RAIL,
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
})
