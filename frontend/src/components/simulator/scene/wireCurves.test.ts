import { describe, expect, it } from 'vitest'
import { createRoundedWireCurve, WIRE_CORNER_RADIUS_M } from './wireCurves'

describe('rounded wiring geometry', () => {
  it('keeps right-angle routes inside their corridor without spline overshoot', () => {
    const route = createRoundedWireCurve([[0, 0, 0], [1, 0, 0], [1, 1, 0]])
    const samples = route.getPoints(120)

    expect(samples[0].toArray()).toEqual([0, 0, 0])
    expect(samples.at(-1)?.toArray()).toEqual([1, 1, 0])
    expect(Math.max(...samples.map(({ x }) => x))).toBeLessThanOrEqual(1)
    expect(Math.min(...samples.map(({ y }) => y))).toBeGreaterThanOrEqual(0)
    expect(route.getLength()).toBeGreaterThan(1.9)
    expect(route.getLength()).toBeLessThan(2)
    expect(WIRE_CORNER_RADIUS_M).toBeLessThan(0.02)
  })

  it('removes duplicate waypoints and preserves a straight run', () => {
    const route = createRoundedWireCurve([[0, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]])

    expect(route.curves).toHaveLength(1)
    expect(route.getLength()).toBeCloseTo(2)
    expect(route.getPoint(0).toArray()).toEqual([0, 0, 0])
    expect(route.getPoint(1).toArray()).toEqual([2, 0, 0])
  })

  it('rejects non-finite and degenerate routes', () => {
    expect(() => createRoundedWireCurve([[0, 0, 0]])).toThrow('at least two finite points')
    expect(() => createRoundedWireCurve([[0, 0, 0], [0, 0, 0]])).toThrow('two distinct points')
    expect(() => createRoundedWireCurve([[0, 0, 0], [Infinity, 0, 0]])).toThrow('at least two finite points')
  })
})
