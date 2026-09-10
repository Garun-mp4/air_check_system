'use client'

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'

import {
  ClientApiError,
  getControlStatus,
  getHistory,
  getLatestDashboard,
  getNodeSettings,
  sendControlCommand,
  sendVentilationCommand,
  updateNodeSettings,
  type ClientControlAction,
  type ClientControlStatus,
  type ClientControlTarget,
  type ClientMeasurement,
  type ClientNodeSettings,
  type ClientNodeSettingsPatch,
  type ClientPrediction,
  type ClientRecommendation,
  type ClientVentilationAction,
  type DashboardData,
} from '../lib/client-api'
import {
  PM25_ELEVATED_LIMIT,
  PM25_GOOD_LIMIT,
  PM25_SCALE_MAX,
  type Pm25Thresholds,
  getPm25AriaLabel,
  getPm25Label,
  getPm25Level,
  getPm25MarkerPosition,
  getPm25Tone,
} from '../lib/air-quality'
import { getCo2Thresholds, LineChart, type ChartViewport } from './Charts'

export type RangeKey = '30m' | '1h' | '6h' | '24h'
type SettingsTab = 'automation' | 'thresholds' | 'technical'
type IconName =
  | 'air'
  | 'exhaust'
  | 'intake'
  | 'temperature'
  | 'humidity'
  | 'pm25'
  | 'room'
  | 'window'
  | 'database'
  | 'model'
  | 'wifi'
  | 'refresh'
  | 'settings'
  | 'expand'
  | 'menu'
  | 'close'
  | 'clock'
  | 'arrow'

export const dashboardNavItems = [
  { id: 'overview', label: 'Панель', shortLabel: 'Панель', icon: 'room' },
  { id: 'controls', label: 'Управление', shortLabel: 'Управл.', icon: 'air' },
  { id: 'signals', label: 'Сенсоры', shortLabel: 'Сенсоры', icon: 'pm25' },
  { id: 'history', label: 'История', shortLabel: 'История', icon: 'clock' },
] as const

export const primaryNavItems = [
  ...dashboardNavItems,
  { id: 'settings', label: 'Настройки', shortLabel: 'Настр.', icon: 'settings' },
] as const

type DashboardSectionId = (typeof dashboardNavItems)[number]['id']
export type DashboardViewId = DashboardSectionId | 'settings'

export const rangeMinutes: Record<RangeKey, number> = {
  '30m': 30,
  '1h': 60,
  '6h': 6 * 60,
  '24h': 24 * 60,
}

export const rangeLabels: Record<RangeKey, string> = {
  '30m': '30 мин',
  '1h': '1 ч',
  '6h': '6 ч',
  '24h': '24 ч',
}

export function getSectionIdFromHash(hash: string): DashboardSectionId {
  const sectionId = hash.startsWith('#') ? hash.slice(1) : hash
  return dashboardNavItems.some((item) => item.id === sectionId)
    ? (sectionId as DashboardSectionId)
    : 'overview'
}

export function getViewIdFromHash(hash: string): DashboardViewId {
  const sectionId = hash.startsWith('#') ? hash.slice(1) : hash
  return sectionId === 'settings' ? 'settings' : getSectionIdFromHash(hash)
}

export function DashboardNavigation({
  className,
  label,
  linkClassName,
  activeSection,
  onNavigate,
}: {
  className?: string
  label: string
  linkClassName: string
  activeSection: DashboardViewId
  onNavigate: (sectionId: DashboardViewId, event: MouseEvent<HTMLAnchorElement>) => void
}) {
  return (
    <nav className={className} aria-label={label}>
      {primaryNavItems.map((item) => {
        const isActive = activeSection === item.id
        return (
          <a
            data-navigation-item={item.id}
            className={linkClassName + (isActive ? ' is-active' : '')}
            href={'#' + item.id}
            key={item.id}
            onClick={(event) => onNavigate(item.id, event)}
            aria-current={isActive ? 'location' : undefined}
          >
            <span className="nav-link-icon"><Icon name={item.icon} /></span>
            <span className="nav-link-label-full">{item.label}</span>
            <span className="nav-link-label-short" aria-hidden="true">{item.shortLabel}</span>
          </a>
        )
      })}
    </nav>
  )
}

const recommendationLabels: Record<ClientRecommendation['type'], string> = {
  normal: 'Норма',
  monitor: 'Наблюдать',
  forecast_warning: 'Прогноз выше нормы',
  ventilate_now: 'Проветрить сейчас',
  ventilating: 'Проветривание',
}

function formatValue(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value)
}

type AirComparisonMetric = {
  key: 'temperature' | 'humidity' | 'pm25'
  label: string
  icon: 'temperature' | 'humidity' | 'pm25'
  indoor: number | null
  outdoor: number | null
  unit: string
  digits: number
}

type AirComparisonInsight = {
  tone: 'success' | 'warning' | 'neutral'
  title: string
  detail: string
}

function formatMetricValue(
  value: number | null | undefined,
  fractionDigits: number,
  unit: string,
): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : formatValue(value, fractionDigits) + ' ' + unit
}

function formatSignedMetric(
  value: number | null,
  fractionDigits: number,
  unit: string,
): string {
  if (value === null || !Number.isFinite(value)) {
    return '—'
  }
  if (Math.abs(value) < 0.05) {
    return '0 ' + unit
  }
  return (value > 0 ? '+' : '') + formatValue(value, fractionDigits) + ' ' + unit
}

function getAirComparisonMetrics(
  measurement: ClientMeasurement | null,
): AirComparisonMetric[] {
  return [
    {
      key: 'temperature',
      label: 'Температура',
      icon: 'temperature',
      indoor: measurement?.indoor.temperature ?? null,
      outdoor: measurement?.outdoor.temperature ?? null,
      unit: '°C',
      digits: 1,
    },
    {
      key: 'humidity',
      label: 'Влажность',
      icon: 'humidity',
      indoor: measurement?.indoor.humidity ?? null,
      outdoor: measurement?.outdoor.humidity ?? null,
      unit: '%',
      digits: 0,
    },
    {
      key: 'pm25',
      label: 'PM2.5',
      icon: 'pm25',
      indoor: measurement?.indoor.pm25 ?? null,
      outdoor: measurement?.outdoor.pm25 ?? null,
      unit: 'µg/m³',
      digits: 1,
    },
  ]
}

function getAirComparisonInsight(
  measurement: ClientMeasurement | null,
): AirComparisonInsight {
  const indoorPm25 = measurement?.indoor.pm25
  const outdoorPm25 = measurement?.outdoor.pm25
  if (
    indoorPm25 === undefined ||
    outdoorPm25 === undefined ||
    !Number.isFinite(indoorPm25) ||
    !Number.isFinite(outdoorPm25)
  ) {
    return {
      tone: 'neutral',
      title: 'Сравнение появится после показаний',
      detail: 'Нужны одновременно значения внутри комнаты и снаружи.',
    }
  }

  const pm25Delta = indoorPm25 - outdoorPm25
  if (pm25Delta <= -2) {
    return {
      tone: 'success',
      title: 'Внутри сейчас чище',
      detail:
        'PM2.5 внутри ниже наружного уровня на ' +
        formatValue(Math.abs(pm25Delta), 1) +
        ' µg/m³. По этому показателю внешний воздух не ухудшает текущую оценку комнаты.',
    }
  }
  if (pm25Delta >= 2) {
    return {
      tone: 'warning',
      title: 'Внутри PM2.5 выше',
      detail:
        'PM2.5 внутри выше наружного уровня на ' +
        formatValue(pm25Delta, 1) +
        ' µg/m³. Проверьте источник загрязнения и состояние фильтра притока.',
    }
  }
  return {
    tone: 'neutral',
    title: 'Показатели PM2.5 близки',
    detail:
      'Разница между комнатой и улицей меньше 2 µg/m³. Решение о проветривании лучше принимать вместе с CO₂ и прогнозом.',
  }
}

function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return 'нет данных'
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function formatTime(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return '—'
  }
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export interface WindowHistorySummary {
  transitionCount: number
  lastChange: {
    from: boolean
    to: boolean
    timestamp: string
  } | null
}

export function getWindowHistorySummary(
  measurements: ClientMeasurement[],
): WindowHistorySummary {
  const ordered = measurements
    .filter((measurement) => Boolean(measurement.timestamp))
    .slice()
    .sort((first, second) => (
      new Date(first.timestamp).getTime() - new Date(second.timestamp).getTime()
    ))

  let transitionCount = 0
  let lastChange: WindowHistorySummary['lastChange'] = null

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (previous.window_open !== current.window_open) {
      transitionCount += 1
      lastChange = {
        from: previous.window_open,
        to: current.window_open,
        timestamp: current.timestamp,
      }
    }
  }

  return { transitionCount, lastChange }
}

function formatTransitionCount(count: number): string {
  if (count === 0) {
    return 'без изменений'
  }
  if (count % 10 === 1 && count % 100 !== 11) {
    return count + ' изменение'
  }
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) {
    return count + ' изменения'
  }
  return count + ' изменений'
}

type Co2Thresholds = {
  normal: number
  critical: number
}

const defaultCo2Thresholds: Co2Thresholds = {
  normal: 800,
  critical: 1000,
}

function co2BadgeClass(
  value: number | null | undefined,
  thresholds: Co2Thresholds = defaultCo2Thresholds,
): string {
  if (value === null || value === undefined) {
    return 'badge-neutral'
  }
  if (value >= thresholds.critical) {
    return 'badge-error'
  }
  if (value >= thresholds.normal) {
    return 'badge-warning'
  }
  return 'badge-success'
}

function co2Label(
  value: number | null | undefined,
  thresholds: Co2Thresholds = defaultCo2Thresholds,
): string {
  if (value === null || value === undefined) {
    return 'Ожидание данных'
  }
  if (value >= thresholds.critical) {
    return 'Нужна вентиляция'
  }
  if (value >= thresholds.normal) {
    return 'Зона внимания'
  }
  return 'В комфортной зоне'
}

function recommendationTone(
  recommendation: ClientRecommendation | null,
): string {
  if (!recommendation) {
    return 'neutral'
  }
  if (recommendation.type === 'normal') {
    return 'success'
  }
  if (recommendation.type === 'ventilate_now') {
    return 'error'
  }
  return 'warning'
}

function controlTone(status: ClientControlStatus | null): string {
  if (!status) {
    return 'neutral'
  }
  const synchronized =
    status.reported.exhaust_on === status.desired.exhaust_on &&
    status.reported.intake_on === status.desired.intake_on &&
    status.reported.window_open === status.desired.window_open
  if (status.connection.status === 'online' && status.pending_commands === 0 && synchronized) {
    return 'success'
  }
  if (status.connection.status === 'offline') {
    return 'error'
  }
  return 'warning'
}

export function getConnectionStatusLabel(
  status: ClientControlStatus['connection']['status'] | null | undefined,
): string {
  if (status === 'online') {
    return 'в сети'
  }
  if (status === 'stale') {
    return 'связь нестабильна'
  }
  if (status === 'offline') {
    return 'нет связи'
  }
  return 'нет данных'
}

function controlConnectionLabel(status: ClientControlStatus | null): string {
  if (!status) {
    return 'нет данных'
  }
  return getConnectionStatusLabel(status.connection.status)
}

function controlStateLabel(target: ClientControlTarget, active: boolean): string {
  if (target === 'window') {
    return active ? 'Открыто' : 'Закрыто'
  }
  return active ? 'Включена' : 'Выключена'
}

function controlActionLabel(target: ClientControlTarget, action: ClientControlAction): string {
  if (target === 'window') {
    return action === 'open' ? 'открытие окна' : action === 'close' ? 'закрытие окна' : 'автоматический режим окна'
  }
  const label = target === 'exhaust' ? 'вытяжку' : 'приток'
  return (action === 'on' ? 'включение ' : 'выключение ') + label
}

function getCo2Change(
  measurements: ClientMeasurement[],
  minutes: number,
): number | null {
  const latest = measurements.at(-1)
  if (!latest) {
    return null
  }
  const cutoff = Date.parse(latest.timestamp) - minutes * 60 * 1000
  let reference: ClientMeasurement | null = null
  for (const item of measurements) {
    if (Date.parse(item.timestamp) <= cutoff) {
      reference = item
    }
  }
  return reference ? latest.indoor.co2 - reference.indoor.co2 : null
}

function formatDelta(value: number | null, minutes: number): string {
  if (value === null) {
    return 'нет базовой точки'
  }
  if (Math.abs(value) < 0.05) {
    return 'без изменений'
  }
  return (value > 0 ? '+' : '') + formatValue(value, 0) + ' ppm за ' + minutes + ' мин'
}

function Icon({ name }: { name: IconName }) {
  const svgProps = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  if (name === 'temperature') {
    return (
      <svg {...svgProps}>
        <path d="M14 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0Z" />
        <path d="M12 11v6" />
      </svg>
    )
  }
  if (name === 'humidity') {
    return (
      <svg {...svgProps}>
        <path d="M12 3s6 6.3 6 11a6 6 0 0 1-12 0c0-4.7 6-11 6-11Z" />
        <path d="M9.5 15.5a2.8 2.8 0 0 0 2.5 1.5" />
      </svg>
    )
  }
  if (name === 'pm25') {
    return (
      <svg {...svgProps}>
        <circle cx="7" cy="8" r="2" />
        <circle cx="16.5" cy="6" r="1.5" />
        <circle cx="15" cy="16" r="2.5" />
        <path d="m8.5 9.5 4.5 4M15 8l.2 4.5M9 8h5.5" />
      </svg>
    )
  }
  if (name === 'window') {
    return (
      <svg {...svgProps}>
        <path d="M4 4h16v16H4zM12 4v16M4 12h16" />
        <path d="m8 8 2 2M16 16l-2-2" />
      </svg>
    )
  }
  if (name === 'room') {
    return (
      <svg {...svgProps}>
        <path d="m3.5 10.5 8.5-7 8.5 7v9h-17z" />
        <path d="M9 19.5v-5h6v5" />
      </svg>
    )
  }
  if (name === 'database') {
    return (
      <svg {...svgProps}>
        <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
        <path d="M5 5.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6M5 11.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6" />
      </svg>
    )
  }
  if (name === 'model') {
    return (
      <svg {...svgProps}>
        <path d="m12 3 1.8 5.4L19 10l-5.2 1.7L12 17l-1.8-5.3L5 10l5.2-1.6L12 3Z" />
        <path d="m19 15 .7 2.1L22 18l-2.3.8L19 21l-.7-2.2L16 18l2.3-.9L19 15Z" />
      </svg>
    )
  }
  if (name === 'wifi') {
    return (
      <svg {...svgProps}>
        <path d="M4 9.5a12.2 12.2 0 0 1 16 0M7 13a7.8 7.8 0 0 1 10 0M10 16.5a3.5 3.5 0 0 1 4 0" />
        <circle cx="12" cy="20" r=".7" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (name === 'refresh') {
    return (
      <svg {...svgProps}>
        <path d="M20 11a8 8 0 0 0-14.7-3L4 10" />
        <path d="M4 5v5h5M4 13a8 8 0 0 0 14.7 3L20 14" />
        <path d="M20 19v-5h-5" />
      </svg>
    )
  }
  if (name === 'settings') {
    return (
      <svg {...svgProps}>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  }
  if (name === 'expand') {
    return (
      <svg {...svgProps}>
        <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" />
      </svg>
    )
  }
  if (name === 'menu') {
    return (
      <svg {...svgProps}>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    )
  }
  if (name === 'close') {
    return (
      <svg {...svgProps}>
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    )
  }
  if (name === 'clock') {
    return (
      <svg {...svgProps}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3.5 2" />
      </svg>
    )
  }
  if (name === 'arrow') {
    return (
      <svg {...svgProps}>
        <path d="M4 12h15M13 6l6 6-6 6" />
      </svg>
    )
  }
  if (name === 'air') {
    return (
      <svg {...svgProps}>
        <path d="M4 9h10.5a2.5 2.5 0 1 0-2.1-3.8M4 13h14a2.5 2.5 0 1 1-2.1 3.8M4 17h7" />
      </svg>
    )
  }
  if (name === 'exhaust') {
    return (
      <svg {...svgProps}>
        <path d="M4 8h14M15 5l3 3-3 3M4 16h10" />
        <path d="M12 13l3 3-3 3" />
      </svg>
    )
  }
  if (name === 'intake') {
    return (
      <svg {...svgProps}>
        <path d="M20 8H6M9 5 6 8l3 3M20 16H10" />
        <path d="m12 13-3 3 3 3" />
      </svg>
    )
  }
  return (
    <svg {...svgProps}>
      <path d="M4 12h16M7 8h10M7 16h10" />
      <path d="M5 6h14M5 18h14" />
    </svg>
  )
}

function ActuatorRow({
  target,
  icon,
  label,
  description,
  active,
  desiredActive,
  pending,
}: {
  target: 'exhaust' | 'intake'
  icon: 'exhaust' | 'intake'
  label: string
  description: string
  active: boolean
  desiredActive: boolean
  pending: boolean
}) {
  const desiredDiffers = active !== desiredActive
  return (
    <div className="actuator-row">
      <span className={'actuator-icon actuator-icon-' + (active ? 'on' : 'off')}>
        <Icon name={icon} />
      </span>
      <div className="actuator-copy">
        <strong>{label}</strong>
        <span>{description}</span>
        {desiredDiffers ? <small>задано: {desiredActive ? 'включить' : 'выключить'}</small> : null}
      </div>
      <div className="actuator-action">
        <span
          className={'control-state-badge control-state-badge-' + (active ? 'on' : 'off')}
          title={pending ? 'Ожидается подтверждение локального узла' : undefined}
        >
          {controlStateLabel(target, active)}
        </span>
        {pending ? <small className="actuator-pending-label">ожидание подтверждения</small> : null}
      </div>
    </div>
  )
}

function ChartCard({
  title,
  caption,
  children,
  unit,
  range,
  onRangeChange,
}: {
  title: string
  caption: string
  children: (props: {
    viewport: ChartViewport | null
    onViewportChange: (viewport: ChartViewport) => void
  }) => ReactNode
  unit?: string
  range: RangeKey
  onRangeChange: (range: RangeKey) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [chartViewport, setChartViewport] = useState<ChartViewport | null>(null)
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const expandButtonRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const handleViewportChange = useCallback((nextViewport: ChartViewport) => {
    setChartViewport((current) => (
      current && current.start === nextViewport.start && current.end === nextViewport.end
        ? current
        : nextViewport
    ))
  }, [])

  useEffect(() => {
    if (!expanded) {
      return
    }

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    document.documentElement.classList.add('is-chart-expanded')
    document.body.classList.add('is-chart-expanded')

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setExpanded(false)
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const dialog = dialogRef.current
      if (!dialog) {
        return
      }
      const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const firstFocusable = focusableElements[0]
      const lastFocusable = focusableElements[focusableElements.length - 1]
      if (event.shiftKey && (document.activeElement === firstFocusable || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        lastFocusable?.focus()
      } else if (!event.shiftKey && (document.activeElement === lastFocusable || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        firstFocusable?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }))

    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      document.documentElement.classList.remove('is-chart-expanded')
      document.body.classList.remove('is-chart-expanded')
      const focusTarget = previouslyFocusedRef.current
      previouslyFocusedRef.current = null
      requestAnimationFrame(() => {
        const nextFocusTarget = expandButtonRef.current ?? focusTarget
        if (nextFocusTarget?.isConnected) {
          nextFocusTarget.focus({ preventScroll: true })
        }
      })
    }
  }, [expanded])

  const chartCard = (
    <article
      className={'dashboard-card chart-card' + (expanded ? ' is-expanded' : '')}
      ref={dialogRef}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={expanded ? -1 : undefined}
    >
      <div className="chart-card-header">
        <div>
          <span className="chart-card-context">{caption}</span>
          <h3 id={titleId}>{title}</h3>
        </div>
        <div className="chart-card-actions">
          {expanded ? <RangeControl range={range} onChange={onRangeChange} compact /> : null}
          <div className="chart-card-meta">
            {unit ? <span className="chart-card-unit">{unit}</span> : null}
          </div>
          <button
            className="button-icon-circular chart-expand-button"
            type="button"
            ref={expanded ? closeButtonRef : expandButtonRef}
            onClick={() => setExpanded((current) => !current)}
            aria-label={expanded ? 'Закрыть увеличенный график' : 'Открыть график почти на весь экран'}
            title={expanded ? 'Закрыть график' : 'Открыть график'}
          >
            <Icon name={expanded ? 'close' : 'expand'} />
          </button>
        </div>
      </div>
      <div className="chart-shell">{children({
        viewport: chartViewport,
        onViewportChange: handleViewportChange,
      })}</div>
    </article>
  )

  if (!expanded || typeof document === 'undefined') {
    return chartCard
  }

  return createPortal(
    <>
      <button
        className="chart-modal-backdrop"
        type="button"
        tabIndex={-1}
        aria-label={'Закрыть график «' + title + '»'}
        onClick={() => setExpanded(false)}
      />
      {chartCard}
    </>,
    document.body,
  )
}

function RangeControl({
  range,
  onChange,
  compact = false,
}: {
  range: RangeKey
  onChange: (range: RangeKey) => void
  compact?: boolean
}) {
  return (
    <div className={'range-control' + (compact ? ' range-control-compact' : '')}>
      <span className="range-label">период</span>
      <div className="range-tabs" role="group" aria-label="Период истории">
        {(Object.keys(rangeLabels) as RangeKey[]).map((key) => (
          <button
            className={'range-tab ' + (range === key ? 'is-active' : '')}
            type="button"
            key={key}
            onClick={() => onChange(key)}
            aria-pressed={range === key}
          >
            {rangeLabels[key]}
          </button>
        ))}
      </div>
    </div>
  )
}

type AirContextMetricProps = {
  icon: 'temperature' | 'humidity' | 'window'
  label: string
  value: string
  unit?: string
  tone?: 'success' | 'neutral'
  detail?: string
  className?: string
}

function AirContextMetric({
  icon,
  label,
  value,
  unit,
  tone = 'neutral',
  detail,
  className = '',
}: AirContextMetricProps) {
  return (
    <span className={'air-context-card-metric ' + className}>
      <span className="air-context-card-metric-label">
        <span className="air-context-card-metric-icon"><Icon name={icon} /></span>
        <span>{label}</span>
      </span>
      <strong className={'air-context-card-metric-value air-context-card-metric-value-' + tone}>
        {value}
        {unit ? <small>{unit}</small> : null}
      </strong>
      {detail ? <span className="air-context-card-metric-detail">{detail}</span> : null}
    </span>
  )
}

function AirContextPm25Metric({
  value,
  thresholds,
}: {
  value: number | null | undefined
  thresholds: Pm25Thresholds
}) {
  const level = getPm25Level(value, thresholds)
  const tone = getPm25Tone(level)
  const scaleMax = Math.max(
    PM25_SCALE_MAX,
    Math.ceil((thresholds.elevated * 1.4) / 5) * 5,
  )
  const markerPosition = getPm25MarkerPosition(value, scaleMax)
  const goodPosition = Math.min(97, Math.max(3, (thresholds.good / scaleMax) * 100))
  const elevatedPosition = Math.min(
    98,
    Math.max(goodPosition + 1, (thresholds.elevated / scaleMax) * 100),
  )

  return (
    <span className="air-context-card-metric air-context-card-metric-pm25">
      <span className="air-context-card-metric-label">
        <span className="air-context-card-metric-icon"><Icon name="pm25" /></span>
        <span>PM2.5</span>
      </span>
      <strong className="air-context-card-metric-value">
        {formatValue(value, 1)}
        <small>µg/m³</small>
      </strong>
      <span className={'air-context-card-pm25-status pm25-quality-status-' + tone}>
        <span className={'status-dot status-dot-' + tone} />
        {getPm25Label(level)}
      </span>
      <span className="air-context-card-pm25-scale" role="img" aria-label={getPm25AriaLabel(value, thresholds)}>
        <span className="air-context-card-pm25-track">
          <span className="pm25-scale-zone pm25-scale-zone-good" style={{ width: goodPosition + '%' }} />
          <span className="pm25-scale-zone pm25-scale-zone-elevated" style={{ width: elevatedPosition - goodPosition + '%' }} />
          <span className="pm25-scale-zone pm25-scale-zone-high" style={{ width: 100 - elevatedPosition + '%' }} />
        </span>
        {markerPosition !== null ? (
          <span
            className="air-context-card-pm25-marker"
            style={{ left: markerPosition + '%' }}
            aria-hidden="true"
          />
        ) : null}
      </span>
      <span className="air-context-card-pm25-labels" aria-hidden="true">
        <span>0</span>
        <span style={{ left: goodPosition + '%' }}>{thresholds.good}</span>
        <span style={{ left: elevatedPosition + '%' }}>{thresholds.elevated}</span>
        <span>{scaleMax}+</span>
      </span>
    </span>
  )
}

export function AirContextCards({
  measurement = null,
  windowOpen,
  pm25Thresholds = { good: PM25_GOOD_LIMIT, elevated: PM25_ELEVATED_LIMIT },
}: {
  measurement?: ClientMeasurement | null
  windowOpen?: boolean | null
  pm25Thresholds?: Pm25Thresholds
}) {
  const resolvedWindowOpen = windowOpen ?? measurement?.window_open ?? null
  const windowLabel = resolvedWindowOpen === null ? '—' : resolvedWindowOpen ? 'Открыто' : 'Закрыто'
  const contexts = [
    {
      zone: 'indoor' as const,
      label: 'Внутри комнаты',
      title: 'Воздух в комнате',
      description: 'Температура, влажность, частицы и окно',
      image: '/air-context-indoor.png',
      icon: 'room' as const,
    },
    {
      zone: 'outdoor' as const,
      label: 'Снаружи',
      title: 'Внешний воздух',
      description: 'Показания за окном для сравнения',
      image: '/air-context-outdoor.png',
      icon: 'air' as const,
    },
  ]

  return (
    <div className="air-context-cards" role="group" aria-label="Контексты воздуха">
      {contexts.map((context) => (
        <article
          className={'air-context-card air-context-card-' + context.zone}
          key={context.zone}
          aria-label={context.title}
        >
          <span className="air-context-card-media" aria-hidden="true">
            <img src={context.image} alt="" width={1672} height={941} loading="lazy" decoding="async" />
          </span>
          <span className="air-context-card-content">
            <span className="air-context-card-heading">
              <span className="air-context-card-icon"><Icon name={context.icon} /></span>
              <span className="air-context-card-copy">
                <span className="air-context-card-label">{context.label}</span>
                <strong>{context.title}</strong>
              </span>
            </span>
            <span className="air-context-card-description">{context.description}</span>
            <span className="air-context-card-data" aria-label={context.zone === 'indoor' ? 'Показатели воздуха в комнате' : 'Показатели внешнего воздуха'}>
              <AirContextMetric
                icon="temperature"
                label="Температура"
                value={formatValue(measurement?.[context.zone].temperature, 1)}
                unit="°C"
              />
              <AirContextMetric
                icon="humidity"
                label="Влажность"
                value={formatValue(measurement?.[context.zone].humidity, 0)}
                unit="%"
              />
              <AirContextPm25Metric
                value={measurement?.[context.zone].pm25}
                thresholds={pm25Thresholds}
              />
              {context.zone === 'indoor' ? (
                <AirContextMetric
                  icon="window"
                  label="Окно"
                  value={windowLabel}
                  tone={resolvedWindowOpen === true ? 'success' : 'neutral'}
                  detail={measurement ? 'состояние · ' + formatTime(measurement.timestamp) : 'нет данных'}
                  className="air-context-card-metric-window"
                />
              ) : null}
            </span>
          </span>
        </article>
      ))}
    </div>
  )
}

export function AirComparison({
  measurement,
}: {
  measurement: ClientMeasurement | null
}) {
  const metrics = getAirComparisonMetrics(measurement)
  const insight = getAirComparisonInsight(measurement)

  return (
    <section className="air-comparison" aria-labelledby="air-comparison-title">
      <div className="air-comparison-header">
        <div>
          <span className="eyebrow">Сравнение</span>
          <h3 id="air-comparison-title">Что меняется между улицей и комнатой</h3>
        </div>
        <span className="air-comparison-note">внутри − снаружи</span>
      </div>

      <div className="air-comparison-table" role="table" aria-label="Сравнение показателей воздуха">
        <div className="air-comparison-row air-comparison-row-header" role="row">
          <span role="columnheader">Показатель</span>
          <span role="columnheader">Снаружи</span>
          <span role="columnheader">Внутри</span>
          <span role="columnheader">Разница</span>
          <span role="columnheader">Интерпретация</span>
        </div>
        {metrics.map((metric) => {
          const delta =
            metric.indoor !== null && metric.outdoor !== null
              ? metric.indoor - metric.outdoor
              : null
          const deltaTone =
            metric.key === 'pm25'
              ? delta !== null && delta <= -2
                ? 'success'
                : delta !== null && delta >= 2
                  ? 'warning'
                  : 'neutral'
              : 'neutral'
          const interpretation =
            delta === null
              ? 'нет пары для сравнения'
              : metric.key === 'pm25'
                ? delta <= -2
                  ? 'внутри чище'
                  : delta >= 2
                    ? 'внутри выше'
                    : 'почти одинаково'
                : delta > 0.05
                  ? 'внутри выше'
                  : delta < -0.05
                    ? 'внутри ниже'
                    : 'почти одинаково'

          return (
            <div className="air-comparison-row" role="row" key={metric.key}>
              <span className="air-comparison-metric" role="rowheader">
                <span className="air-comparison-icon"><Icon name={metric.icon} /></span>
                <strong>{metric.label}</strong>
              </span>
              <span role="cell" data-label="Снаружи">
                {formatMetricValue(metric.outdoor, metric.digits, metric.unit)}
              </span>
              <span role="cell" data-label="Внутри">
                {formatMetricValue(metric.indoor, metric.digits, metric.unit)}
              </span>
              <span
                className={'air-comparison-delta air-comparison-delta-' + deltaTone}
                role="cell"
                data-label="Разница"
              >
                {formatSignedMetric(delta, metric.digits, metric.unit === '%' ? 'п.п.' : metric.unit)}
              </span>
              <span className="air-comparison-interpretation" role="cell" data-label="Интерпретация">
                {interpretation}
              </span>
            </div>
          )
        })}
      </div>

      <p className="air-comparison-footnote">
        CO₂ не сравнивается: наружный датчик CO₂ пока не подключён, поэтому показатель доступен только для комнаты.
      </p>

      <div className={'air-comparison-insight air-comparison-insight-' + insight.tone} role="status">
        <span className="air-comparison-insight-icon"><Icon name="air" /></span>
        <span className="air-comparison-insight-copy">
          <span className="eyebrow">Вывод по текущим данным</span>
          <strong>{insight.title}</strong>
          <span>{insight.detail}</span>
        </span>
      </div>
    </section>
  )
}

function SettingsFact({
  icon,
  label,
  value,
  note,
}: {
  icon: 'air' | 'clock' | 'database' | 'model' | 'wifi' | 'window'
  label: string
  value: ReactNode
  note: string
}) {
  return (
    <div className="settings-fact">
      <span className="settings-fact-icon"><Icon name={icon} /></span>
      <div className="settings-fact-copy">
        <dt>{label}</dt>
        <dd>{value}</dd>
        <span>{note}</span>
      </div>
    </div>
  )
}

type SettingsDraft = {
  automationEnabled: boolean
  autoWindowEnabled: boolean
  manualOverrideMinutes: number
  autoVentilationMinimumMinutes: number
  co2NormalThreshold: number
  co2CriticalThreshold: number
  pm25GoodLimit: number
  pm25ElevatedLimit: number
  alertsEnabled: boolean
}

const defaultSettingsDraft: SettingsDraft = {
  automationEnabled: true,
  autoWindowEnabled: true,
  manualOverrideMinutes: 30,
  autoVentilationMinimumMinutes: 5,
  co2NormalThreshold: 800,
  co2CriticalThreshold: 1000,
  pm25GoodLimit: 15,
  pm25ElevatedLimit: 35,
  alertsEnabled: true,
}

function settingsToDraft(settings: ClientNodeSettings | null): SettingsDraft {
  if (!settings) {
    return { ...defaultSettingsDraft }
  }
  return {
    automationEnabled: settings.automation_enabled,
    autoWindowEnabled: settings.auto_window_enabled,
    manualOverrideMinutes: settings.manual_override_minutes,
    autoVentilationMinimumMinutes: settings.auto_ventilation_minimum_minutes,
    co2NormalThreshold: settings.co2_normal_threshold,
    co2CriticalThreshold: settings.co2_critical_threshold,
    pm25GoodLimit: settings.pm25_good_limit,
    pm25ElevatedLimit: settings.pm25_elevated_limit,
    alertsEnabled: settings.alerts_enabled,
  }
}

function settingsDraftToPatch(draft: SettingsDraft): ClientNodeSettingsPatch {
  return {
    automation_enabled: draft.automationEnabled,
    auto_window_enabled: draft.autoWindowEnabled,
    manual_override_minutes: draft.manualOverrideMinutes,
    auto_ventilation_minimum_minutes: draft.autoVentilationMinimumMinutes,
    co2_normal_threshold: draft.co2NormalThreshold,
    co2_critical_threshold: draft.co2CriticalThreshold,
    pm25_good_limit: draft.pm25GoodLimit,
    pm25_elevated_limit: draft.pm25ElevatedLimit,
    alerts_enabled: draft.alertsEnabled,
  }
}

function settingsDraftEquals(left: SettingsDraft, right: SettingsDraft): boolean {
  return (
    left.automationEnabled === right.automationEnabled &&
    left.autoWindowEnabled === right.autoWindowEnabled &&
    left.manualOverrideMinutes === right.manualOverrideMinutes &&
    left.autoVentilationMinimumMinutes === right.autoVentilationMinimumMinutes &&
    left.co2NormalThreshold === right.co2NormalThreshold &&
    left.co2CriticalThreshold === right.co2CriticalThreshold &&
    left.pm25GoodLimit === right.pm25GoodLimit &&
    left.pm25ElevatedLimit === right.pm25ElevatedLimit &&
    left.alertsEnabled === right.alertsEnabled
  )
}

function SettingsSwitch({
  id,
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={'settings-option' + (disabled ? ' is-disabled' : '')} htmlFor={id}>
      <input
        className="settings-checkbox"
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        disabled={disabled}
      />
      <span className="settings-checkbox-visual" aria-hidden="true" />
      <span className="settings-option-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
    </label>
  )
}

function SettingsNumberField({
  id,
  label,
  description,
  value,
  unit,
  min,
  max,
  step,
  error,
  onChange,
  disabled = false,
}: {
  id: string
  label: string
  description: string
  value: number
  unit: string
  min: number
  max: number
  step: number
  error?: string
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const descriptionId = id + '-description'
  const errorId = id + '-error'
  return (
    <label className="settings-number-field" htmlFor={id}>
      <span className="settings-field-label">{label}</span>
      <span className="settings-field-description" id={descriptionId}>{description}</span>
      <span className="settings-number-input-wrap">
        <input
          className="settings-number-input"
          id={id}
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.currentTarget.value === '' ? Number.NaN : event.currentTarget.valueAsNumber)}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? descriptionId + ' ' + errorId : descriptionId}
        />
        <span className="settings-number-unit">{unit}</span>
      </span>
      {error ? <span className="settings-field-error" id={errorId}>{error}</span> : null}
    </label>
  )
}

function SettingsChoiceGroup({
  value,
  onChange,
  disabled = false,
}: {
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const choices = [15, 30, 60]
  return (
    <div className="settings-choice-group" role="group" aria-label="Длительность ручного режима">
      {choices.map((choice) => (
        <button
          className={'settings-choice' + (value === choice ? ' is-active' : '')}
          key={choice}
          type="button"
          aria-pressed={value === choice}
          onClick={() => onChange(choice)}
          disabled={disabled}
        >
          {choice} мин
        </button>
      ))}
    </div>
  )
}

export function SettingsPanel({
  presentation = 'drawer',
  controls,
  deviceId,
  measurement,
  prediction,
  systemStatus,
  systemTone,
  tab,
  onTabChange,
  onClose,
  closeButtonRef,
  settings,
  settingsError,
  settingsSaving,
  settingsNotice,
  onSave,
}: {
  presentation?: 'drawer' | 'page'
  controls: ClientControlStatus | null
  deviceId: string
  measurement: ClientMeasurement | null
  prediction: ClientPrediction | null
  systemStatus: string
  systemTone: string
  tab: SettingsTab
  onTabChange: (nextTab: SettingsTab) => void
  onClose: () => void
  closeButtonRef: React.RefObject<HTMLButtonElement | null>
  settings: ClientNodeSettings | null
  settingsError: string | null
  settingsSaving: boolean
  settingsNotice: string | null
  onSave: (patch: ClientNodeSettingsPatch) => Promise<void>
}) {
  const isPage = presentation === 'page'
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsToDraft(settings))
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDraft(settingsToDraft(settings))
    setDirty(false)
  }, [settings?.updated_at])

  const setDraftValue = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    if (!Number.isInteger(draft.manualOverrideMinutes) || draft.manualOverrideMinutes < 1 || draft.manualOverrideMinutes > 240) {
      errors.manualOverrideMinutes = 'От 1 до 240 минут.'
    }
    if (!Number.isInteger(draft.autoVentilationMinimumMinutes) || draft.autoVentilationMinimumMinutes < 1 || draft.autoVentilationMinimumMinutes > 120) {
      errors.autoVentilationMinimumMinutes = 'От 1 до 120 минут.'
    }
    if (!Number.isFinite(draft.co2NormalThreshold) || draft.co2NormalThreshold < 250 || draft.co2NormalThreshold > 10000) {
      errors.co2NormalThreshold = 'От 250 до 10 000 ppm.'
    }
    if (!Number.isFinite(draft.co2CriticalThreshold) || draft.co2CriticalThreshold < 250 || draft.co2CriticalThreshold > 10000) {
      errors.co2CriticalThreshold = 'От 250 до 10 000 ppm.'
    }
    if (Number.isFinite(draft.co2NormalThreshold) && Number.isFinite(draft.co2CriticalThreshold) && draft.co2CriticalThreshold <= draft.co2NormalThreshold) {
      errors.co2CriticalThreshold = 'Должен быть выше комфортного порога CO₂.'
    }
    if (!Number.isFinite(draft.pm25GoodLimit) || draft.pm25GoodLimit < 0 || draft.pm25GoodLimit > 1000) {
      errors.pm25GoodLimit = 'От 0 до 1 000 µg/m³.'
    }
    if (!Number.isFinite(draft.pm25ElevatedLimit) || draft.pm25ElevatedLimit < 0 || draft.pm25ElevatedLimit > 1000) {
      errors.pm25ElevatedLimit = 'От 0 до 1 000 µg/m³.'
    }
    if (Number.isFinite(draft.pm25GoodLimit) && Number.isFinite(draft.pm25ElevatedLimit) && draft.pm25ElevatedLimit <= draft.pm25GoodLimit) {
      errors.pm25ElevatedLimit = 'Должен быть выше нормального порога PM2.5.'
    }
    return errors
  }, [draft])

  const handleReset = () => {
    setDraft(settingsToDraft(settings))
    setDirty(false)
  }

  const handleRestoreRecommended = () => {
    const recommended = { ...defaultSettingsDraft }
    setDraft(recommended)
    setDirty(!settingsDraftEquals(recommended, settingsToDraft(settings)))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (Object.keys(validationErrors).length > 0 || settingsSaving) {
      return
    }
    await onSave(settingsDraftToPatch(draft))
  }

  const automationLabel = controls
    ? controls.automation.enabled ? 'Включена' : 'Выключена'
    : 'нет данных'
  const automationStatusTone = settings
    ? draft.automationEnabled ? 'success' : 'warning'
    : 'neutral'
  const windowModeLabel = controls
    ? controls.window.mode === 'manual' ? 'Ручной режим' : 'Автоматический режим'
    : 'нет данных'
  const overrideLabel = controls?.window.override_until
    ? 'До ' + formatTimestamp(controls.window.override_until)
    : 'Нет активного ограничения'

  return (
    <div
      className={isPage ? 'settings-page-shell' : 'settings-backdrop'}
      onMouseDown={isPage ? undefined : (event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        className={'settings-drawer' + (isPage ? ' settings-page-content' : '')}
        id="settings-dialog"
        role={isPage ? 'region' : 'dialog'}
        aria-modal={isPage ? undefined : true}
        aria-labelledby="settings-title"
      >
        <div className="settings-drawer-header">
          <div>
            <span className="eyebrow">Настройки узла</span>
            <h2 id="settings-title">Настройки</h2>
            <p>Постоянные правила поведения локального узла {deviceId}.</p>
          </div>
          <button
            className="settings-close"
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Закрыть настройки"
            title="Закрыть настройки"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="settings-tabs" role="tablist" aria-label="Разделы настроек">
          <button
            className={'settings-tab ' + (tab === 'automation' ? 'is-active' : '')}
            id="settings-tab-automation"
            type="button"
            role="tab"
            aria-selected={tab === 'automation'}
            aria-controls="settings-panel-automation"
            onClick={() => onTabChange('automation')}
          >
            Автоматика
          </button>
          <button
            className={'settings-tab ' + (tab === 'thresholds' ? 'is-active' : '')}
            id="settings-tab-thresholds"
            type="button"
            role="tab"
            aria-selected={tab === 'thresholds'}
            aria-controls="settings-panel-thresholds"
            onClick={() => onTabChange('thresholds')}
          >
            Пороги и сигналы
          </button>
          <button
            className={'settings-tab ' + (tab === 'technical' ? 'is-active' : '')}
            id="settings-tab-technical"
            type="button"
            role="tab"
            aria-selected={tab === 'technical'}
            aria-controls="settings-panel-technical"
            onClick={() => onTabChange('technical')}
          >
            Технические сведения
          </button>
        </div>

        {tab === 'technical' && settingsError ? (
          <div className="settings-feedback settings-feedback-error" role="alert">{settingsError}</div>
        ) : null}

        {tab === 'technical' ? (
          <div
            className="settings-panel"
            id="settings-panel-technical"
            role="tabpanel"
            aria-labelledby="settings-tab-technical"
            tabIndex={0}
          >
            <div className="settings-panel-heading">
              <div>
                <h3>Технические сведения</h3>
                <p>Диагностическая информация без управляющих действий.</p>
              </div>
              <span className={'settings-status settings-status-' + systemTone}>
                <span className={'status-dot status-dot-' + systemTone} />
                {systemStatus}
              </span>
            </div>
            <dl className="settings-facts">
              <SettingsFact
                icon="wifi"
                label="Источник данных"
                value={<span translate="no">simulator / ESP32</span>}
                note="Simulator и будущая ESP32 используют один API-контракт."
              />
              <SettingsFact
                icon="database"
                label="Хранилище"
                value={<span translate="no">PostgreSQL</span>}
                note="Измерения и команды сохраняются локально."
              />
              <SettingsFact
                icon="model"
                label="Прогноз CO₂"
                value={<span translate="no">{prediction ? prediction.model_name + ' / v' + prediction.model_version : 'недоступна'}</span>}
                note={prediction ? 'Модель отвечает на последнюю точку.' : 'Модель ещё не вернула результат.'}
              />
              <SettingsFact
                icon="air"
                label="Контракт показаний"
                value={<span translate="no">POST /api/v1/measurements</span>}
                note="Тот же формат предназначен для локального узла и simulator."
              />
              <SettingsFact
                icon="clock"
                label="Последняя точка"
                value={formatTimestamp(measurement?.timestamp)}
                note="Время измерения от локального узла."
              />
              <SettingsFact
                icon="clock"
                label="Срок хранения"
                value={(settings?.retention_hours ?? 24) + ' часа'}
                note="Старые измерения, прогнозы и рекомендации удаляются автоматически."
              />
            </dl>
          </div>
        ) : (
          <div
            className="settings-panel"
            id={'settings-panel-' + tab}
            role="tabpanel"
            aria-labelledby={'settings-tab-' + tab}
            tabIndex={0}
          >
            <div className="settings-panel-heading">
              <div>
                <h3>{tab === 'automation' ? 'Автоматика' : 'Пороги и сигналы'}</h3>
                <p>{tab === 'automation'
                  ? 'Постоянные правила, по которым узел принимает решения о проветривании.'
                  : 'Границы, которые используются в рекомендациях, шкалах и предупреждениях.'}</p>
              </div>
              <span className={'settings-status settings-status-' + automationStatusTone}>
                <span className={'status-dot status-dot-' + automationStatusTone} />
                {settings ? (draft.automationEnabled ? 'Включена' : 'Выключена') : 'Загрузка'}
              </span>
            </div>

            {settingsError ? <div className="settings-feedback settings-feedback-error" role="alert">{settingsError}</div> : null}
            {settingsNotice && !dirty ? <div className="settings-feedback" role="status" aria-live="polite">{settingsNotice}</div> : null}

            <form className="settings-form" onSubmit={(event) => void handleSubmit(event)}>
              {tab === 'automation' ? (
                <>
                  <div className="settings-form-section">
                    <span className="eyebrow">Поведение узла</span>
                    <SettingsSwitch
                      id="settings-automation-enabled"
                      label="Автоматическое управление"
                      description="Система сама реагирует на текущий и прогнозируемый CO₂."
                      checked={draft.automationEnabled}
                      onChange={(checked) => setDraftValue('automationEnabled', checked)}
                      disabled={!settings || settingsSaving}
                    />
                    <SettingsSwitch
                      id="settings-auto-window-enabled"
                      label="Автоматически открывать окно"
                      description="При критическом CO₂; вытяжка и приток при этом получают общую команду."
                      checked={draft.autoWindowEnabled}
                      onChange={(checked) => setDraftValue('autoWindowEnabled', checked)}
                      disabled={!settings || settingsSaving}
                    />
                  </div>

                  <div className="settings-form-section">
                    <span className="eyebrow">Временные правила</span>
                    <div className="settings-form-row">
                      <div>
                        <strong className="settings-form-label">Ручной режим окна</strong>
                        <span className="settings-field-description">После ручной команды автоматика вернётся сама.</span>
                      </div>
                      <SettingsChoiceGroup
                        value={draft.manualOverrideMinutes}
                        onChange={(value) => setDraftValue('manualOverrideMinutes', value)}
                        disabled={!settings || settingsSaving}
                      />
                    </div>
                    <SettingsNumberField
                      id="settings-auto-ventilation-minimum"
                      label="Минимальное проветривание"
                      description="Не выключать автоматический контур раньше этого времени."
                      value={draft.autoVentilationMinimumMinutes}
                      unit="мин"
                      min={1}
                      max={120}
                      step={1}
                      error={validationErrors.autoVentilationMinimumMinutes}
                      onChange={(value) => setDraftValue('autoVentilationMinimumMinutes', value)}
                      disabled={!settings || settingsSaving}
                    />
                  </div>

                  <div className="settings-rule-preview">
                    <span className="eyebrow">Логика решения</span>
                    <strong>CO₂ ≥ {formatValue(draft.co2CriticalThreshold)} ppm</strong>
                    <span className="settings-rule-arrow">→</span>
                    <span>{draft.autoWindowEnabled ? 'открыть окно' : 'не открывать окно автоматически'}</span>
                    <span className="settings-rule-arrow">→</span>
                    <span>включить вытяжку и приток</span>
                    <small>После снижения ниже {formatValue(draft.co2NormalThreshold)} ppm контур остановится не раньше чем через {formatValue(draft.autoVentilationMinimumMinutes)} мин.</small>
                  </div>
                </>
              ) : (
                <>
                  <div className="settings-form-section">
                    <span className="eyebrow">CO₂</span>
                    <div className="settings-field-grid">
                      <SettingsNumberField
                        id="settings-co2-normal"
                        label="Комфортный уровень"
                        description="Ниже этого значения воздух считается комфортным."
                        value={draft.co2NormalThreshold}
                        unit="ppm"
                        min={250}
                        max={10000}
                        step={1}
                        error={validationErrors.co2NormalThreshold}
                        onChange={(value) => setDraftValue('co2NormalThreshold', value)}
                        disabled={!settings || settingsSaving}
                      />
                      <SettingsNumberField
                        id="settings-co2-critical"
                        label="Критический уровень"
                        description="На этом уровне автоматика запускает проветривание."
                        value={draft.co2CriticalThreshold}
                        unit="ppm"
                        min={250}
                        max={10000}
                        step={1}
                        error={validationErrors.co2CriticalThreshold}
                        onChange={(value) => setDraftValue('co2CriticalThreshold', value)}
                        disabled={!settings || settingsSaving}
                      />
                    </div>
                  </div>
                  <div className="settings-form-section">
                    <span className="eyebrow">PM2.5</span>
                    <div className="settings-field-grid">
                      <SettingsNumberField
                        id="settings-pm25-good"
                        label="Нормальный уровень"
                        description="До этого значения шкала показывает зелёную зону."
                        value={draft.pm25GoodLimit}
                        unit="µg/m³"
                        min={0}
                        max={1000}
                        step={0.1}
                        error={validationErrors.pm25GoodLimit}
                        onChange={(value) => setDraftValue('pm25GoodLimit', value)}
                        disabled={!settings || settingsSaving}
                      />
                      <SettingsNumberField
                        id="settings-pm25-elevated"
                        label="Повышенный уровень"
                        description="После этого значения начинается красная зона."
                        value={draft.pm25ElevatedLimit}
                        unit="µg/m³"
                        min={0}
                        max={1000}
                        step={0.1}
                        error={validationErrors.pm25ElevatedLimit}
                        onChange={(value) => setDraftValue('pm25ElevatedLimit', value)}
                        disabled={!settings || settingsSaving}
                      />
                    </div>
                  </div>
                  <div className="settings-form-section">
                    <span className="eyebrow">Сигналы</span>
                    <SettingsSwitch
                      id="settings-alerts-enabled"
                      label="Показывать предупреждения"
                      description="Отмечать превышение порогов в панели и в рекомендациях."
                      checked={draft.alertsEnabled}
                      onChange={(checked) => setDraftValue('alertsEnabled', checked)}
                      disabled={!settings || settingsSaving}
                    />
                    <button
                      className="button-secondary settings-recommended-button"
                      type="button"
                      onClick={handleRestoreRecommended}
                      disabled={!settings || settingsSaving}
                    >
                      Восстановить рекомендуемые значения
                    </button>
                  </div>
                </>
              )}

              <div className="settings-form-footer">
                <span className="settings-form-state" aria-live="polite">
                  {settingsSaving ? 'Сохраняем…' : dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}
                </span>
                <div className="settings-form-actions">
                  <button className="button-secondary" type="button" onClick={handleReset} disabled={!dirty || settingsSaving}>
                    Отменить
                  </button>
                  <button className="button-primary" type="submit" disabled={!settings || !dirty || settingsSaving || Object.keys(validationErrors).length > 0}>
                    {settingsSaving ? 'Сохранение…' : 'Сохранить'}
                  </button>
                </div>
              </div>
            </form>

            {tab === 'automation' ? (
              <div className="settings-current-state">
                <span className="eyebrow">Сейчас на узле</span>
                <span>{windowModeLabel} · {overrideLabel}</span>
                <span>{controls ? 'неподтверждённых команд: ' + controls.pending_commands : 'состояние узла пока не получено'}</span>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}

export default function AirDashboard() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [history, setHistory] = useState<ClientMeasurement[]>([])
  const [range, setRange] = useState<RangeKey>('24h')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<DashboardSectionId>('overview')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('automation')
  const [nodeSettings, setNodeSettings] = useState<ClientNodeSettings | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null)
  const [controls, setControls] = useState<ClientControlStatus | null>(null)
  const [controlError, setControlError] = useState<string | null>(null)
  const [activeCommand, setActiveCommand] = useState<string | null>(null)
  const [controlNotice, setControlNotice] = useState<string | null>(null)
  const settingsCloseButtonRef = useRef<HTMLButtonElement>(null)
  const settingsTriggerRef = useRef<HTMLElement | null>(null)
  const settingsOpenRef = useRef(false)
  const lastDashboardHashRef = useRef('#overview')
  const loadSequenceRef = useRef(0)
  const activeLoadControllerRef = useRef<AbortController | null>(null)

  const openSettings = useCallback((trigger?: HTMLElement) => {
    if (trigger) {
      settingsTriggerRef.current = trigger
    }
    const currentHash = window.location.hash
    if (currentHash && currentHash !== '#settings') {
      lastDashboardHashRef.current = '#' + getSectionIdFromHash(currentHash)
    }
    settingsOpenRef.current = true
    setSettingsOpen(true)
    if (currentHash !== '#settings') {
      window.history.pushState(null, '', '#settings')
    }
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }))
  }, [])

  const closeSettings = useCallback(() => {
    settingsOpenRef.current = false
    setSettingsOpen(false)
    const nextHash = lastDashboardHashRef.current || '#overview'
    if (window.location.hash === '#settings') {
      window.history.replaceState(null, '', nextHash)
    }
    const nextSectionId = getSectionIdFromHash(nextHash)
    setActiveSection(nextSectionId)
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' })
      const trigger = settingsTriggerRef.current
      if (trigger && document.contains(trigger)) {
        trigger.focus()
      }
    })
  }, [])

  const loadData = useCallback(async () => {
    activeLoadControllerRef.current?.abort()
    const controller = new AbortController()
    activeLoadControllerRef.current = controller
    const { signal } = controller
    const loadSequence = ++loadSequenceRef.current
    const isLatestLoad = () => loadSequence === loadSequenceRef.current
    const to = new Date()
    const from = new Date(to.getTime() - rangeMinutes[range] * 60 * 1000)
    setLoading(true)
    try {
      const [latestResult, historyResult, settingsResult] = await Promise.allSettled([
        getLatestDashboard(signal),
        getHistory(from, to, 5000, signal),
        getNodeSettings(undefined, signal),
      ])
      if (!isLatestLoad()) {
        return
      }
      if (latestResult.status === 'rejected') {
        throw latestResult.reason
      }
      if (historyResult.status === 'rejected') {
        throw historyResult.reason
      }
      setDashboard(latestResult.value)
      setHistory(historyResult.value.data)
      if (settingsResult.status === 'fulfilled') {
        setNodeSettings(settingsResult.value)
        setSettingsError(null)
      } else if (!(settingsResult.reason instanceof Error && settingsResult.reason.name === 'AbortError')) {
        setSettingsError(
          settingsResult.reason instanceof ClientApiError
            ? settingsResult.reason.message
            : 'Не удалось загрузить настройки узла',
        )
      }
      try {
        const controlStatus = await getControlStatus(undefined, signal)
        if (!isLatestLoad()) {
          return
        }
        setControls(controlStatus)
        setControlError(null)
      } catch (controlLoadError) {
        if (!isLatestLoad()) {
          return
        }
        if (controlLoadError instanceof Error && controlLoadError.name === 'AbortError') {
          return
        }
        setControlError(
          controlLoadError instanceof ClientApiError
            ? controlLoadError.message
            : 'Не удалось загрузить состояние управления',
        )
      }
      setError(null)
      setLastUpdated(new Date().toISOString())
    } catch (loadError) {
      if (!isLatestLoad()) {
        return
      }
      if (loadError instanceof Error && loadError.name === 'AbortError') {
        return
      }
      setError(
        loadError instanceof ClientApiError
          ? loadError.message
          : 'Не удалось загрузить данные мониторинга',
      )
    } finally {
      if (isLatestLoad()) {
        setLoading(false)
      }
      if (activeLoadControllerRef.current === controller) {
        activeLoadControllerRef.current = null
      }
    }
  }, [range])

  const saveNodeSettings = useCallback(async (patch: ClientNodeSettingsPatch) => {
    setSettingsSaving(true)
    setSettingsError(null)
    setSettingsNotice(null)
    try {
      const saved = await updateNodeSettings(patch, nodeSettings?.device_id ?? controls?.device_id)
      setNodeSettings(saved)
      setSettingsNotice('Настройки сохранены и применены к локальному узлу.')
      void loadData()
    } catch (saveError) {
      setSettingsError(
        saveError instanceof ClientApiError
          ? saveError.message
          : 'Не удалось сохранить настройки узла',
      )
    } finally {
      setSettingsSaving(false)
    }
  }, [controls?.device_id, loadData, nodeSettings?.device_id])

  const executeControl = useCallback(
    async (target: ClientControlTarget, action: ClientControlAction) => {
      const commandKey = target + ':' + action
      setActiveCommand(commandKey)
      setControlError(null)
      setControlNotice(null)
      try {
        const result = await sendControlCommand(target, action, controls?.device_id)
        setControls(result.controls)
        setControlNotice(
          action === 'auto'
            ? 'Окно снова передано автоматике.'
            : result.commands.length > 0
              ? 'Команда на ' + controlActionLabel(target, action) + ' отправлена локальному узлу.'
              : 'Состояние уже соответствует выбранной команде.',
        )
      } catch (commandError) {
        setControlError(
          commandError instanceof ClientApiError
            ? commandError.message
            : 'Не удалось отправить команду управления',
        )
      } finally {
        setActiveCommand(null)
      }
    },
    [controls?.device_id],
  )

  const executeVentilation = useCallback(
    async (action: ClientVentilationAction) => {
      const commandKey = 'ventilation:' + action
      setActiveCommand(commandKey)
      setControlError(null)
      setControlNotice(null)
      try {
        const result = await sendVentilationCommand(action, controls?.device_id)
        setControls(result.controls)
        setControlNotice(
          result.commands.length > 0
            ? action === 'on'
              ? 'Команда на запуск вытяжки и притока отправлена локальному узлу.'
              : 'Команда на остановку вытяжки и притока отправлена локальному узлу.'
            : 'Состояние контура уже соответствует выбранной команде.',
        )
      } catch (commandError) {
        setControlError(
          commandError instanceof ClientApiError
            ? commandError.message
            : 'Не удалось отправить команду управления вентиляцией',
        )
      } finally {
        setActiveCommand(null)
      }
    },
    [controls?.device_id],
  )

  useEffect(() => {
    void loadData()
    const timer = window.setInterval(() => {
      void loadData()
    }, 30_000)
    return () => {
      activeLoadControllerRef.current?.abort()
      activeLoadControllerRef.current = null
      loadSequenceRef.current += 1
      window.clearInterval(timer)
    }
  }, [loadData])

  useEffect(() => {
    const applyHashView = () => {
      const nextViewId = getViewIdFromHash(window.location.hash)
      if (nextViewId === 'settings') {
        settingsOpenRef.current = true
        setSettingsOpen(true)
        window.scrollTo({ top: 0, behavior: 'auto' })
        return
      }

      settingsOpenRef.current = false
      setSettingsOpen(false)
      lastDashboardHashRef.current = '#' + nextViewId
      setActiveSection(nextViewId)
      if (window.location.hash !== '#' + nextViewId) {
        window.history.replaceState(null, '', '#' + nextViewId)
      }
      window.scrollTo({ top: 0, behavior: 'auto' })
    }

    applyHashView()
    window.addEventListener('hashchange', applyHashView)
    window.addEventListener('popstate', applyHashView)

    return () => {
      window.removeEventListener('hashchange', applyHashView)
      window.removeEventListener('popstate', applyHashView)
    }
  }, [])

  const handleSectionNavigation = useCallback((
    sectionId: DashboardViewId,
    event: MouseEvent<HTMLAnchorElement>,
  ) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }

    event.preventDefault()
    if (sectionId === 'settings') {
      openSettings(event.currentTarget)
      return
    }

    settingsOpenRef.current = false
    setSettingsOpen(false)
    lastDashboardHashRef.current = '#' + sectionId
    setActiveSection(sectionId)

    const nextHash = '#' + sectionId
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash)
    }
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }, [openSettings])

  useEffect(() => {
    settingsOpenRef.current = settingsOpen
    if (!settingsOpen) {
      return
    }

    const focusFrame = window.requestAnimationFrame(() => settingsCloseButtonRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSettings()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeSettings, settingsOpen])

  const measurement = dashboard?.measurement ?? null
  const prediction: ClientPrediction | null = dashboard?.prediction ?? null
  const recommendation: ClientRecommendation | null = dashboard?.recommendation ?? null
  const currentCo2 = measurement?.indoor.co2 ?? null
  const activeCo2Thresholds = useMemo(
    () => ({
      normal: nodeSettings?.co2_normal_threshold ?? 800,
      critical: nodeSettings?.co2_critical_threshold ?? 1000,
    }),
    [nodeSettings],
  )
  const activePm25Thresholds = useMemo(
    () => ({
      good: nodeSettings?.pm25_good_limit ?? PM25_GOOD_LIMIT,
      elevated: nodeSettings?.pm25_elevated_limit ?? PM25_ELEVATED_LIMIT,
    }),
    [nodeSettings],
  )
  const activeCo2ChartThresholds = useMemo(
    () => getCo2Thresholds(activeCo2Thresholds.normal, activeCo2Thresholds.critical),
    [activeCo2Thresholds],
  )
  const co2ScaleMin = Math.min(400, activeCo2Thresholds.normal)
  const co2ScaleMax = Math.max(2000, Math.ceil(activeCo2Thresholds.critical * 1.5 / 100) * 100)
  const co2ScaleRange = Math.max(1, co2ScaleMax - co2ScaleMin)
  const co2NormalPosition = Math.min(100, Math.max(0, ((activeCo2Thresholds.normal - co2ScaleMin) / co2ScaleRange) * 100))
  const co2CriticalPosition = Math.min(100, Math.max(co2NormalPosition, ((activeCo2Thresholds.critical - co2ScaleMin) / co2ScaleRange) * 100))
  const change5 = useMemo(() => getCo2Change(history, 5), [history])
  const change10 = useMemo(() => getCo2Change(history, 10), [history])
  const markerPosition = useMemo(() => {
    if (currentCo2 === null) {
      return 8
    }
    return Math.min(97, Math.max(3, ((currentCo2 - co2ScaleMin) / co2ScaleRange) * 100))
  }, [co2ScaleMin, co2ScaleRange, currentCo2])

  const co2Series = history.map((item) => ({
    timestamp: item.timestamp,
    value: item.indoor.co2,
  }))
  const temperatureSeries = history.map((item) => ({
    timestamp: item.timestamp,
    value: item.indoor.temperature,
  }))
  const windowHistory = useMemo(() => getWindowHistorySummary(history), [history])
  const lastHistoryPoint = history.at(-1)
  const isEmpty = !loading && !error && !measurement && history.length === 0
  const sourceLabel = lastUpdated
    ? 'обновлено в ' + formatTime(lastUpdated)
    : 'ожидание синхронизации'
  const systemStatus = error ? 'нужна проверка' : measurement ? 'в сети' : 'ожидание'
  const systemTone = error ? 'error' : measurement ? 'success' : 'neutral'
  const currentWindowOpen = controls
    ? controls.reported.window_open
    : measurement?.window_open ?? null
  const windowLabel = currentWindowOpen === null ? '—' : currentWindowOpen ? 'Открыто' : 'Закрыто'
  const windowMode = controls?.window.mode ?? 'auto'
  const windowDesiredOpen = controls?.desired.window_open ?? currentWindowOpen === true
  const controlsTone = controlTone(controls)
  const controlsPending = controls?.pending_commands ?? 0
  const ventilationActive =
    controls?.reported.exhaust_on === true && controls?.reported.intake_on === true
  const ventilationPending =
    controls === null ||
    controls.reported.exhaust_on !== controls.desired.exhaust_on ||
    controls.reported.intake_on !== controls.desired.intake_on ||
    activeCommand === 'ventilation:on' ||
    activeCommand === 'ventilation:off'
  const ventilationAction: ClientVentilationAction = ventilationActive ? 'off' : 'on'
  const ventilationButtonLabel =
    controls === null
      ? 'Ожидание данных'
      : ventilationPending
        ? 'Ожидание устройства'
        : ventilationActive
          ? 'Остановить проветривание'
          : 'Запустить проветривание'
  const ventilationStateLabel =
    controls === null
      ? 'Состояние неизвестно'
      : ventilationPending
        ? 'Ожидается подтверждение'
        : ventilationActive
          ? 'Контур работает'
          : 'Контур остановлен'
  const deviceId = controls?.device_id ?? 'локальный узел'
  const deviceConnectionStatus = controls?.connection.status ?? (measurement ? 'online' : 'offline')
  const deviceConnectionLabel = getConnectionStatusLabel(deviceConnectionStatus)
  const deviceConnectionTone = controls ? controlsTone : measurement ? 'success' : 'neutral'
  const activeNavigationItem: DashboardViewId = settingsOpen ? 'settings' : activeSection
  const activeViewTitle = primaryNavItems.find((item) => item.id === activeNavigationItem)?.label ?? 'Панель'

  return (
    <div className="app-shell dashboard-shell">
      <a className="skip-link" href="#main-content">К содержимому</a>
      <header className="app-topbar">
        <div className="container app-topbar-inner">
          <a
            className="brand dashboard-brand"
            href="#overview"
            onClick={(event) => handleSectionNavigation('overview', event)}
          >
            <picture className="brand-logo-frame">
              <source srcSet="/aircheck-logo.webp" type="image/webp" />
              <img
                className="brand-logo"
                src="/aircheck-logo.png"
                alt=""
                width="44"
                height="32"
                aria-hidden="true"
              />
            </picture>
            <span className="brand-name">AirCheck</span>
          </a>

          <div className="room-context" aria-label="Активная комната">
            <span className="room-context-label">Комната</span>
            <strong translate="no">{deviceId}</strong>
            <span className="room-context-status">
              <span className={'status-dot status-dot-' + deviceConnectionTone} />
              {deviceConnectionLabel}
            </span>
          </div>

          <DashboardNavigation
            className="app-nav"
            label="Навигация панели управления"
            linkClassName="app-nav-link"
            activeSection={activeNavigationItem}
            onNavigate={handleSectionNavigation}
          />
        </div>
      </header>

      <main id="main-content" aria-labelledby="dashboard-view-title">
        <h1 className="dashboard-page-title" id="dashboard-view-title">{activeViewTitle}</h1>
        {settingsOpen ? (
          <SettingsPanel
            presentation="page"
            controls={controls}
            deviceId={deviceId}
            measurement={measurement}
            prediction={prediction}
            systemStatus={systemStatus}
            systemTone={systemTone}
            tab={settingsTab}
            onTabChange={setSettingsTab}
            onClose={closeSettings}
            closeButtonRef={settingsCloseButtonRef}
            settings={nodeSettings}
            settingsError={settingsError}
            settingsSaving={settingsSaving}
            settingsNotice={settingsNotice}
            onSave={saveNodeSettings}
          />
        ) : (
          <>
        {loading && !dashboard ? (
          <div className="container">
            <div className="panel-state panel-state-loading" role="status" aria-live="polite">
              <span><strong>Синхронизация с {deviceId}</strong><br />Получаем свежие показания и состояние модели.</span>
              <span className="loading-bar" />
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="container">
            <div className="panel-state panel-state-error" role="alert" aria-live="assertive">
              <span><strong>Не удалось обновить панель</strong><br />{error}</span>
              <button className="button-secondary" type="button" onClick={() => void loadData()}>Повторить</button>
            </div>
          </div>
        ) : null}
        {isEmpty ? (
          <div className="container">
            <div className="panel-state panel-state-empty">
              <span><strong>Данных пока нет</strong><br />Запустите simulator или отправьте первое измерение через POST /api/v1/measurements.</span>
            </div>
          </div>
        ) : null}

        {activeSection === 'overview' ? (
        <section className="container dashboard-section dashboard-lead-section dashboard-view dashboard-view-overview" id="overview" key="overview">
          <article className="dashboard-card current-air-card">
            <div className="current-air-header">
              <div>
                <span className="eyebrow">Сейчас</span>
                <h2>Воздух в комнате</h2>
              </div>
              <div className="current-air-tools">
                <div className="current-air-status-row">
                  <span className={'current-air-state current-air-state-' + co2BadgeClass(currentCo2, activeCo2Thresholds).replace('badge-', '')}>
                    <span className={'status-dot status-dot-' + (currentCo2 === null ? 'neutral' : currentCo2 >= activeCo2Thresholds.critical ? 'error' : currentCo2 >= activeCo2Thresholds.normal ? 'warning' : 'success')} />
                    {co2Label(currentCo2, activeCo2Thresholds)}
                  </span>
                  <span className="current-air-updated" role="status" aria-live="polite">
                    <span className={'status-dot status-dot-' + systemTone} />
                    {error ? 'обновление не удалось' : sourceLabel}
                  </span>
                </div>
                <button
                  className="current-air-refresh button-secondary"
                  type="button"
                  onClick={() => void loadData()}
                  disabled={loading}
                  aria-busy={loading}
                  aria-label={loading ? 'Обновление показаний' : 'Обновить показания'}
                >
                  <Icon name="refresh" />
                  <span>{loading ? 'Обновление…' : 'Обновить'}</span>
                </button>
              </div>
            </div>

            <div className="current-air-body">
              <div className="current-reading">
                <span className="reading-label">CO₂</span>
                <strong className="current-reading-value">{formatValue(currentCo2)}<small>ppm</small></strong>
                <div className="reading-meta">
                  <span>{formatDelta(change5, 5)}</span>
                  <span>измерено {formatTime(measurement?.timestamp)}</span>
                </div>
              </div>

              <div className="forecast-reading">
                <div className="forecast-reading-head">
                  <span>Прогноз через 15 мин</span>
                  <span className={'forecast-status forecast-status-' + (prediction ? 'ready' : 'waiting')}>
                    {prediction ? 'готов' : 'нет данных'}
                  </span>
                </div>
                <div className="forecast-reading-values">
                  <span><small>сейчас</small><strong>{formatValue(currentCo2)} <em>ppm</em></strong></span>
                  <Icon name="arrow" />
                  <span><small>ожидается</small><strong>{formatValue(prediction?.predicted_co2_15min)} <em>ppm</em></strong></span>
                </div>
              </div>
            </div>

            <div className="co2-meter" aria-label={'Шкала уровня CO₂ от ' + formatValue(co2ScaleMin) + ' до ' + formatValue(co2ScaleMax) + ' ppm'}>
              <div className="co2-meter-segments">
                <span className="meter-normal" style={{ width: co2NormalPosition + '%' }} />
                <span className="meter-attention" style={{ width: co2CriticalPosition - co2NormalPosition + '%' }} />
                <span className="meter-risk" style={{ width: 100 - co2CriticalPosition + '%' }} />
              </div>
              <span className="co2-meter-marker" style={{ left: markerPosition + '%' }} />
              <div className="co2-meter-labels">
                <span style={{ left: '0%' }}>{formatValue(co2ScaleMin)}</span>
                <span style={{ left: co2NormalPosition + '%' }}>{formatValue(activeCo2Thresholds.normal)}</span>
                <span style={{ left: co2CriticalPosition + '%' }}>{formatValue(activeCo2Thresholds.critical)}</span>
                <span style={{ left: '100%' }}>{formatValue(co2ScaleMax)}+ ppm</span>
              </div>
            </div>

            <div className={'action-strip action-strip-' + recommendationTone(recommendation)}>
              <span className="action-strip-icon"><Icon name={recommendation?.type === 'normal' ? 'air' : 'window'} /></span>
              <div className="action-strip-copy">
                <span className="action-strip-label">Следующее действие</span>
                <strong>{recommendation?.message ?? 'Рекомендация появится после первого измерения'}</strong>
                <span>{recommendation?.reason ?? 'Правила учитывают текущий CO₂, прогноз и состояние окна.'}</span>
              </div>
              <span className="action-strip-duration">
                {recommendation ? recommendationLabels[recommendation.type] : 'ожидание'}
                {recommendation?.duration_minutes ? ' · ' + recommendation.duration_minutes + ' мин' : ''}
              </span>
            </div>
          </article>

        </section>
        ) : null}

        {activeSection === 'controls' ? (
        <section className="container dashboard-section controls-section dashboard-view dashboard-view-controls" id="controls" key="controls">
          <div className="section-toolbar controls-toolbar">
            <div>
              <span className="eyebrow">Команды</span>
              <h2>Управление проветриванием</h2>
              <p>Вытяжка и приток запускаются одной командой. Окно работает по автоматическому или ручному сценарию.</p>
            </div>
            <span className={'section-context control-context control-context-' + controlsTone}>
              <span className={'status-dot status-dot-' + controlsTone} />
              {controlConnectionLabel(controls)}
            </span>
          </div>

          <div className="controls-grid">
            <article className="dashboard-card ventilation-card">
              <div className="control-card-header">
                <div>
                  <span className="eyebrow">Вентиляция</span>
                  <h3>Вытяжка и приток</h3>
                </div>
                <span className="control-card-kicker">два канала</span>
              </div>
              <p className="control-card-description">Одна команда включает оба канала одновременно: вытяжка удаляет воздух, приток подаёт его через фильтр.</p>
              <div className="actuator-list">
                <ActuatorRow
                  target="exhaust"
                  icon="exhaust"
                  label="Вытяжка"
                  description="удаление воздуха из комнаты"
                  active={controls?.reported.exhaust_on ?? false}
                  desiredActive={controls?.desired.exhaust_on ?? false}
                  pending={controls === null ||
                    controls?.reported.exhaust_on !== controls?.desired.exhaust_on ||
                    activeCommand === 'exhaust:on' ||
                    activeCommand === 'exhaust:off'}
                />
                <ActuatorRow
                  target="intake"
                  icon="intake"
                  label="Приток"
                  description="подача воздуха через фильтр"
                  active={controls?.reported.intake_on ?? false}
                  desiredActive={controls?.desired.intake_on ?? false}
                  pending={controls === null ||
                    controls?.reported.intake_on !== controls?.desired.intake_on ||
                    activeCommand === 'intake:on' ||
                    activeCommand === 'intake:off'}
                />
              </div>
              <div className="ventilation-master-control">
                <div className="ventilation-master-copy">
                  <span className="eyebrow">Общий контур</span>
                  <strong>{ventilationStateLabel}</strong>
                  <span>Вытяжка и приток получают одну общую команду.</span>
                </div>
                <button
                  className={'ventilation-master-button ' + (ventilationActive ? 'button-secondary' : 'button-primary')}
                  type="button"
                  onClick={() => void executeVentilation(ventilationAction)}
                  disabled={ventilationPending}
                  aria-pressed={ventilationActive}
                >
                  <Icon name="air" />
                  <span>{ventilationButtonLabel}</span>
                </button>
              </div>
              <div className="control-card-foot">
                <span><span className={'status-dot status-dot-' + controlsTone} /> {controls?.automation.message ?? 'Ожидание состояния локального узла.'}</span>
                <span>{controlsPending > 0 ? 'команд в очереди: ' + controlsPending : 'состояние подтверждается устройством'}</span>
              </div>
            </article>

            <article className="dashboard-card window-control-card">
              <div className="control-card-header">
                <div>
                  <span className="eyebrow">Состояние</span>
                  <h3>Окно</h3>
                </div>
              </div>
              <div className="window-reading">
                <span className={'window-reading-icon window-reading-icon-' + (currentWindowOpen ? 'open' : 'closed')}><Icon name="window" /></span>
                <div>
                  <strong>{windowLabel}</strong>
                  <span>{windowMode === 'manual' ? 'ручной режим' : 'автоматический режим'}</span>
                </div>
              </div>
              <div className="window-history-summary" aria-label="История состояния окна">
                <div className="window-history-summary-header">
                  <span className="eyebrow">За {rangeLabels[range]}</span>
                  <span className="window-history-count">{formatTransitionCount(windowHistory.transitionCount)}</span>
                </div>
                {windowHistory.lastChange ? (
                  <div className="window-history-summary-row">
                    <span
                      className={'window-history-marker ' + (windowHistory.lastChange.to ? 'is-open' : 'is-closed')}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{windowHistory.lastChange.to ? 'Открыто' : 'Закрыто'}</strong>
                      <span>последнее изменение · {formatTimestamp(windowHistory.lastChange.timestamp)}</span>
                    </div>
                  </div>
                ) : (
                  <p>Состояние не менялось за выбранный период.</p>
                )}
              </div>
              <div className="window-mode-control">
                <span className="eyebrow">Режим и команда</span>
                <div className="nav-pill-group control-mode-tabs" role="group" aria-label="Управление окном">
                  <button
                    className={'category-tab ' + (windowMode === 'auto' ? 'category-tab-active' : '')}
                    type="button"
                    onClick={() => void executeControl('window', 'auto')}
                    disabled={controls === null || activeCommand !== null || controls.reported.window_open !== controls.desired.window_open}
                    aria-pressed={windowMode === 'auto'}
                  >
                    Авто
                  </button>
                  <button
                    className={'category-tab ' + (windowMode === 'manual' && windowDesiredOpen ? 'category-tab-active' : '')}
                    type="button"
                    onClick={() => void executeControl('window', 'open')}
                    disabled={controls === null || activeCommand !== null || controls.reported.window_open !== controls.desired.window_open}
                    aria-pressed={windowMode === 'manual' && windowDesiredOpen}
                  >
                    Открыть
                  </button>
                  <button
                    className={'category-tab ' + (windowMode === 'manual' && !windowDesiredOpen ? 'category-tab-active' : '')}
                    type="button"
                    onClick={() => void executeControl('window', 'close')}
                    disabled={controls === null || activeCommand !== null || controls.reported.window_open !== controls.desired.window_open}
                    aria-pressed={windowMode === 'manual' && !windowDesiredOpen}
                  >
                    Закрыть
                  </button>
                </div>
              </div>
              <p className="window-control-hint">
                {windowMode === 'manual' && controls?.window.override_until
                  ? 'Ручной режим действует до ' + formatTime(controls.window.override_until) + ', затем автоматика вернётся сама.'
                  : 'В режиме «Авто» окно открывается при критическом CO₂ и закрывается после минимального времени проветривания.'}
              </p>
            </article>
          </div>

          {controlError ? (
            <div className="control-feedback control-feedback-error" role="alert" aria-live="assertive">
              <span>{controlError}</span>
              <button className="button-secondary" type="button" onClick={() => void loadData()}>Повторить</button>
            </div>
          ) : null}
          {controlNotice ? <div className="control-feedback" role="status" aria-live="polite">{controlNotice}</div> : null}
        </section>
        ) : null}

        {activeSection === 'signals' ? (
        <section className="container dashboard-section dashboard-view dashboard-view-signals" id="signals" key="signals">
          <div className="section-toolbar">
            <div>
              <span className="eyebrow">Показания</span>
              <h2>Воздух вокруг комнаты</h2>
              <p>Две карточки сразу показывают, где находится датчик, а сравнение ниже объясняет разницу текущих значений.</p>
            </div>
            <span className="section-context"><span className={'status-dot status-dot-' + deviceConnectionTone} /> <span translate="no">{deviceId}</span> · {deviceConnectionLabel}</span>
          </div>

          <AirContextCards
            measurement={measurement}
            windowOpen={currentWindowOpen}
            pm25Thresholds={activePm25Thresholds}
          />
          <AirComparison measurement={measurement} />
        </section>
        ) : null}

        {activeSection === 'history' ? (
        <section className="container dashboard-section dashboard-history dashboard-view dashboard-view-history" id="history" key="history">
          <div className="section-toolbar history-toolbar">
            <div>
              <span className="eyebrow">История</span>
              <h2>Как менялся воздух</h2>
              <p>Показания из PostgreSQL за выбранный период. Перетаскивайте график, используйте Ctrl + колесо или два пальца для масштаба.</p>
            </div>
            <RangeControl range={range} onChange={setRange} />
          </div>

          <div className="history-summary">
            <span><strong>{history.length}</strong> точек за {rangeLabels[range]}</span>
            <span>изменение CO₂: <strong>{formatDelta(change10, 10)}</strong></span>
            <span><Icon name="clock" /> последнее: <strong>{formatTimestamp(lastHistoryPoint?.timestamp)}</strong></span>
          </div>

          <div className="chart-grid dashboard-chart-grid">
            <ChartCard
              title="CO₂"
              caption="концентрация"
              unit="ppm"
              range={range}
              onRangeChange={setRange}
            >
              {({ viewport, onViewportChange }) => (
                <LineChart
                  data={co2Series}
                  unit="ppm"
                  ariaLabel="График изменения концентрации CO2"
                  thresholds={activeCo2ChartThresholds}
                  rangeKey={range}
                  viewport={viewport}
                  onViewportChange={onViewportChange}
                />
              )}
            </ChartCard>
            <ChartCard
              title="Температура"
              caption="температура"
              unit="°C"
              range={range}
              onRangeChange={setRange}
            >
              {({ viewport, onViewportChange }) => (
                <LineChart
                  data={temperatureSeries}
                  unit="°C"
                  ariaLabel="График температуры помещения"
                  rangeKey={range}
                  viewport={viewport}
                  onViewportChange={onViewportChange}
                />
              )}
            </ChartCard>
          </div>
        </section>
        ) : null}
          </>
        )}
      </main>
      <DashboardNavigation
        className="mobile-bottom-nav"
        label="Основная мобильная навигация"
        linkClassName="mobile-bottom-nav-link"
        activeSection={activeNavigationItem}
        onNavigate={handleSectionNavigation}
      />
    </div>
  )
}
