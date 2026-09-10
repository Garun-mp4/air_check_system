'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ECharts } from 'echarts/core'
import { init, use as useECharts } from 'echarts/core'
import { AriaComponent, DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { LineChart as EChartsLineSeries } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

useECharts([
  CanvasRenderer,
  EChartsLineSeries,
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
])

const minVisiblePoints = 6
const chartDataGapThresholdMs = 10 * 60 * 1000

export interface SeriesPoint {
  timestamp: string
  value: number
}

export interface ChartViewport {
  start: number
  end: number
}

export interface ChartThreshold {
  value: number
  label: string
  color: string
}

export interface ChartPalette {
  canvas: string
  surface: string
  ink: string
  muted: string
  hairline: string
  success: string
  warning: string
  error: string
  fontBody: string
  fontCode: string
}

export const defaultChartPalette: ChartPalette = {
  canvas: '#ffffff',
  surface: '#f5f5f5',
  ink: '#111111',
  muted: '#6b7280',
  hairline: '#e5e7eb',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  fontBody: 'Inter, sans-serif',
  fontCode: 'JetBrains Mono, monospace',
}

export function getCo2Thresholds(
  normal = 800,
  critical = 1000,
): ChartThreshold[] {
  return [
    { value: normal, label: normal + ' · внимание', color: defaultChartPalette.warning },
    { value: critical, label: critical + ' · критично', color: defaultChartPalette.error },
  ]
}

export const co2Thresholds = getCo2Thresholds()

interface ChartProps {
  data: SeriesPoint[]
  unit: string
  ariaLabel: string
  thresholds?: ChartThreshold[]
  rangeKey?: string
}

interface DataZoomRange {
  start?: number
  end?: number
  startValue?: number | string | Date
  endValue?: number | string | Date
}

interface EChartsDataZoomEvent extends DataZoomRange {
  batch?: DataZoomRange[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function createFullViewport(dataLength: number): ChartViewport {
  return {
    start: 0,
    end: Math.max(0, dataLength - 1),
  }
}

export function clampViewport(
  viewport: ChartViewport,
  dataLength: number,
  minimumPoints = minVisiblePoints,
): ChartViewport {
  if (dataLength <= 1) {
    return createFullViewport(dataLength)
  }

  const maxIndex = dataLength - 1
  const minimumSpan = Math.min(maxIndex, Math.max(1, minimumPoints - 1))
  const rawStart = Math.min(viewport.start, viewport.end)
  const rawEnd = Math.max(viewport.start, viewport.end)
  const rawSpan = rawEnd - rawStart
  const span = clamp(rawSpan, minimumSpan, maxIndex)
  const center = (rawStart + rawEnd) / 2
  const start = clamp(center - span / 2, 0, maxIndex - span)

  return {
    start,
    end: start + span,
  }
}

export function zoomViewport(
  viewport: ChartViewport,
  anchorRatio: number,
  scale: number,
  dataLength: number,
  minimumPoints = minVisiblePoints,
): ChartViewport {
  if (dataLength <= 1 || !Number.isFinite(scale) || scale <= 0) {
    return createFullViewport(dataLength)
  }

  const current = clampViewport(viewport, dataLength, minimumPoints)
  const currentSpan = Math.max(1, current.end - current.start)
  const maxSpan = dataLength - 1
  const minimumSpan = Math.min(maxSpan, Math.max(1, minimumPoints - 1))
  const nextSpan = clamp(currentSpan * scale, minimumSpan, maxSpan)
  const safeAnchor = clamp(anchorRatio, 0, 1)
  const anchor = current.start + currentSpan * safeAnchor
  const nextStart = anchor - nextSpan * safeAnchor

  return clampViewport(
    { start: nextStart, end: nextStart + nextSpan },
    dataLength,
    minimumPoints,
  )
}

export function panViewport(
  viewport: ChartViewport,
  deltaPoints: number,
  dataLength: number,
  minimumPoints = minVisiblePoints,
): ChartViewport {
  if (dataLength <= 1 || !Number.isFinite(deltaPoints)) {
    return createFullViewport(dataLength)
  }

  return clampViewport(
    {
      start: viewport.start + deltaPoints,
      end: viewport.end + deltaPoints,
    },
    dataLength,
    minimumPoints,
  )
}

function formatAxisTime(timestamp: number | string | Date, includeDay: boolean): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return new Intl.DateTimeFormat('ru-RU', includeDay
    ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' },
  ).format(date)
}

function hasCalendarDayChange(firstTimestamp: string, lastTimestamp: string): boolean {
  const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return dateFormatter.format(new Date(firstTimestamp)) !== dateFormatter.format(new Date(lastTimestamp))
}

function formatChartValue(value: number, unit: string): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: unit === '°C' ? 1 : 0,
  }).format(value) + ' ' + unit
}

function validData(data: SeriesPoint[]): SeriesPoint[] {
  return data.filter((point) => (
    Number.isFinite(point.value) && Number.isFinite(new Date(point.timestamp).getTime())
  ))
}

export function insertChartDataGaps(
  inputData: SeriesPoint[],
  maxGapMs = chartDataGapThresholdMs,
): Array<[string, number | null]> {
  const data = validData(inputData)
  const renderData: Array<[string, number | null]> = []

  data.forEach((point, index) => {
    const previous = data[index - 1]
    if (previous) {
      const previousTime = Date.parse(previous.timestamp)
      const currentTime = Date.parse(point.timestamp)
      if (currentTime - previousTime > maxGapMs) {
        renderData.push([
          new Date(previousTime + (currentTime - previousTime) / 2).toISOString(),
          null,
        ])
      }
    }
    renderData.push([point.timestamp, point.value])
  })

  return renderData
}

function readCssToken(element: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback
}

export function readChartPalette(element: HTMLElement): ChartPalette {
  return {
    canvas: readCssToken(element, '--color-canvas', defaultChartPalette.canvas),
    surface: readCssToken(element, '--color-surface-card', defaultChartPalette.surface),
    ink: readCssToken(element, '--color-ink', defaultChartPalette.ink),
    muted: readCssToken(element, '--color-muted', defaultChartPalette.muted),
    hairline: readCssToken(element, '--color-hairline', defaultChartPalette.hairline),
    success: readCssToken(element, '--color-success', defaultChartPalette.success),
    warning: readCssToken(element, '--color-warning', defaultChartPalette.warning),
    error: readCssToken(element, '--color-error', defaultChartPalette.error),
    fontBody: readCssToken(element, '--font-body', defaultChartPalette.fontBody),
    fontCode: readCssToken(element, '--font-code', defaultChartPalette.fontCode),
  }
}

function viewportPercent(viewport: ChartViewport, dataLength: number): { start: number; end: number } {
  const maxIndex = Math.max(1, dataLength - 1)
  return {
    start: (viewport.start / maxIndex) * 100,
    end: (viewport.end / maxIndex) * 100,
  }
}

function viewportsEqual(first: ChartViewport, second: ChartViewport): boolean {
  return Math.abs(first.start - second.start) < 0.01 && Math.abs(first.end - second.end) < 0.01
}

export function createDataZoomAction(viewport: ChartViewport, dataLength: number) {
  const range = viewportPercent(clampViewport(viewport, dataLength), dataLength)
  return {
    type: 'dataZoom' as const,
    start: range.start,
    end: range.end,
    animation: { duration: 0 },
  }
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nearestTimestampIndex(value: unknown, data: SeriesPoint[]): number | null {
  const target = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Date.parse(value)
        : Number.NaN
  if (!Number.isFinite(target) || data.length === 0) {
    return null
  }

  let closestIndex = 0
  let closestDistance = Math.abs(Date.parse(data[0].timestamp) - target)
  for (let index = 1; index < data.length; index += 1) {
    const distance = Math.abs(Date.parse(data[index].timestamp) - target)
    if (distance < closestDistance) {
      closestIndex = index
      closestDistance = distance
    }
  }
  return closestIndex
}

function viewportFromDataZoomEvent(event: unknown, data: SeriesPoint[]): ChartViewport | null {
  const typedEvent = event as EChartsDataZoomEvent
  const range = typedEvent.batch?.[0] ?? typedEvent
  const startPercent = toFiniteNumber(range.start)
  const endPercent = toFiniteNumber(range.end)

  if (startPercent !== null && endPercent !== null) {
    const maxIndex = Math.max(0, data.length - 1)
    return clampViewport({
      start: (clamp(startPercent, 0, 100) / 100) * maxIndex,
      end: (clamp(endPercent, 0, 100) / 100) * maxIndex,
    }, data.length)
  }

  const startIndex = nearestTimestampIndex(range.startValue, data)
  const endIndex = nearestTimestampIndex(range.endValue, data)
  if (startIndex === null || endIndex === null) {
    return null
  }
  return clampViewport({ start: startIndex, end: endIndex }, data.length)
}

function viewportStatus(viewport: ChartViewport, dataLength: number): string {
  const visiblePoints = dataLength === 0 ? 0 : Math.round(viewport.end - viewport.start) + 1
  const pointWord = (count: number): string => {
    if (count % 10 === 1 && count % 100 !== 11) {
      return 'точка'
    }
    if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) {
      return 'точки'
    }
    return 'точек'
  }
  if (visiblePoints === dataLength) {
    return 'Показаны все ' + dataLength + ' ' + pointWord(dataLength)
  }
  return 'Показано ' + visiblePoints + ' ' + pointWord(visiblePoints) + ' из ' + dataLength + ' ' + pointWord(dataLength)
}

export function buildTimeSeriesOption(
  inputData: SeriesPoint[],
  unit: string,
  thresholds: ChartThreshold[] = [],
  palette: ChartPalette = defaultChartPalette,
  viewport: ChartViewport = createFullViewport(inputData.length),
): EChartsOption {
  const data = validData(inputData)
  const appliedViewport = clampViewport(viewport, data.length)
  const zoomRange = viewportPercent(appliedViewport, data.length)
  const values = data.map((point) => point.value)
  const rawMin = values.length > 0 ? Math.min(...values) : 0
  const rawMax = values.length > 0 ? Math.max(...values) : 1
  const spread = Math.max(rawMax - rawMin, unit === '°C' ? 0.5 : 1)
  const includeDay = data.length > 1 && hasCalendarDayChange(data[0].timestamp, data.at(-1)?.timestamp ?? data[0].timestamp)
  const thresholdLines = thresholds.map((threshold) => ({
    name: threshold.label,
    yAxis: threshold.value,
    lineStyle: {
      color: threshold.color,
      type: 'dashed' as const,
      width: 1,
    },
    label: {
      color: threshold.color,
      fontFamily: palette.fontCode,
      fontSize: 10,
      position: 'insideEndTop' as const,
    },
  }))
  const renderData = insertChartDataGaps(data)

  return {
    // A period change replaces the whole series and can also change its length.
    // ECharts' index-based data animation then connects unrelated old/new points
    // for a frame. Keep data replacement atomic; chart gestures stay immediate.
    animation: false,
    animationDuration: 0,
    animationDurationUpdate: 0,
    aria: { enabled: true },
    backgroundColor: 'transparent',
    grid: {
      top: 20,
      right: 16,
      bottom: 52,
      left: 12,
      containLabel: true,
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: palette.canvas,
      borderColor: palette.hairline,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: {
        color: palette.ink,
        fontFamily: palette.fontCode,
        fontSize: 11,
      },
      axisPointer: {
        type: 'line',
        lineStyle: {
          color: palette.muted,
          type: 'dashed',
          width: 1,
        },
      },
      transitionDuration: 0,
      hideDelay: 0,
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params]
        const item = items[0] as { value?: unknown; axisValue?: string | number } | undefined
        const rawValue = Array.isArray(item?.value) ? item.value[1] : item?.value
        if (rawValue === null || rawValue === undefined) {
          return ''
        }
        const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue)
        if (!Number.isFinite(numericValue)) {
          return ''
        }
        const rawAxisValue = item?.axisValue
        const axisValue = typeof rawAxisValue === 'number' || typeof rawAxisValue === 'string'
          ? rawAxisValue
          : ''
        return '<strong>' + formatAxisTime(axisValue, includeDay) + '</strong><br />' + formatChartValue(numericValue, unit)
      },
    },
    xAxis: {
      type: 'time',
      boundaryGap: [0, 0],
      axisLine: {
        lineStyle: { color: palette.hairline },
      },
      axisTick: { show: false },
      axisLabel: {
        color: palette.muted,
        fontFamily: palette.fontCode,
        fontSize: 10,
        hideOverlap: true,
        margin: 10,
        formatter: (value: string | number) => formatAxisTime(value, includeDay),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: rawMin - spread * 0.12,
      max: rawMax + spread * 0.12,
      scale: true,
      splitNumber: 3,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: palette.muted,
        fontFamily: palette.fontCode,
        fontSize: 10,
        formatter: (value: string | number) => formatChartValue(Number(value), unit),
        margin: 10,
      },
      splitLine: {
        lineStyle: {
          color: palette.hairline,
          type: 'solid',
          width: 1,
        },
      },
    },
    dataZoom: [
      {
        id: 'inside-zoom',
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
        start: zoomRange.start,
        end: zoomRange.end,
        disabled: true,
        zoomOnMouseWheel: false,
        moveOnMouseMove: false,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: false,
        throttle: 16,
      },
      {
        id: 'range-slider',
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        bottom: 8,
        height: 22,
        showDetail: false,
        showDataShadow: false,
        brushSelect: false,
        start: zoomRange.start,
        end: zoomRange.end,
        backgroundColor: palette.surface,
        borderColor: palette.hairline,
        fillerColor: palette.hairline,
        handleStyle: {
          color: palette.ink,
          borderColor: palette.ink,
          borderWidth: 0,
        },
        moveHandleSize: 0,
        labelFormatter: (value: number) => formatAxisTime(value, includeDay),
      },
    ],
    series: [{
      type: 'line',
      name: unit,
      data: renderData,
      showSymbol: data.length <= 48,
      symbol: 'circle',
      symbolSize: data.length <= 48 ? 5 : 0,
      smooth: false,
      sampling: 'lttb',
      connectNulls: false,
      lineStyle: {
        color: palette.ink,
        width: 2,
      },
      itemStyle: {
        color: palette.ink,
      },
      emphasis: {
        focus: 'none',
        scale: false,
        itemStyle: {
          color: palette.ink,
          borderColor: palette.ink,
          borderWidth: 1,
        },
      },
      markLine: thresholdLines.length > 0 ? {
        silent: true,
        symbol: 'none',
        data: thresholdLines,
      } : undefined,
    }],
  }
}

function ChartViewportToolbar({
  viewport,
  dataLength,
  onPanBackward,
  onPanForward,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  viewport: ChartViewport
  dataLength: number
  onPanBackward: () => void
  onPanForward: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}) {
  const isFullRange = dataLength <= 1 || Math.round(viewport.end - viewport.start) >= dataLength - 1
  const isMinimumRange = dataLength <= minVisiblePoints || Math.round(viewport.end - viewport.start) <= minVisiblePoints - 1
  const isAtStart = viewport.start <= 0.5
  const isAtEnd = viewport.end >= dataLength - 1.5

  return (
    <div className="chart-viewport-toolbar" role="group" aria-label="Управление масштабом графика">
      <span className="chart-viewport-status" aria-live="polite">
        {viewportStatus(viewport, dataLength)}
      </span>
      <div className="chart-viewport-actions">
        <button
          className="button-icon-circular chart-viewport-button"
          type="button"
          onClick={onPanBackward}
          disabled={isAtStart}
          aria-label="Показать более ранний период"
          title="Показать более ранний период"
        >
          ‹
        </button>
        <button
          className="button-icon-circular chart-viewport-button"
          type="button"
          onClick={onZoomOut}
          disabled={isFullRange}
          aria-label="Показать больший период"
          title="Показать больший период"
        >
          −
        </button>
        <button
          className="button-icon-circular chart-viewport-button"
          type="button"
          onClick={onZoomIn}
          disabled={isMinimumRange}
          aria-label="Увеличить график"
          title="Увеличить график"
        >
          +
        </button>
        <button
          className="button-icon-circular chart-viewport-button"
          type="button"
          onClick={onPanForward}
          disabled={isAtEnd}
          aria-label="Показать более поздний период"
          title="Показать более поздний период"
        >
          ›
        </button>
        <button className="button-secondary chart-reset-button" type="button" onClick={onReset} disabled={isFullRange}>
          Сбросить
        </button>
      </div>
    </div>
  )
}

export function LineChart({ data: inputData, unit, ariaLabel, thresholds = [], rangeKey = 'default' }: ChartProps) {
  const instructionsId = useId()
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const chartMountRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ECharts | null>(null)
  const dataZoomHandlerRef = useRef<((event: unknown) => void) | null>(null)
  const dataZoomBoundRef = useRef(false)
  const hasAppliedDataRef = useRef(false)
  const previousRangeKeyRef = useRef(rangeKey)
  const previousDataLengthRef = useRef(0)
  const dataRef = useRef<SeriesPoint[]>(inputData)
  const viewportRef = useRef<ChartViewport>(createFullViewport(inputData.length))
  const dispatchViewportRef = useRef<(nextViewport: ChartViewport) => void>(() => undefined)
  const [viewport, setViewport] = useState<ChartViewport>(() => createFullViewport(inputData.length))
  const data = useMemo(() => validData(inputData), [inputData])
  const dataKey = useMemo(() => data.length === 0
    ? 'empty'
    : data.map((point) => point.timestamp + ':' + point.value).join('|'), [data])
  const thresholdKey = useMemo(
    () => thresholds.map((threshold) => threshold.value + ':' + threshold.label + ':' + threshold.color).join('|'),
    [thresholds],
  )
  const hasData = data.length > 0
  dataRef.current = data

  const currentViewport = clampViewport(viewport, data.length)
  viewportRef.current = currentViewport

  useEffect(() => {
    const chartMount = chartMountRef.current
    if (!chartMount || !hasData) {
      return
    }

    const chart = init(chartMount, undefined, {
      renderer: 'canvas',
      useDirtyRect: false,
    })
    chartRef.current = chart

    const handleDataZoom = (event: unknown) => {
      const nextViewport = viewportFromDataZoomEvent(event, dataRef.current)
      if (nextViewport) {
        viewportRef.current = nextViewport
        setViewport((current) => viewportsEqual(current, nextViewport) ? current : nextViewport)
      }
    }
    dataZoomHandlerRef.current = handleDataZoom

    const observer = new ResizeObserver(() => chart.resize({ animation: { duration: 0 }, silent: true }))
    observer.observe(chartMount)

    return () => {
      observer.disconnect()
      if (dataZoomBoundRef.current) {
        chart.off('datazoom', handleDataZoom)
      }
      dataZoomBoundRef.current = false
      dataZoomHandlerRef.current = null
      chart.dispose()
      chartRef.current = null
    }
  }, [hasData])

  useEffect(() => {
    const chart = chartRef.current
    const surface = surfaceRef.current
    const dataZoomHandler = dataZoomHandlerRef.current
    if (!chart || !surface) {
      return
    }

    const previousDataLength = previousDataLengthRef.current
    const previousViewport = clampViewport(viewportRef.current, previousDataLength)
    const shouldResetViewport = !hasAppliedDataRef.current || previousRangeKeyRef.current !== rangeKey
    const dataGrew = data.length > previousDataLength
    const wasFullRange = previousDataLength <= 1
      || Math.round(previousViewport.end - previousViewport.start) >= previousDataLength - 1
    const wasAtEnd = previousDataLength > 0 && previousViewport.end >= previousDataLength - 1.5
    let nextViewport: ChartViewport
    if (shouldResetViewport || wasFullRange) {
      nextViewport = createFullViewport(data.length)
    } else if (dataGrew && wasAtEnd) {
      const addedPoints = data.length - previousDataLength
      nextViewport = clampViewport({
        start: previousViewport.start + addedPoints,
        end: previousViewport.end + addedPoints,
      }, data.length)
    } else {
      nextViewport = clampViewport(viewportRef.current, data.length)
    }
    const palette = readChartPalette(surface)
    chart.setOption(
      buildTimeSeriesOption(data, unit, thresholds, palette, nextViewport),
      { notMerge: true, silent: true },
    )
    if (!dataZoomBoundRef.current && dataZoomHandler) {
      chart.on('datazoom', dataZoomHandler)
      dataZoomBoundRef.current = true
    }

    hasAppliedDataRef.current = true
    previousRangeKeyRef.current = rangeKey
    previousDataLengthRef.current = data.length
    viewportRef.current = nextViewport
    setViewport((current) => viewportsEqual(current, nextViewport) ? current : nextViewport)
  }, [dataKey, data, unit, thresholdKey, rangeKey])

  const dispatchViewport = (nextViewport: ChartViewport) => {
    const next = clampViewport(nextViewport, data.length)
    viewportRef.current = next
    setViewport((current) => viewportsEqual(current, next) ? current : next)

    const chart = chartRef.current
    if (!chart || data.length === 0) {
      return
    }

    chart.dispatchAction(createDataZoomAction(next, data.length))
  }

  dispatchViewportRef.current = dispatchViewport

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface || !hasData) {
      return
    }

    type InteractionState =
      | { kind: 'mouse-pending' | 'mouse-pan' | 'mouse-ignored'; startX: number; startY: number; lastX: number; lastY: number }
      | { kind: 'touch-pending' | 'touch-pan' | 'touch-scroll'; startX: number; startY: number; lastX: number }
      | { kind: 'touch-pinch'; previousDistance: number }
      | {
        kind: 'mouse-slider' | 'touch-slider'
        startX: number
        initialViewport: ChartViewport
        handle: 'start' | 'end' | 'window'
      }

    let state: InteractionState | null = null
    let lastTouchAt = 0
    let pendingViewport: ChartViewport | null = null
    let animationFrame = 0

    const isSliderArea = (clientY: number, rect: DOMRect): boolean => (
      clientY >= rect.bottom - 44
    )

    const getTouchDistance = (first: Touch, second: Touch): number => (
      Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
    )

    const hideTooltip = () => {
      chartRef.current?.dispatchAction({ type: 'hideTip' })
    }

    const setInteracting = (interacting: boolean) => {
      surface.classList.toggle('is-interacting', interacting)
    }

    const flushViewport = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = 0
      }
      const next = pendingViewport
      pendingViewport = null
      if (next) {
        dispatchViewportRef.current(next)
      }
    }

    const scheduleViewport = (next: ChartViewport) => {
      const dataLength = dataRef.current.length
      pendingViewport = clampViewport(next, dataLength)
      viewportRef.current = pendingViewport
      if (animationFrame) {
        return
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        const scheduled = pendingViewport
        pendingViewport = null
        if (scheduled) {
          dispatchViewportRef.current(scheduled)
        }
      })
    }

    const finishGesture = () => {
      flushViewport()
      state = null
      setInteracting(false)
    }

    const startPan = () => {
      hideTooltip()
      setInteracting(true)
    }

    const panByPixels = (deltaX: number) => {
      const rect = surface.getBoundingClientRect()
      const dataLength = dataRef.current.length
      const current = viewportRef.current
      const span = Math.max(1, current.end - current.start)
      if (rect.width <= 0 || dataLength <= 1) {
        return
      }
      scheduleViewport(panViewport(current, -(deltaX / rect.width) * span, dataLength))
    }

    const pickSliderHandle = (clientX: number, rect: DOMRect): 'start' | 'end' | 'window' => {
      const dataLength = dataRef.current.length
      const maxIndex = Math.max(1, dataLength - 1)
      const current = clampViewport(viewportRef.current, dataLength)
      const ratio = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0.5
      const startRatio = current.start / maxIndex
      const endRatio = current.end / maxIndex
      const startDistance = Math.abs(ratio - startRatio)
      const endDistance = Math.abs(ratio - endRatio)
      if (startDistance <= 0.08 || endDistance <= 0.08) {
        return startDistance <= endDistance ? 'start' : 'end'
      }
      if (ratio > startRatio && ratio < endRatio) {
        return 'window'
      }
      return startDistance <= endDistance ? 'start' : 'end'
    }

    const moveSlider = (clientX: number, sliderState: Extract<InteractionState, { kind: 'mouse-slider' | 'touch-slider' }>) => {
      const dataLength = dataRef.current.length
      const rect = surface.getBoundingClientRect()
      const maxIndex = Math.max(1, dataLength - 1)
      if (rect.width <= 0 || dataLength <= 1) {
        return
      }
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
      const targetIndex = ratio * maxIndex
      const current = viewportRef.current
      const minimumSpan = Math.min(maxIndex, Math.max(1, minVisiblePoints - 1))
      let next: ChartViewport
      if (sliderState.handle === 'window') {
        const initialRatio = clamp((sliderState.startX - rect.left) / rect.width, 0, 1)
        next = panViewport(sliderState.initialViewport, (ratio - initialRatio) * maxIndex, dataLength)
      } else if (sliderState.handle === 'start') {
        next = {
          start: clamp(targetIndex, 0, current.end - minimumSpan),
          end: current.end,
        }
      } else {
        next = {
          start: current.start,
          end: clamp(targetIndex, current.start + minimumSpan, maxIndex),
        }
      }
      scheduleViewport(next)
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || performance.now() - lastTouchAt < 700) {
        return
      }
      const rect = surface.getBoundingClientRect()
      if (isSliderArea(event.clientY, rect)) {
        state = {
          kind: 'mouse-slider',
          startX: event.clientX,
          initialViewport: viewportRef.current,
          handle: pickSliderHandle(event.clientX, rect),
        }
        hideTooltip()
        setInteracting(true)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      state = {
        kind: 'mouse-pending',
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
      }
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!state) {
        return
      }
      if (state.kind === 'mouse-slider') {
        event.preventDefault()
        event.stopPropagation()
        moveSlider(event.clientX, state)
        return
      }
      if (state.kind !== 'mouse-pending' && state.kind !== 'mouse-pan') {
        return
      }
      const deltaFromStartX = event.clientX - state.startX
      const deltaFromStartY = event.clientY - state.startY
      if (state.kind === 'mouse-pending') {
        if (Math.hypot(deltaFromStartX, deltaFromStartY) < 8) {
          return
        }
        if (Math.abs(deltaFromStartY) > Math.abs(deltaFromStartX) * 1.25) {
          state = { ...state, kind: 'mouse-ignored' }
          return
        }
        state = { ...state, kind: 'mouse-pan' }
        startPan()
      }
      if (state.kind !== 'mouse-pan') {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      panByPixels(event.clientX - state.lastX)
      state.lastX = event.clientX
      state.lastY = event.clientY
    }

    const handleMouseUp = (event: MouseEvent) => {
      if (state?.kind === 'mouse-pan') {
        event.preventDefault()
        event.stopPropagation()
        finishGesture()
      } else if (state?.kind === 'mouse-pending' || state?.kind === 'mouse-ignored') {
        state = null
      } else if (state?.kind === 'mouse-slider') {
        event.preventDefault()
        event.stopPropagation()
        finishGesture()
      }
    }

    const handleTouchStart = (event: TouchEvent) => {
      lastTouchAt = performance.now()
      const rect = surface.getBoundingClientRect()
      if (event.touches.length >= 2) {
        const first = event.touches[0]
        const second = event.touches[1]
        if (!first || !second) {
          return
        }
        if (isSliderArea(first.clientY, rect) || isSliderArea(second.clientY, rect)) {
          state = {
            kind: 'touch-slider',
            startX: first.clientX,
            initialViewport: viewportRef.current,
            handle: pickSliderHandle(first.clientX, rect),
          }
          hideTooltip()
          setInteracting(true)
          event.preventDefault()
          event.stopPropagation()
          return
        }
        state = { kind: 'touch-pinch', previousDistance: getTouchDistance(first, second) }
        hideTooltip()
        setInteracting(true)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const touch = event.touches[0]
      if (!touch) {
        return
      }
      if (isSliderArea(touch.clientY, rect)) {
        state = {
          kind: 'touch-slider',
          startX: touch.clientX,
          initialViewport: viewportRef.current,
          handle: pickSliderHandle(touch.clientX, rect),
        }
        hideTooltip()
        setInteracting(true)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      state = {
        kind: 'touch-pending',
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (!state) {
        return
      }
      if (state.kind === 'touch-slider') {
        const touch = event.touches[0]
        if (!touch) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        moveSlider(touch.clientX, state)
        return
      }

      if (event.touches.length >= 2) {
        const first = event.touches[0]
        const second = event.touches[1]
        if (!first || !second) {
          return
        }
        const distance = getTouchDistance(first, second)
        if (state.kind !== 'touch-pinch') {
          state = { kind: 'touch-pinch', previousDistance: distance }
          hideTooltip()
          setInteracting(true)
        }
        if (state.kind !== 'touch-pinch' || distance <= 0 || state.previousDistance <= 0) {
          return
        }
        const rect = surface.getBoundingClientRect()
        const centerX = (first.clientX + second.clientX) / 2
        const anchorRatio = rect.width > 0 ? (centerX - rect.left) / rect.width : 0.5
        scheduleViewport(zoomViewport(
          viewportRef.current,
          anchorRatio,
          state.previousDistance / distance,
          dataRef.current.length,
        ))
        state.previousDistance = distance
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (state.kind === 'touch-pinch') {
        const remainingTouch = event.touches[0]
        if (!remainingTouch) {
          return
        }
        state = { kind: 'touch-pan', startX: remainingTouch.clientX, startY: remainingTouch.clientY, lastX: remainingTouch.clientX }
      }

      const touch = event.touches[0]
      if (!touch) {
        return
      }
      if (state.kind === 'touch-pending') {
        const deltaX = touch.clientX - state.startX
        const deltaY = touch.clientY - state.startY
        if (Math.hypot(deltaX, deltaY) < 8) {
          return
        }
        if (Math.abs(deltaY) > Math.abs(deltaX) * 1.15) {
          state = { kind: 'touch-scroll', startX: state.startX, startY: state.startY, lastX: touch.clientX }
          return
        }
        state = { kind: 'touch-pan', startX: state.startX, startY: state.startY, lastX: state.lastX }
        startPan()
      }
      if (state.kind !== 'touch-pan') {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      panByPixels(touch.clientX - state.lastX)
      state.lastX = touch.clientX
    }

    const handleTouchEnd = (event: TouchEvent) => {
      lastTouchAt = performance.now()
      if (state?.kind === 'touch-pinch' && event.touches.length === 1) {
        const remainingTouch = event.touches[0]
        if (remainingTouch) {
          state = { kind: 'touch-pan', startX: remainingTouch.clientX, startY: remainingTouch.clientY, lastX: remainingTouch.clientX }
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }
      if (state?.kind === 'touch-slider') {
        event.preventDefault()
        event.stopPropagation()
        if (event.touches.length === 0) {
          finishGesture()
        }
        return
      }
      if (state?.kind === 'touch-pan' || state?.kind === 'touch-pinch') {
        event.preventDefault()
        event.stopPropagation()
        if (event.touches.length > 0) {
          return
        }
        finishGesture()
        return
      }
      if (event.touches.length === 0) {
        state = null
        setInteracting(false)
      }
    }

    const handleTouchCancel = () => {
      lastTouchAt = performance.now()
      finishGesture()
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return
      }
      const rect = surface.getBoundingClientRect()
      const normalizedDelta = event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * window.innerHeight
          : event.deltaY
      const anchorRatio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5
      const scale = Math.pow(1.12, clamp(normalizedDelta / 100, -4, 4))
      hideTooltip()
      scheduleViewport(zoomViewport(viewportRef.current, anchorRatio, scale, dataRef.current.length))
      event.preventDefault()
      event.stopPropagation()
    }

    const handleWindowBlur = () => {
      finishGesture()
    }

    surface.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('mousemove', handleMouseMove, true)
    window.addEventListener('mouseup', handleMouseUp, true)
    surface.addEventListener('touchstart', handleTouchStart, { capture: true, passive: false })
    surface.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false })
    surface.addEventListener('touchend', handleTouchEnd, { capture: true, passive: false })
    surface.addEventListener('touchcancel', handleTouchCancel, { capture: true, passive: false })
    surface.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      finishGesture()
      surface.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('mousemove', handleMouseMove, true)
      window.removeEventListener('mouseup', handleMouseUp, true)
      surface.removeEventListener('touchstart', handleTouchStart, true)
      surface.removeEventListener('touchmove', handleTouchMove, true)
      surface.removeEventListener('touchend', handleTouchEnd, true)
      surface.removeEventListener('touchcancel', handleTouchCancel, true)
      surface.removeEventListener('wheel', handleWheel, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [hasData])

  const zoomIn = () => dispatchViewport(zoomViewport(currentViewport, 0.5, 0.65, data.length))
  const zoomOut = () => dispatchViewport(zoomViewport(currentViewport, 0.5, 1.5, data.length))
  const panBackward = () => {
    const span = Math.max(1, currentViewport.end - currentViewport.start)
    dispatchViewport(panViewport(currentViewport, -span * 0.65, data.length))
  }
  const panForward = () => {
    const span = Math.max(1, currentViewport.end - currentViewport.start)
    dispatchViewport(panViewport(currentViewport, span * 0.65, data.length))
  }
  const reset = () => dispatchViewport(createFullViewport(data.length))

  if (data.length === 0) {
    return <div className="chart-empty" role="status">Нет данных за выбранный период</div>
  }

  return (
    <div className="interactive-chart" role="group" aria-label={ariaLabel}>
      <ChartViewportToolbar
        viewport={currentViewport}
        dataLength={data.length}
        onPanBackward={panBackward}
        onPanForward={panForward}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onReset={reset}
      />
      <p className="chart-interaction-help" id={instructionsId}>
        Перетаскивайте график или нижний диапазон. Для масштаба используйте Ctrl + колесо или два пальца.
      </p>
      <div
        className="interactive-chart-surface"
        ref={surfaceRef}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={instructionsId}
      >
        <div className="interactive-chart-canvas" ref={chartMountRef} aria-hidden="true" />
      </div>
    </div>
  )
}
