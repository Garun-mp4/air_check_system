import { describe, expect, it } from 'vitest'

import {
  buildTimeSeriesOption,
  clampViewport,
  co2Thresholds,
  createFullViewport,
  panViewport,
  zoomViewport,
} from './Charts'

describe('chart viewport controls', () => {
  it('creates a complete viewport and keeps it within the data bounds', () => {
    expect(createFullViewport(100)).toEqual({ start: 0, end: 99 })
    expect(clampViewport({ start: -20, end: 140 }, 100)).toEqual({ start: 0, end: 99 })
    expect(clampViewport({ start: 95, end: 96 }, 100, 6).end - clampViewport({ start: 95, end: 96 }, 100, 6).start).toBe(5)
  })

  it('zooms around the pointer anchor instead of moving only the right edge', () => {
    const full = createFullViewport(100)
    const zoomed = zoomViewport(full, 0.25, 0.5, 100)

    expect(zoomed.end - zoomed.start).toBeLessThan(full.end - full.start)
    expect(zoomed.start).toBeGreaterThan(0)
    expect(zoomed.end).toBeLessThan(99)
  })

  it('pans a zoomed view but clamps at the first and last point', () => {
    const viewport = { start: 20, end: 40 }

    expect(panViewport(viewport, -100, 100)).toEqual({ start: 0, end: 20 })
    expect(panViewport(viewport, 100, 100)).toEqual({ start: 79, end: 99 })
  })

  it('builds an interactive time-series option with navigation and CO₂ thresholds', () => {
    const option = buildTimeSeriesOption([
      { timestamp: '2026-09-09T10:00:00Z', value: 650 },
      { timestamp: '2026-09-09T10:10:00Z', value: 820 },
      { timestamp: '2026-09-09T10:20:00Z', value: 1040 },
    ], 'ppm', co2Thresholds)
    const series = (Array.isArray(option.series) ? option.series[0] : option.series) as {
      type?: string
      sampling?: string
      markLine?: { data?: unknown[] }
    } | undefined

    expect(option.aria).toEqual({ enabled: true })
    expect(option.dataZoom).toHaveLength(2)
    expect(series?.type).toBe('line')
    expect(series?.sampling).toBe('lttb')
    expect(series?.markLine?.data).toHaveLength(2)
  })
})
