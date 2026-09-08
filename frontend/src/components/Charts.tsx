import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PointerEvent, WheelEvent } from 'react'

const chartWidth = 720
const chartHeight = 220
const chartPadding = { top: 12, right: 12, bottom: 28, left: 52 }
const maxRenderedPoints = 160
const minVisiblePoints = 6

interface SeriesPoint {
  timestamp: string
  value: number
}

interface ChartProps {
  data: SeriesPoint[]
  unit: string
  ariaLabel: string
}

export interface ChartViewport {
  start: number
  end: number
}

interface PointerPosition {
  x: number
  y: number
}

type ChartGesture =
  | {
      type: 'pan'
      pointerId: number
      startX: number
      initialViewport: ChartViewport
    }
  | {
      type: 'pinch'
      startDistance: number
      startCenterX: number
      startCenterRatio: number
      initialViewport: ChartViewport
    }
  | null

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

function sampleItems<T>(data: T[]): T[] {
  if (data.length <= maxRenderedPoints) {
    return data
  }

  return Array.from({ length: maxRenderedPoints }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (data.length - 1)) / (maxRenderedPoints - 1),
    )
    return data[sourceIndex]
  })
}

function sampleSeries<T extends { timestamp: string }>(data: T[]): T[] {
  return sampleItems(data)
}

function formatAxisTime(timestamp: string, includeDay: boolean): string {
  return new Intl.DateTimeFormat('ru-RU', includeDay
    ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' },
  ).format(new Date(timestamp))
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

function lineGeometry(data: SeriesPoint[]) {
  const values = data.map((point) => point.value)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const spread = Math.max(rawMax - rawMin, 1)
  const min = rawMin - spread * 0.12
  const max = rawMax + spread * 0.12
  const innerWidth = chartWidth - chartPadding.left - chartPadding.right
  const innerHeight = chartHeight - chartPadding.top - chartPadding.bottom
  const points = data.map((point, index) => ({
    ...point,
    x:
      chartPadding.left +
      (data.length === 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth),
    y: chartPadding.top + ((max - point.value) / (max - min)) * innerHeight,
  }))
  return { min, max, points, innerWidth, innerHeight }
}

function pathFor(points: Array<{ x: number; y: number }>): string {
  return points
    .map((point, index) => (index === 0 ? 'M ' : 'L ') + point.x + ' ' + point.y)
    .join(' ')
}

function distanceBetween(first: PointerPosition, second: PointerPosition): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function chartRatioFromClientX(clientX: number, element: HTMLElement): number {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0) {
    return 0.5
  }
  const svgX = ((clientX - rect.left) / rect.width) * chartWidth
  const innerWidth = chartWidth - chartPadding.left - chartPadding.right
  return clamp((svgX - chartPadding.left) / innerWidth, 0, 1)
}

function indexFromRatio(ratio: number, length: number): number | null {
  if (length <= 0) {
    return null
  }
  return Math.round(clamp(ratio, 0, 1) * (length - 1))
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
        <button
          className="button-secondary chart-reset-button"
          type="button"
          onClick={onReset}
          disabled={isFullRange}
        >
          Сбросить
        </button>
      </div>
    </div>
  )
}

export function LineChart({ data, unit, ariaLabel }: ChartProps) {
  const instructionsId = useId()
  const [viewport, setViewport] = useState<ChartViewport>(() => createFullViewport(data.length))
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const pointersRef = useRef<Map<number, PointerPosition>>(new Map())
  const gestureRef = useRef<ChartGesture>(null)

  useEffect(() => {
    setViewport((current) => {
      if (data.length <= 1 || current.end === 0 || current.end >= data.length - 1) {
        return createFullViewport(data.length)
      }
      return clampViewport(current, data.length)
    })
    setActiveIndex(null)
  }, [data.length])

  const currentViewport = data.length > 1 && viewport.end === 0
    ? createFullViewport(data.length)
    : clampViewport(viewport, data.length)
  const visibleData = useMemo(() => (
    sampleSeries(data.slice(Math.floor(currentViewport.start), Math.ceil(currentViewport.end) + 1))
  ), [data, currentViewport.end, currentViewport.start])

  if (data.length === 0) {
    return <div className="chart-empty">Нет данных за выбранный период</div>
  }

  const safeViewport = currentViewport
  const geometry = lineGeometry(visibleData)
  const guideValues = [0, 0.5, 1].map(
    (fraction) => geometry.max - (geometry.max - geometry.min) * fraction,
  )
  const labelIndexes = Array.from(
    new Set([0, Math.floor((visibleData.length - 1) / 2), visibleData.length - 1]),
  )
  const includeDay = visibleData.length > 1 && hasCalendarDayChange(
    visibleData[0].timestamp,
    visibleData.at(-1)?.timestamp ?? visibleData[0].timestamp,
  )
  const activePoint = activeIndex === null ? null : geometry.points[activeIndex]

  const updateViewport = (nextViewport: ChartViewport) => {
    setViewport(clampViewport(nextViewport, data.length))
    setActiveIndex(null)
  }

  const getRatio = (clientX: number, element: HTMLElement) => chartRatioFromClientX(clientX, element)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }

    const surface = event.currentTarget
    const pointers = pointersRef.current
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    surface.setPointerCapture(event.pointerId)
    event.preventDefault()
    setActiveIndex(null)

    if (pointers.size >= 2) {
      const positions = Array.from(pointers.values()).slice(0, 2)
      const first = positions[0]
      const second = positions[1]
      gestureRef.current = {
        type: 'pinch',
        startDistance: Math.max(distanceBetween(first, second), 1),
        startCenterX: (first.x + second.x) / 2,
        startCenterRatio: getRatio((first.x + second.x) / 2, surface),
        initialViewport: currentViewport,
      }
      return
    }

    gestureRef.current = {
      type: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      initialViewport: currentViewport,
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const surface = event.currentTarget
    const pointers = pointersRef.current
    if (!pointers.has(event.pointerId)) {
      setActiveIndex(indexFromRatio(getRatio(event.clientX, surface), visibleData.length))
      return
    }

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const gesture = gestureRef.current
    if (!gesture) {
      return
    }

    if (pointers.size >= 2 && gesture.type === 'pinch') {
      const positions = Array.from(pointers.values()).slice(0, 2)
      const first = positions[0]
      const second = positions[1]
      const currentCenterX = (first.x + second.x) / 2
      const currentDistance = Math.max(distanceBetween(first, second), 1)
      const zoomed = zoomViewport(
        gesture.initialViewport,
        gesture.startCenterRatio,
        gesture.startDistance / currentDistance,
        data.length,
      )
      const rect = surface.getBoundingClientRect()
      const centerDelta = rect.width > 0
        ? ((currentCenterX - gesture.startCenterX) / rect.width) * (gesture.initialViewport.end - gesture.initialViewport.start)
        : 0
      updateViewport(panViewport(zoomed, -centerDelta, data.length))
      return
    }

    if (pointers.size === 1 && gesture.type === 'pan' && gesture.pointerId === event.pointerId) {
      const rect = surface.getBoundingClientRect()
      const span = gesture.initialViewport.end - gesture.initialViewport.start
      const deltaPoints = rect.width > 0 ? -((event.clientX - gesture.startX) / rect.width) * span : 0
      updateViewport(panViewport(gesture.initialViewport, deltaPoints, data.length))
    }
  }

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    gestureRef.current = null
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) {
      return
    }
    event.preventDefault()
    const delta = clamp(event.deltaY / 240, -1, 1)
    const scale = Math.exp(delta)
    updateViewport(zoomViewport(currentViewport, getRatio(event.clientX, event.currentTarget), scale, data.length))
  }

  const zoomIn = () => updateViewport(zoomViewport(currentViewport, 0.5, 0.65, data.length))
  const zoomOut = () => updateViewport(zoomViewport(currentViewport, 0.5, 1.5, data.length))
  const panBackward = () => {
    const span = Math.max(1, currentViewport.end - currentViewport.start)
    updateViewport(panViewport(currentViewport, -span * 0.65, data.length))
  }
  const panForward = () => {
    const span = Math.max(1, currentViewport.end - currentViewport.start)
    updateViewport(panViewport(currentViewport, span * 0.65, data.length))
  }
  const reset = () => updateViewport(createFullViewport(data.length))

  return (
    <div className="interactive-chart" role="group" aria-label={ariaLabel}>
      <ChartViewportToolbar
        viewport={safeViewport}
        dataLength={data.length}
        onPanBackward={panBackward}
        onPanForward={panForward}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onReset={reset}
      />
      <p className="chart-interaction-help" id={instructionsId}>
        Перетаскивайте график. Для масштаба используйте Ctrl + колесо или два пальца.
      </p>
      <div
        className="interactive-chart-surface"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={() => {
          if (pointersRef.current.size === 0) {
            setActiveIndex(null)
          }
        }}
        onWheel={handleWheel}
        aria-describedby={instructionsId}
      >
        <svg
          className="chart-svg"
          viewBox={'0 0 ' + chartWidth + ' ' + chartHeight}
          role="img"
          aria-label={ariaLabel}
        >
          <title>{ariaLabel}</title>
          {guideValues.map((value, index) => {
            const y = chartPadding.top + geometry.innerHeight * (index / 2)
            return (
              <g key={value}>
                <line
                  className="chart-grid-line"
                  x1={chartPadding.left}
                  x2={chartWidth - chartPadding.right}
                  y1={y}
                  y2={y}
                />
                <text className="chart-axis-label" x="0" y={y + 4}>
                  {formatChartValue(value, unit)}
                </text>
              </g>
            )
          })}
          <path className="chart-series" d={pathFor(geometry.points)} />
          {visibleData.length <= 24
            ? geometry.points.map((point, index) => (
                <circle
                  className="chart-point"
                  key={point.timestamp + '-' + index}
                  cx={point.x}
                  cy={point.y}
                  r="3"
                />
              ))
            : null}
          {activePoint && activeIndex !== null ? (
            <g className="chart-focus" aria-hidden="true">
              <line
                className="chart-focus-line"
                x1={activePoint.x}
                x2={activePoint.x}
                y1={chartPadding.top}
                y2={chartHeight - chartPadding.bottom}
              />
              <circle className="chart-focus-point" cx={activePoint.x} cy={activePoint.y} r="5" />
              <text
                className="chart-focus-label"
                x={clamp(activePoint.x, chartPadding.left + 34, chartWidth - chartPadding.right - 34)}
                y={Math.max(chartPadding.top + 12, activePoint.y - 12)}
                textAnchor="middle"
              >
                {formatChartValue(activePoint.value, unit)}
              </text>
            </g>
          ) : null}
          {labelIndexes.map((index) => {
            const point = geometry.points[index]
            return (
              <text
                className="chart-axis-label"
                key={visibleData[index].timestamp + '-' + index}
                x={point.x}
                y={chartHeight - 4}
                textAnchor={index === 0 ? 'start' : index === visibleData.length - 1 ? 'end' : 'middle'}
              >
                {formatAxisTime(visibleData[index].timestamp, includeDay)}
              </text>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
