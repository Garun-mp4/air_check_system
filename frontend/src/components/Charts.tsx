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

export const co2Thresholds: ChartThreshold[] = [
  { value: 800, label: '800 · внимание', color: defaultChartPalette.warning },
  { value: 1000, label: '1000 · критично', color: defaultChartPalette.error },
]

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
): EChartsOption {
  const data = validData(inputData)
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

  return {
    animation: true,
    animationDuration: 220,
    animationDurationUpdate: 160,
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
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params]
        const item = items[0] as { value?: unknown; axisValue?: string | number } | undefined
        const rawValue = Array.isArray(item?.value) ? item.value[1] : item?.value
        const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue)
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
        start: 0,
        end: 100,
        zoomOnMouseWheel: 'ctrl',
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
        throttle: 40,
      },
      {
        id: 'range-slider',
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        bottom: 8,
        height: 18,
        showDetail: false,
        showDataShadow: false,
        brushSelect: false,
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
      data: data.map((point) => [point.timestamp, point.value]),
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
        focus: 'series',
        scale: true,
        itemStyle: {
          color: palette.canvas,
          borderColor: palette.ink,
          borderWidth: 2,
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
    <div className="chart-viewport-toolbar" aria-label="Управление масштабом графика">
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
  const dataRef = useRef<SeriesPoint[]>(inputData)
  const [viewport, setViewport] = useState<ChartViewport>(() => createFullViewport(inputData.length))
  const data = useMemo(() => validData(inputData), [inputData])
  const dataKey = data.length === 0
    ? 'empty'
    : data.map((point) => point.timestamp + ':' + point.value).join('|')
  const thresholdKey = thresholds.map((threshold) => threshold.value + ':' + threshold.label + ':' + threshold.color).join('|')
  const hasData = data.length > 0
  dataRef.current = data

  const currentViewport = clampViewport(viewport, data.length)

  useEffect(() => {
    const chartMount = chartMountRef.current
    if (!chartMount || !hasData) {
      return
    }

    const chart = init(chartMount, undefined, {
      renderer: 'canvas',
      useDirtyRect: true,
    })
    chartRef.current = chart

    const handleDataZoom = (event: unknown) => {
      const nextViewport = viewportFromDataZoomEvent(event, dataRef.current)
      if (nextViewport) {
        setViewport(nextViewport)
      }
    }
    dataZoomHandlerRef.current = handleDataZoom

    const observer = new ResizeObserver(() => chart.resize())
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

    const palette = readChartPalette(surface)
    chart.setOption(buildTimeSeriesOption(data, unit, thresholds, palette), { notMerge: true })
    if (!dataZoomBoundRef.current && dataZoomHandler) {
      chart.on('datazoom', dataZoomHandler)
      dataZoomBoundRef.current = true
    }

    const shouldResetViewport = !hasAppliedDataRef.current || previousRangeKeyRef.current !== rangeKey
    hasAppliedDataRef.current = true
    previousRangeKeyRef.current = rangeKey
    setViewport((current) => shouldResetViewport
      ? createFullViewport(data.length)
      : clampViewport(current, data.length))
  }, [dataKey, data, unit, thresholdKey, rangeKey])

  const dispatchViewport = (nextViewport: ChartViewport) => {
    const next = clampViewport(nextViewport, data.length)
    setViewport(next)

    const chart = chartRef.current
    if (!chart || data.length === 0) {
      return
    }

    const startIndex = Math.round(next.start)
    const endIndex = Math.round(next.end)
    chart.dispatchAction({
      type: 'dataZoom',
      startValue: data[startIndex]?.timestamp,
      endValue: data[endIndex]?.timestamp,
    })
  }

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
