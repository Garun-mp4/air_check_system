import { describe, expect, it } from 'vitest'

import {
  buildTimeSeriesOption,
  clampViewport,
  co2Thresholds,
  createDataZoomAction,
  createFullViewport,
  insertChartDataGaps,
  panViewport,
  zoomViewport,
} from './Charts'

describe('chart viewport controls', () => {
  it('leaves a visible gap instead of connecting readings across a long outage', () => {
    expect(insertChartDataGaps([
      { timestamp: '2026-09-09T10:00:00Z', value: 650 },
      { timestamp: '2026-09-09T10:01:00Z', value: 652 },
      { timestamp: '2026-09-09T10:30:00Z', value: 680 },
    ], 10 * 60 * 1000)).toEqual([
      ['2026-09-09T10:00:00Z', 650],
      ['2026-09-09T10:01:00Z', 652],
      ['2026-09-09T10:15:30.000Z', null],
      ['2026-09-09T10:30:00Z', 680],
    ])
  })

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
    expect(option.animation).toBe(false)
    expect(option.animationDuration).toBe(0)
    expect(option.animationDurationUpdate).toBe(0)
    expect(option.dataZoom).toHaveLength(2)
    expect((option.dataZoom as Array<{ disabled?: boolean }>)[0]?.disabled).toBe(true)
    expect((option.dataZoom as Array<{ zoomOnMouseWheel?: boolean }>)[0]?.zoomOnMouseWheel).toBe(false)
    expect(series?.type).toBe('line')
    expect(series?.sampling).toBe('lttb')
    expect(series?.markLine?.data).toHaveLength(2)
  })

  it('keeps the requested viewport when the chart option is rebuilt', () => {
    const option = buildTimeSeriesOption([
      { timestamp: '2026-09-09T10:00:00Z', value: 650 },
      { timestamp: '2026-09-09T10:10:00Z', value: 820 },
      { timestamp: '2026-09-09T10:20:00Z', value: 1040 },
      { timestamp: '2026-09-09T10:30:00Z', value: 900 },
      { timestamp: '2026-09-09T10:40:00Z', value: 880 },
      { timestamp: '2026-09-09T10:50:00Z', value: 860 },
      { timestamp: '2026-09-09T11:00:00Z', value: 840 },
      { timestamp: '2026-09-09T11:10:00Z', value: 820 },
      { timestamp: '2026-09-09T11:20:00Z', value: 800 },
      { timestamp: '2026-09-09T11:30:00Z', value: 780 },
    ], 'ppm', [], undefined, { start: 1, end: 6 })
    const zoom = option.dataZoom as Array<{ start?: number; end?: number }>

    expect(zoom[0]?.start).toBeCloseTo(11.111, 3)
    expect(zoom[0]?.end).toBeCloseTo(66.667, 3)
    expect(zoom[1]?.start).toBeCloseTo(11.111, 3)
    expect(zoom[1]?.end).toBeCloseTo(66.667, 3)
  })

  it('dispatches a viewport as percentages without an animated action', () => {
    expect(createDataZoomAction({ start: 0, end: 99 }, 100)).toEqual({
      type: 'dataZoom',
      start: 0,
      end: 100,
      animation: { duration: 0 },
    })
  })
})
