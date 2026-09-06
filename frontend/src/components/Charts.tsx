import type { ClientMeasurement } from '../lib/client-api'

const chartWidth = 720
const chartHeight = 220
const chartPadding = { top: 12, right: 12, bottom: 28, left: 42 }

interface SeriesPoint {
  timestamp: string
  value: number
}

interface ChartProps {
  data: SeriesPoint[]
  unit: string
  ariaLabel: string
}

function formatAxisTime(timestamp: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
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

export function LineChart({ data, unit, ariaLabel }: ChartProps) {
  if (data.length === 0) {
    return <div className="chart-empty">Нет данных за выбранный период</div>
  }
  const geometry = lineGeometry(data)
  const guideValues = [0, 0.5, 1].map(
    (fraction) => geometry.max - (geometry.max - geometry.min) * fraction,
  )
  const labelIndexes = Array.from(
    new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]),
  )

  return (
    <svg
      className="chart-svg"
      viewBox={'0 0 ' + chartWidth + ' ' + chartHeight}
      role="img"
      aria-label={ariaLabel}
    >
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
              {Math.round(value)} {unit}
            </text>
          </g>
        )
      })}
      <path className="chart-series" d={pathFor(geometry.points)} />
      {geometry.points.map((point, index) => (
        <circle
          className="chart-point"
          key={point.timestamp + '-' + index}
          cx={point.x}
          cy={point.y}
          r="3"
        />
      ))}
      {labelIndexes.map((index) => {
        const point = geometry.points[index]
        return (
          <text
            className="chart-axis-label"
            key={data[index].timestamp + '-' + index}
            x={point.x}
            y={chartHeight - 4}
            textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
          >
            {formatAxisTime(data[index].timestamp)}
          </text>
        )
      })}
    </svg>
  )
}

export function WindowChart({
  data,
  ariaLabel,
}: {
  data: ClientMeasurement[]
  ariaLabel: string
}) {
  if (data.length === 0) {
    return <div className="chart-empty">Нет данных за выбранный период</div>
  }
  const innerWidth = chartWidth - chartPadding.left - chartPadding.right
  const usableWidth = Math.max(innerWidth / data.length, 4)
  const barWidth = Math.max(usableWidth - 2, 2)
  const labelIndexes = Array.from(
    new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]),
  )

  return (
    <svg
      className="chart-svg"
      viewBox={'0 0 ' + chartWidth + ' ' + chartHeight}
      role="img"
      aria-label={ariaLabel}
    >
      <line
        className="chart-grid-line"
        x1={chartPadding.left}
        x2={chartWidth - chartPadding.right}
        y1={chartPadding.top + 34}
        y2={chartPadding.top + 34}
      />
      <line
        className="chart-grid-line"
        x1={chartPadding.left}
        x2={chartWidth - chartPadding.right}
        y1={chartPadding.top + 100}
        y2={chartPadding.top + 100}
      />
      {data.map((measurement, index) => (
        <rect
          className={
            measurement.window_open
              ? 'chart-window-open'
              : 'chart-window-closed'
          }
          key={measurement.id}
          x={chartPadding.left + index * usableWidth}
          y={chartPadding.top + 66}
          width={barWidth}
          height="34"
          rx="2"
        />
      ))}
      <text
        className="chart-axis-label"
        x={chartPadding.left}
        y={chartPadding.top + 24}
      >
        открыто
      </text>
      <text
        className="chart-axis-label"
        x={chartPadding.left}
        y={chartPadding.top + 124}
      >
        закрыто
      </text>
      {labelIndexes.map((index) => (
        <text
          className="chart-axis-label"
          key={data[index].timestamp + '-' + index}
          x={
            chartPadding.left +
            (data.length === 1
              ? innerWidth / 2
              : (index / (data.length - 1)) * innerWidth)
          }
          y={chartHeight - 4}
          textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
        >
          {formatAxisTime(data[index].timestamp)}
        </text>
      ))}
    </svg>
  )
}
