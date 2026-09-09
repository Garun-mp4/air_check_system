'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

import {
  ClientApiError,
  getControlStatus,
  getHistory,
  getLatestDashboard,
  sendControlCommand,
  type ClientControlAction,
  type ClientControlStatus,
  type ClientControlTarget,
  type ClientMeasurement,
  type ClientPrediction,
  type ClientRecommendation,
  type DashboardData,
} from '../lib/client-api'
import {
  PM25_ELEVATED_LIMIT,
  PM25_GOOD_LIMIT,
  PM25_SCALE_MAX,
  getPm25AriaLabel,
  getPm25Label,
  getPm25Level,
  getPm25MarkerPosition,
  getPm25Tone,
} from '../lib/air-quality'
import { LineChart } from './Charts'

type RangeKey = '6h' | '24h' | '7d'
type SettingsTab = 'technical' | 'automation'
export const dashboardNavItems = [
  { id: 'overview', label: 'Панель' },
  { id: 'controls', label: 'Управление' },
  { id: 'signals', label: 'Сенсоры' },
  { id: 'history', label: 'История' },
] as const

type DashboardSectionId = (typeof dashboardNavItems)[number]['id']

type IconName =
  | 'air'
  | 'exhaust'
  | 'intake'
  | 'temperature'
  | 'humidity'
  | 'pm25'
  | 'window'
  | 'database'
  | 'model'
  | 'wifi'
  | 'refresh'
  | 'settings'
  | 'menu'
  | 'close'
  | 'clock'
  | 'arrow'

const rangeHours: Record<RangeKey, number> = {
  '6h': 6,
  '24h': 24,
  '7d': 24 * 7,
}

const rangeLabels: Record<RangeKey, string> = {
  '6h': '6 ч',
  '24h': '24 ч',
  '7d': '7 дней',
}

export function getSectionIdFromHash(hash: string): DashboardSectionId {
  const sectionId = hash.startsWith('#') ? hash.slice(1) : hash
  return dashboardNavItems.some((item) => item.id === sectionId)
    ? (sectionId as DashboardSectionId)
    : 'overview'
}

export function getViewIdFromHash(hash: string): DashboardSectionId | 'settings' {
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
  activeSection: DashboardSectionId
  onNavigate: (sectionId: DashboardSectionId, event: MouseEvent<HTMLAnchorElement>) => void
}) {
  return (
    <nav className={className} aria-label={label}>
      {dashboardNavItems.map((item) => {
        const isActive = activeSection === item.id
        return (
          <a
            className={linkClassName + (isActive ? ' is-active' : '')}
            href={'#' + item.id}
            key={item.id}
            onClick={(event) => onNavigate(item.id, event)}
            aria-current={isActive ? 'location' : undefined}
          >
            {item.label}
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

function co2BadgeClass(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return 'badge-neutral'
  }
  if (value >= 1000) {
    return 'badge-error'
  }
  if (value >= 800) {
    return 'badge-warning'
  }
  return 'badge-success'
}

function co2Label(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return 'Ожидание данных'
  }
  if (value >= 1000) {
    return 'Нужна вентиляция'
  }
  if (value >= 800) {
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
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6.7v-2.4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L8 8.6l1.7-1.7.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z" />
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

function MetricCard({
  icon,
  label,
  value,
  unit,
  note,
  quality,
  className = '',
}: {
  icon: Exclude<IconName, 'air' | 'exhaust' | 'intake' | 'database' | 'model' | 'wifi' | 'refresh' | 'menu' | 'close' | 'clock' | 'arrow'>
  label: string
  value: string
  unit?: string
  note?: string
  quality?: ReactNode
  className?: string
}) {
  return (
    <article className={'data-card ' + className}>
      <div className="data-card-top">
        <span className="data-card-label">{label}</span>
        <span className="data-card-icon">
          <Icon name={icon} />
        </span>
      </div>
      <strong className="data-card-value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </strong>
      {quality}
      <span className="data-card-note">{note ?? 'локальный датчик'}</span>
    </article>
  )
}

function Pm25Scale({ value }: { value: number | null | undefined }) {
  const level = getPm25Level(value)
  const tone = getPm25Tone(level)
  const markerPosition = getPm25MarkerPosition(value)

  return (
    <div className="pm25-quality">
      <div className="pm25-quality-heading">
        <span>Качество воздуха</span>
        <span className={'pm25-quality-status pm25-quality-status-' + tone}>
          <span className={'status-dot status-dot-' + tone} />
          {getPm25Label(level)}
        </span>
      </div>
      <div className="pm25-scale" role="img" aria-label={getPm25AriaLabel(value)}>
        <div className="pm25-scale-track">
          <span className="pm25-scale-zone pm25-scale-zone-good" />
          <span className="pm25-scale-zone pm25-scale-zone-elevated" />
          <span className="pm25-scale-zone pm25-scale-zone-high" />
        </div>
        {markerPosition !== null ? (
          <span
            className="pm25-scale-marker"
            style={{ left: markerPosition + '%' }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="pm25-scale-labels" aria-hidden="true">
        <span>0</span>
        <span>{PM25_GOOD_LIMIT}</span>
        <span>{PM25_ELEVATED_LIMIT}</span>
        <span>{PM25_SCALE_MAX}+</span>
      </div>
    </div>
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
  onToggle,
}: {
  target: 'exhaust' | 'intake'
  icon: 'exhaust' | 'intake'
  label: string
  description: string
  active: boolean
  desiredActive: boolean
  pending: boolean
  onToggle: () => void
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
        <span className={'control-state-badge control-state-badge-' + (active ? 'on' : 'off')}>
          {controlStateLabel(target, active)}
        </span>
        <button
          className={'control-toggle ' + (active ? 'is-on' : '')}
          type="button"
          onClick={onToggle}
          disabled={pending}
          aria-pressed={active}
        >
          {pending ? 'Ожидание' : active ? 'Выключить' : 'Включить'}
        </button>
      </div>
    </div>
  )
}

function ChartCard({
  title,
  caption,
  children,
  unit,
}: {
  title: string
  caption: string
  children: ReactNode
  unit?: string
}) {
  return (
    <article className="dashboard-card chart-card">
      <div className="chart-card-header">
        <div>
          <span className="chart-card-context">{caption}</span>
          <h3>{title}</h3>
        </div>
        <div className="chart-card-meta">
          {unit ? <span className="chart-card-unit">{unit}</span> : null}
        </div>
      </div>
      <div className="chart-shell">{children}</div>
    </article>
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

export function SettingsPanel({
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
}: {
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
}) {
  const automationLabel = controls
    ? controls.automation.enabled ? 'Включена' : 'Выключена'
    : 'нет данных'
  const windowModeLabel = controls
    ? controls.window.mode === 'manual' ? 'Ручной режим' : 'Автоматический режим'
    : 'нет данных'
  const overrideLabel = controls?.window.override_until
    ? 'До ' + formatTimestamp(controls.window.override_until)
    : 'Нет активного ограничения'

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        className="settings-drawer"
        id="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="settings-drawer-header">
          <div>
            <span className="eyebrow">Настройки узла</span>
            <h2 id="settings-title">Настройки</h2>
            <p>Служебные сведения и состояние автоматики для {deviceId}.</p>
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
        </div>

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
            </dl>
          </div>
        ) : (
          <div
            className="settings-panel"
            id="settings-panel-automation"
            role="tabpanel"
            aria-labelledby="settings-tab-automation"
            tabIndex={0}
          >
            <div className="settings-panel-heading">
              <div>
                <h3>Автоматика</h3>
                <p>Текущая политика управления и подтверждение от локального узла.</p>
              </div>
              <span className={'settings-status settings-status-' + (controls ? 'success' : 'neutral')}>
                <span className={'status-dot status-dot-' + (controls ? 'success' : 'neutral')} />
                {automationLabel}
              </span>
            </div>
            <dl className="settings-facts">
              <SettingsFact
                icon="air"
                label="Состояние автоматики"
                value={automationLabel}
                note={controls?.automation.message ?? 'Состояние автоматики пока не получено.'}
              />
              <SettingsFact
                icon="window"
                label="Режим окна"
                value={windowModeLabel}
                note={overrideLabel}
              />
              <SettingsFact
                icon="clock"
                label="Очередь команд"
                value={controls ? String(controls.pending_commands) : 'нет данных'}
                note={controls?.pending_commands ? 'Локальный узел ещё подтверждает команды.' : 'Неподтверждённых команд нет.'}
              />
            </dl>
            <div className="settings-policy">
              <h3>Как работает автоматика</h3>
              <ul>
                <li>При критическом CO₂ окно открывается автоматически.</li>
                <li>Вытяжка и приток могут работать одновременно.</li>
                <li>Ручная команда временно передаёт управление оператору.</li>
              </ul>
            </div>
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('technical')
  const [controls, setControls] = useState<ClientControlStatus | null>(null)
  const [controlError, setControlError] = useState<string | null>(null)
  const [activeCommand, setActiveCommand] = useState<string | null>(null)
  const [controlNotice, setControlNotice] = useState<string | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsCloseButtonRef = useRef<HTMLButtonElement>(null)
  const settingsOpenRef = useRef(false)
  const lastDashboardHashRef = useRef('#overview')
  const navigationTargetRef = useRef<DashboardSectionId | null>(null)
  const navigationDirectionRef = useRef<'up' | 'down' | null>(null)
  const navigationStartScrollYRef = useRef<number | null>(null)

  const openSettings = useCallback(() => {
    const currentHash = window.location.hash
    if (currentHash && currentHash !== '#settings') {
      lastDashboardHashRef.current = '#' + getSectionIdFromHash(currentHash)
    }
    settingsOpenRef.current = true
    setSettingsOpen(true)
    setMenuOpen(false)
    if (currentHash !== '#settings') {
      window.history.pushState(null, '', '#settings')
    }
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
      document.getElementById(nextSectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      if (window.matchMedia('(min-width: 768px)').matches) {
        settingsButtonRef.current?.focus()
      } else {
        menuButtonRef.current?.focus()
      }
    })
  }, [])

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const to = new Date()
    const from = new Date(to.getTime() - rangeHours[range] * 60 * 60 * 1000)
    setLoading(true)
    try {
      const [latestResult, historyResult] = await Promise.allSettled([
        getLatestDashboard(signal),
        getHistory(from, to, 1000, signal),
      ])
      if (latestResult.status === 'rejected') {
        throw latestResult.reason
      }
      if (historyResult.status === 'rejected') {
        throw historyResult.reason
      }
      setDashboard(latestResult.value)
      setHistory(historyResult.value.data)
      try {
        const controlStatus = await getControlStatus()
        setControls(controlStatus)
        setControlError(null)
      } catch (controlLoadError) {
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
      if (loadError instanceof Error && loadError.name === 'AbortError') {
        return
      }
      setError(
        loadError instanceof ClientApiError
          ? loadError.message
          : 'Не удалось загрузить данные мониторинга',
      )
    } finally {
      setLoading(false)
    }
  }, [range])

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

  useEffect(() => {
    const controller = new AbortController()
    void loadData(controller.signal)
    const timer = window.setInterval(() => {
      void loadData()
    }, 30_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [loadData])

  useEffect(() => {
    const sections = dashboardNavItems
      .map(({ id }) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null)

    if (sections.length === 0) {
      return
    }

    const scrollMarginTop = 80
    // Browsers can leave a section a fraction of a pixel below its scroll margin.
    // Keep the spy tolerant of that rounding so the target tab is not replaced
    // by the section immediately above it after a smooth scroll.
    const scrollSpyThreshold = scrollMarginTop + 2
    let frameId: number | null = null

    const updateActiveSection = () => {
      frameId = null

      if (settingsOpenRef.current) {
        return
      }

      const navigationTarget = navigationTargetRef.current
      if (navigationTarget) {
        const targetSection = sections.find((section) => section.id === navigationTarget)
        if (targetSection) {
          const targetTop = targetSection.getBoundingClientRect().top
          const navigationStartScrollY = navigationStartScrollYRef.current
          const navigationDirection = navigationDirectionRef.current ??= targetTop > scrollMarginTop ? 'down' : 'up'
          const navigationWasInterrupted = navigationStartScrollY !== null && (
            navigationDirection === 'down'
              ? window.scrollY < navigationStartScrollY - 2
              : window.scrollY > navigationStartScrollY + 2
          )
          const navigationOvershot = navigationDirection === 'down'
            ? targetTop < scrollMarginTop - 12
            : targetTop > scrollMarginTop + 12

          if (Math.abs(targetTop - scrollMarginTop) > 12 && !navigationWasInterrupted && !navigationOvershot) {
            setActiveSection((currentSection) =>
              currentSection === navigationTarget ? currentSection : navigationTarget,
            )
            return
          }
        }
        navigationTargetRef.current = null
        navigationDirectionRef.current = null
        navigationStartScrollYRef.current = null
      }

      let currentSection = sections[0]
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= scrollSpyThreshold) {
          currentSection = section
        } else {
          break
        }
      }

      const nextSectionId = currentSection.id as DashboardSectionId
      lastDashboardHashRef.current = '#' + nextSectionId
      setActiveSection((currentSectionId) =>
        currentSectionId === nextSectionId ? currentSectionId : nextSectionId,
      )

      if (window.location.hash && window.location.hash !== '#' + nextSectionId) {
        window.history.replaceState(null, '', '#' + nextSectionId)
      }
    }

    const scheduleActiveSectionUpdate = () => {
      if (frameId === null) {
        frameId = window.requestAnimationFrame(updateActiveSection)
      }
    }

    const cancelPendingNavigation = () => {
      navigationTargetRef.current = null
      navigationDirectionRef.current = null
      navigationStartScrollYRef.current = null
    }

    if (window.location.hash) {
      const initialViewId = getViewIdFromHash(window.location.hash)
      if (initialViewId === 'settings') {
        settingsOpenRef.current = true
        setSettingsOpen(true)
      } else {
        const initialSectionId = initialViewId
        lastDashboardHashRef.current = '#' + initialSectionId
        navigationTargetRef.current = initialSectionId
        navigationStartScrollYRef.current = window.scrollY
        setActiveSection(initialSectionId)
        window.requestAnimationFrame(() => {
          document.getElementById(initialSectionId)?.scrollIntoView({ behavior: 'auto', block: 'start' })
        })
      }
    }

    const handleHashChange = () => {
      const nextViewId = getViewIdFromHash(window.location.hash)
      if (nextViewId === 'settings') {
        settingsOpenRef.current = true
        setSettingsOpen(true)
        setMenuOpen(false)
        return
      }

      settingsOpenRef.current = false
      setSettingsOpen(false)
      const nextSectionId = nextViewId
      lastDashboardHashRef.current = '#' + nextSectionId
      navigationTargetRef.current = nextSectionId
      navigationDirectionRef.current = null
      navigationStartScrollYRef.current = window.scrollY
      setActiveSection(nextSectionId)
      scheduleActiveSectionUpdate()
      window.requestAnimationFrame(() => {
        document.getElementById(nextSectionId)?.scrollIntoView({ behavior: 'auto', block: 'start' })
      })
    }

    scheduleActiveSectionUpdate()
    window.addEventListener('scroll', scheduleActiveSectionUpdate, { passive: true })
    window.addEventListener('resize', scheduleActiveSectionUpdate)
    window.addEventListener('wheel', cancelPendingNavigation, { passive: true })
    window.addEventListener('touchstart', cancelPendingNavigation, { passive: true })
    window.addEventListener('pointerdown', cancelPendingNavigation)
    window.addEventListener('hashchange', handleHashChange)
    window.addEventListener('popstate', handleHashChange)

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      window.removeEventListener('scroll', scheduleActiveSectionUpdate)
      window.removeEventListener('resize', scheduleActiveSectionUpdate)
      window.removeEventListener('wheel', cancelPendingNavigation)
      window.removeEventListener('touchstart', cancelPendingNavigation)
      window.removeEventListener('pointerdown', cancelPendingNavigation)
      window.removeEventListener('hashchange', handleHashChange)
      window.removeEventListener('popstate', handleHashChange)
    }
  }, [])

  const handleSectionNavigation = useCallback((
    sectionId: DashboardSectionId,
    event: MouseEvent<HTMLAnchorElement>,
  ) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }

    event.preventDefault()
    settingsOpenRef.current = false
    setSettingsOpen(false)
    lastDashboardHashRef.current = '#' + sectionId
    navigationTargetRef.current = sectionId
    navigationDirectionRef.current = null
    navigationStartScrollYRef.current = window.scrollY
    setActiveSection(sectionId)
    setMenuOpen(false)

    const nextHash = '#' + sectionId
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash)
    }
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }

    const mediaQuery = window.matchMedia('(min-width: 768px)')
    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    mediaQuery.addEventListener('change', handleViewportChange)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      mediaQuery.removeEventListener('change', handleViewportChange)
    }
  }, [menuOpen])

  useEffect(() => {
    document.body.classList.toggle('is-menu-open', menuOpen)
    return () => document.body.classList.remove('is-menu-open')
  }, [menuOpen])

  useEffect(() => {
    settingsOpenRef.current = settingsOpen
    document.body.classList.toggle('is-settings-open', settingsOpen)
    if (!settingsOpen) {
      return () => document.body.classList.remove('is-settings-open')
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
      document.body.classList.remove('is-settings-open')
    }
  }, [closeSettings, settingsOpen])

  const measurement = dashboard?.measurement ?? null
  const prediction: ClientPrediction | null = dashboard?.prediction ?? null
  const recommendation: ClientRecommendation | null = dashboard?.recommendation ?? null
  const currentCo2 = measurement?.indoor.co2 ?? null
  const indoorPm25 = measurement?.indoor.pm25 ?? null
  const outdoorPm25 = measurement?.outdoor.pm25 ?? null
  const change5 = useMemo(() => getCo2Change(history, 5), [history])
  const change10 = useMemo(() => getCo2Change(history, 10), [history])
  const markerPosition = useMemo(() => {
    if (currentCo2 === null) {
      return 8
    }
    return Math.min(97, Math.max(3, ((currentCo2 - 400) / 1600) * 100))
  }, [currentCo2])

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
  const deviceId = controls?.device_id ?? 'локальный узел'
  const deviceConnectionStatus = controls?.connection.status ?? (measurement ? 'online' : 'offline')
  const deviceConnectionLabel = getConnectionStatusLabel(deviceConnectionStatus)
  const deviceConnectionTone = controls ? controlsTone : measurement ? 'success' : 'neutral'

  return (
    <div className="app-shell dashboard-shell">
      <a className="skip-link" href="#main-content">К содержимому</a>
      <header className="app-topbar" inert={settingsOpen}>
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
            activeSection={activeSection}
            onNavigate={handleSectionNavigation}
          />

          <div className="topbar-actions">
            <button
              className="settings-button"
              type="button"
              ref={settingsButtonRef}
              onClick={openSettings}
              aria-label="Открыть настройки"
              aria-expanded={settingsOpen}
              aria-controls="settings-dialog"
              title="Настройки"
            >
              <Icon name="settings" />
              <span>Настройки</span>
            </button>
            <button
              className="menu-button"
              type="button"
              ref={menuButtonRef}
              aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <Icon name={menuOpen ? 'close' : 'menu'} />
            </button>
          </div>
        </div>

        <div
          className={'mobile-sheet' + (menuOpen ? ' is-open' : '')}
          id="mobile-navigation"
          aria-hidden={!menuOpen}
          inert={!menuOpen}
        >
          <div className="mobile-sheet-context">
            <span className="room-context-label">Комната</span>
            <strong translate="no">{deviceId}</strong>
            <span><span className={'status-dot status-dot-' + deviceConnectionTone} /> {deviceConnectionLabel}</span>
          </div>
          <DashboardNavigation
            className="mobile-nav"
            label="Мобильная навигация"
            linkClassName="mobile-nav-link"
            activeSection={activeSection}
            onNavigate={handleSectionNavigation}
          />
          <button
            className="mobile-nav-link mobile-settings-link"
            type="button"
            onClick={openSettings}
            aria-controls="settings-dialog"
          >
            <Icon name="settings" />
            <span>Настройки</span>
          </button>
        </div>
      </header>

      <main id="main-content" inert={settingsOpen}>
        <section className="dashboard-intro" id="overview">
          <div className="container">
            <div className="intro-overline">
              <span className="eyebrow intro-location">Комната <span translate="no">{deviceId}</span></span>
              <span className={'intro-status intro-status-' + systemTone}><span className={'status-dot status-dot-' + systemTone} />{systemStatus}</span>
            </div>
            <div className="intro-row">
              <div>
                <h1>Панель управления</h1>
                <p>Показания комнаты, решение автоматики и ручные команды для локального узла.</p>
              </div>
              <dl className="intro-meta">
                <div>
                  <dt>Автообновление</dt>
                  <dd>каждые 30 с</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

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

        <section className="container dashboard-section dashboard-lead-section">
          <article className="dashboard-card current-air-card">
            <div className="current-air-header">
              <div>
                <span className="eyebrow">Сейчас</span>
                <h2>Воздух в комнате</h2>
              </div>
              <div className="current-air-tools">
                <div className="current-air-status-row">
                  <span className={'current-air-state current-air-state-' + co2BadgeClass(currentCo2).replace('badge-', '')}>
                    <span className={'status-dot status-dot-' + (currentCo2 === null ? 'neutral' : currentCo2 >= 1000 ? 'error' : currentCo2 >= 800 ? 'warning' : 'success')} />
                    {co2Label(currentCo2)}
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

            <div className="co2-meter" aria-label="Шкала уровня CO2">
              <div className="co2-meter-segments">
                <span className="meter-normal" />
                <span className="meter-attention" />
                <span className="meter-risk" />
              </div>
              <span className="co2-meter-marker" style={{ left: markerPosition + '%' }} />
              <div className="co2-meter-labels"><span>400</span><span>800</span><span>1000</span><span>2000+ ppm</span></div>
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

        <section className="container dashboard-section controls-section" id="controls">
          <div className="section-toolbar controls-toolbar">
            <div>
              <span className="eyebrow">Команды</span>
              <h2>Управление проветриванием</h2>
              <p>Вытяжка и приток можно включать вместе. Окно работает по автоматическому или ручному сценарию.</p>
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
              <p className="control-card-description">Каналы независимы: вытяжка выводит воздух, приток подаёт его через фильтр.</p>
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
                  onToggle={() => void executeControl('exhaust', controls?.reported.exhaust_on ? 'off' : 'on')}
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
                  onToggle={() => void executeControl('intake', controls?.reported.intake_on ? 'off' : 'on')}
                />
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
                <span className={'window-state-badge window-state-badge-' + (currentWindowOpen ? 'open' : 'closed')}>
                  <span className="status-dot" /> {windowLabel}
                </span>
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

        <section className="container dashboard-section" id="signals">
          <div className="section-toolbar">
            <div>
              <span className="eyebrow">Показания</span>
              <h2>Воздух в комнате</h2>
              <p>Текущие значения локального набора датчиков.</p>
            </div>
            <span className="section-context"><span className={'status-dot status-dot-' + deviceConnectionTone} /> <span translate="no">{deviceId}</span> · {deviceConnectionLabel}</span>
          </div>

          <div className="metrics-grid">
            <MetricCard icon="temperature" label="Температура" value={formatValue(measurement?.indoor.temperature, 1)} unit="°C" note="внутри · сейчас" />
            <MetricCard icon="humidity" label="Влажность" value={formatValue(measurement?.indoor.humidity, 0)} unit="%" note="внутри · сейчас" />
            <MetricCard
              icon="pm25"
              label="PM2.5"
              value={formatValue(indoorPm25, 1)}
              unit="µg/m³"
              note="внутри · сейчас"
              quality={<Pm25Scale value={indoorPm25} />}
              className="data-card-pm25"
            />
            <MetricCard icon="window" label="Окно" value={windowLabel} note={measurement ? 'состояние · ' + formatTime(measurement.timestamp) : 'нет данных'} className="data-card-window" />
          </div>

          <div className="outdoor-context">
            <div className="outdoor-heading">
              <div>
                <h3>Снаружи</h3>
                <p>Внешние показатели для сравнения с комнатой</p>
              </div>
            </div>
            <div className="outdoor-grid">
              <MetricCard icon="temperature" label="Температура" value={formatValue(measurement?.outdoor.temperature, 1)} unit="°C" note="снаружи" className="data-card-compact" />
              <MetricCard icon="humidity" label="Влажность" value={formatValue(measurement?.outdoor.humidity, 0)} unit="%" note="снаружи" className="data-card-compact" />
              <MetricCard
                icon="pm25"
                label="PM2.5"
                value={formatValue(outdoorPm25, 1)}
                unit="µg/m³"
                note="снаружи"
                quality={<Pm25Scale value={outdoorPm25} />}
                className="data-card-compact data-card-pm25"
              />
            </div>
          </div>
        </section>

        <section className="container dashboard-section dashboard-history" id="history">
          <div className="section-toolbar history-toolbar">
            <div>
              <span className="eyebrow">История</span>
              <h2>Как менялся воздух</h2>
              <p>Показания из PostgreSQL за выбранный период. Перетаскивайте график, используйте Ctrl + колесо или два пальца для масштаба.</p>
            </div>
            <div className="range-control">
              <span className="range-label">период</span>
              <div className="range-tabs" role="group" aria-label="Период истории">
                {(Object.keys(rangeLabels) as RangeKey[]).map((key) => (
                  <button
                    className={'range-tab ' + (range === key ? 'is-active' : '')}
                    type="button"
                    key={key}
                    onClick={() => setRange(key)}
                    aria-pressed={range === key}
                  >
                    {rangeLabels[key]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="history-summary">
            <span><strong>{history.length}</strong> точек за {rangeLabels[range]}</span>
            <span>изменение CO₂: <strong>{formatDelta(change10, 10)}</strong></span>
            <span><Icon name="clock" /> последнее: <strong>{formatTimestamp(lastHistoryPoint?.timestamp)}</strong></span>
          </div>

          <div className="chart-grid dashboard-chart-grid">
            <ChartCard title="CO₂" caption="концентрация" unit="ppm">
              <LineChart data={co2Series} unit="ppm" ariaLabel="График изменения концентрации CO2" />
            </ChartCard>
            <ChartCard title="Температура" caption="температура" unit="°C">
              <LineChart data={temperatureSeries} unit="°C" ariaLabel="График температуры помещения" />
            </ChartCard>
          </div>
        </section>
      </main>
      {settingsOpen ? (
        <SettingsPanel
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
        />
      ) : null}
    </div>
  )
}
