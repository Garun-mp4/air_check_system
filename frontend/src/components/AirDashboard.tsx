'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

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
import { LineChart, WindowChart } from './Charts'

type RangeKey = '6h' | '24h' | '7d'
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
  | 'menu'
  | 'close'
  | 'clock'
  | 'outdoor'
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
  if (status.connection.status === 'online' && status.pending_commands === 0) {
    return 'success'
  }
  if (status.connection.status === 'offline') {
    return 'error'
  }
  return 'warning'
}

function controlConnectionLabel(status: ClientControlStatus | null): string {
  if (!status) {
    return 'нет данных'
  }
  if (status.connection.status === 'online') {
    return 'узел online'
  }
  if (status.connection.status === 'stale') {
    return 'связь устаревает'
  }
  return 'узел offline'
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
  if (name === 'outdoor') {
    return (
      <svg {...svgProps}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 5v3M12 16v3M5 12h3M16 12h3M7.1 7.1l2.1 2.1M14.8 14.8l2.1 2.1" />
        <circle cx="12" cy="12" r="2.2" />
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
  className = '',
}: {
  icon: Exclude<IconName, 'air' | 'exhaust' | 'intake' | 'database' | 'model' | 'wifi' | 'refresh' | 'menu' | 'close' | 'clock' | 'outdoor' | 'arrow'>
  label: string
  value: string
  unit?: string
  note?: string
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
      <span className="data-card-note">{note ?? 'датчик room-01'}</span>
    </article>
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
  footer,
  wide = false,
}: {
  title: string
  caption: string
  children: ReactNode
  footer: string
  wide?: boolean
}) {
  return (
    <article className={'dashboard-card chart-card ' + (wide ? 'chart-card-wide' : '')}>
      <div className="chart-card-header">
        <div>
          <span className="eyebrow">{caption}</span>
          <h3>{title}</h3>
        </div>
        <span className="chart-card-unit">{title === 'CO₂' ? 'ppm' : title === 'Температура' ? '°C' : 'state'}</span>
      </div>
      <div className="chart-shell">{children}</div>
      <div className="chart-footer">
        <span>{footer}</span>
        <span>measurements API</span>
      </div>
    </article>
  )
}

export default function AirDashboard() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [history, setHistory] = useState<ClientMeasurement[]>([])
  const [range, setRange] = useState<RangeKey>('24h')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [controls, setControls] = useState<ClientControlStatus | null>(null)
  const [controlError, setControlError] = useState<string | null>(null)
  const [activeCommand, setActiveCommand] = useState<string | null>(null)
  const [controlNotice, setControlNotice] = useState<string | null>(null)

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const to = new Date()
    const from = new Date(to.getTime() - rangeHours[range] * 60 * 60 * 1000)
    setLoading(true)
    try {
      const [latest, historical] = await Promise.all([
        getLatestDashboard(signal),
        getHistory(from, to, 1000, signal),
      ])
      const controlStatus = await getControlStatus()
      setDashboard(latest)
      setHistory(historical.data)
      setControls(controlStatus)
      setControlError(null)
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
    document.body.classList.toggle('is-menu-open', menuOpen)
    return () => document.body.classList.remove('is-menu-open')
  }, [menuOpen])

  const measurement = dashboard?.measurement ?? null
  const prediction: ClientPrediction | null = dashboard?.prediction ?? null
  const recommendation: ClientRecommendation | null = dashboard?.recommendation ?? null
  const currentCo2 = measurement?.indoor.co2 ?? null
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
  const lastHistoryPoint = history.at(-1)
  const isEmpty = !loading && !error && !measurement && history.length === 0
  const sourceLabel = lastUpdated
    ? 'обновлено в ' + formatTime(lastUpdated)
    : 'ожидание синхронизации'
  const systemStatus = error ? 'требует внимания' : measurement ? 'online' : 'ожидание'
  const systemTone = error ? 'error' : measurement ? 'success' : 'neutral'
  const currentWindowOpen = controls
    ? controls.reported.window_open
    : measurement?.window_open ?? null
  const windowLabel = currentWindowOpen === null ? '—' : currentWindowOpen ? 'Открыто' : 'Закрыто'
  const windowMode = controls?.window.mode ?? 'auto'
  const windowDesiredOpen = controls?.desired.window_open ?? currentWindowOpen === true
  const controlsTone = controlTone(controls)
  const controlsPending = controls?.pending_commands ?? 0

  return (
    <div className="app-shell dashboard-shell">
      <header className="app-topbar">
        <div className="container app-topbar-inner">
          <a className="brand dashboard-brand" href="#overview" onClick={() => setMenuOpen(false)}>
            <img className="brand-logo" src="/aircheck-logo.svg" alt="AirCheck" />
          </a>

          <div className="room-context" aria-label="Активная комната">
            <span className="room-context-label">ЛОКАЛЬНЫЙ УЗЕЛ</span>
            <strong>room-01</strong>
            <span className="room-context-status">
              <span className="status-dot status-dot-success" />
              online
            </span>
          </div>

          <nav className="app-nav" aria-label="Навигация панели управления">
            <a className="app-nav-link is-active" href="#overview">Панель</a>
            <a className="app-nav-link" href="#controls">Управление</a>
            <a className="app-nav-link" href="#signals">Сенсоры</a>
            <a className="app-nav-link" href="#history">История</a>
          </nav>

          <div className="topbar-actions">
            <span className="topbar-sync">
              <span className={'status-dot status-dot-' + systemTone} />
              <span className="sync-copy">{error ? 'API требует внимания' : sourceLabel}</span>
            </span>
            <button
              className="control-button"
              type="button"
              onClick={() => void loadData()}
              aria-busy={loading}
            >
              <Icon name="refresh" />
              <span>Обновить</span>
            </button>
            <button
              className="menu-button"
              type="button"
              aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <Icon name={menuOpen ? 'close' : 'menu'} />
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="mobile-sheet">
            <div className="mobile-sheet-context">
              <span className="room-context-label">АКТИВНАЯ КОМНАТА</span>
              <strong>room-01</strong>
              <span><span className="status-dot status-dot-success" /> локальный узел</span>
            </div>
            <nav aria-label="Мобильная навигация">
              <a className="mobile-nav-link is-active" href="#overview" onClick={() => setMenuOpen(false)}>Панель</a>
              <a className="mobile-nav-link" href="#controls" onClick={() => setMenuOpen(false)}>Управление</a>
              <a className="mobile-nav-link" href="#signals" onClick={() => setMenuOpen(false)}>Сенсоры</a>
              <a className="mobile-nav-link" href="#history" onClick={() => setMenuOpen(false)}>История</a>
            </nav>
            <button
              className="button-primary mobile-refresh"
              type="button"
              onClick={() => {
                setMenuOpen(false)
                void loadData()
              }}
            >
              <Icon name="refresh" />
              Обновить данные
            </button>
          </div>
        ) : null}
      </header>

      <main>
        <section className="dashboard-intro" id="overview">
          <div className="container">
            <div className="intro-overline">
              <span className="eyebrow">CONTROL PANEL / ROOM-01</span>
              <span className="live-chip"><span className={'status-dot status-dot-' + systemTone} />{systemStatus}</span>
            </div>
            <div className="intro-row">
              <div>
                <h1>Панель управления</h1>
                <p>Состояние воздуха в комнате, прогноз CO₂ и следующее действие — в одном рабочем контуре.</p>
              </div>
              <div className="intro-meta">
                <span>последний пакет</span>
                <strong>{formatTimestamp(measurement?.timestamp)}</strong>
                <span>polling / 30 с</span>
              </div>
            </div>
          </div>
        </section>

        {loading && !dashboard ? (
          <div className="container">
            <div className="panel-state panel-state-loading" role="status">
              <span><strong>Синхронизация с room-01</strong><br />Получаем свежие показания и состояние модели.</span>
              <span className="loading-bar" />
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="container">
            <div className="panel-state panel-state-error" role="alert">
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

        <section className="container dashboard-section dashboard-top-grid">
          <article className="air-pulse">
            <div className="air-pulse-header">
              <div className="air-pulse-title">
                <span className="pulse-icon"><Icon name="air" /></span>
                <div>
                  <span className="eyebrow eyebrow-on-dark">LIVE AIR PULSE</span>
                  <strong>Сигнал комнаты</strong>
                </div>
              </div>
              <span className="pulse-room-id">room-01 / REST</span>
            </div>

            <div className="air-pulse-body">
              <div className="pulse-reading">
                <span className="eyebrow eyebrow-on-dark">CO₂ сейчас</span>
                <strong className="pulse-number">{formatValue(currentCo2)}<small>ppm</small></strong>
                <div className="pulse-status-row">
                  <span className={'badge-pill ' + co2BadgeClass(currentCo2)}>{co2Label(currentCo2)}</span>
                  <span className="pulse-delta">{formatDelta(change5, 5)}</span>
                </div>
              </div>

              <div className="pulse-forecast">
                <div className="pulse-forecast-heading">
                  <span>горизонт прогноза</span>
                  <strong>+15 мин</strong>
                </div>
                <div className="pulse-forecast-track">
                  <span className="forecast-node forecast-node-now" />
                  <span className="forecast-track-line"><span /></span>
                  <span className="forecast-node forecast-node-next" />
                </div>
                <div className="pulse-forecast-values">
                  <span><small>сейчас</small><strong>{formatValue(currentCo2)}</strong></span>
                  <Icon name="arrow" />
                  <span><small>ожидается</small><strong>{formatValue(prediction?.predicted_co2_15min)}</strong></span>
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
                <span className="eyebrow eyebrow-on-dark">СЛЕДУЮЩЕЕ ДЕЙСТВИЕ</span>
                <strong>{recommendation?.message ?? 'Рекомендация появится после первого измерения'}</strong>
                <span>{recommendation?.reason ?? 'Правила учитывают текущий CO₂, прогноз и состояние окна.'}</span>
              </div>
              <span className="action-strip-duration">
                {recommendation ? recommendationLabels[recommendation.type] : 'ожидание'}
                {recommendation?.duration_minutes ? ' · ' + recommendation.duration_minutes + ' мин' : ''}
              </span>
            </div>
          </article>

          <aside className="dashboard-card system-card">
            <div className="system-card-top">
              <span className="eyebrow">SYSTEM STATUS</span>
              <span className={'system-status system-status-' + systemTone}><span className={'status-dot status-dot-' + systemTone} />{systemStatus}</span>
            </div>
            <h2>Пайплайн данных</h2>
            <p>Один поток от датчика до решения.</p>
            <div className="system-list">
              <div className="system-row">
                <span className="system-row-label"><Icon name="wifi" /> Источник</span>
                <strong>simulator / ESP32</strong>
              </div>
              <div className="system-row">
                <span className="system-row-label"><Icon name="database" /> Хранилище</span>
                <strong>PostgreSQL</strong>
              </div>
              <div className="system-row">
                <span className="system-row-label"><Icon name="model" /> Модель</span>
                <strong>{prediction ? prediction.model_name + ' / v' + prediction.model_version : 'недоступна'}</strong>
              </div>
            </div>
            <div className="system-endpoint"><span>POST</span> /api/v1/measurements</div>
          </aside>
        </section>

        <section className="container dashboard-section controls-section" id="controls">
          <div className="section-toolbar controls-toolbar">
            <div>
              <span className="eyebrow">02 / CLIMATE CONTROL</span>
              <h2>Управление воздухом</h2>
              <p>Вытяжка и приток работают в одном контуре, окно — под контролем автоматики или оператора.</p>
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
                  <span className="eyebrow">VENTILATION</span>
                  <h3>Воздушный контур</h3>
                </div>
                <span className="control-card-kicker">параллельный режим</span>
              </div>
              <p className="control-card-description">Оба направления можно включать одновременно: вытяжка выводит отработанный воздух, приток подаёт фильтрованный.</p>
              <div className="actuator-list">
                <ActuatorRow
                  target="exhaust"
                  icon="exhaust"
                  label="Вытяжка"
                  description="удаление воздуха из комнаты"
                  active={controls?.reported.exhaust_on ?? false}
                  desiredActive={controls?.desired.exhaust_on ?? false}
                  pending={controls === null || activeCommand === 'exhaust:on' || activeCommand === 'exhaust:off'}
                  onToggle={() => void executeControl('exhaust', controls?.reported.exhaust_on ? 'off' : 'on')}
                />
                <ActuatorRow
                  target="intake"
                  icon="intake"
                  label="Приток"
                  description="подача воздуха через фильтр"
                  active={controls?.reported.intake_on ?? false}
                  desiredActive={controls?.desired.intake_on ?? false}
                  pending={controls === null || activeCommand === 'intake:on' || activeCommand === 'intake:off'}
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
                  <span className="eyebrow">WINDOW STATE</span>
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
              <div className="window-mode-control">
                <span className="eyebrow">MODE / ACTION</span>
                <div className="nav-pill-group control-mode-tabs" role="group" aria-label="Управление окном">
                  <button
                    className={'category-tab ' + (windowMode === 'auto' ? 'category-tab-active' : '')}
                    type="button"
                    onClick={() => void executeControl('window', 'auto')}
                    disabled={controls === null || activeCommand !== null}
                    aria-pressed={windowMode === 'auto'}
                  >
                    Авто
                  </button>
                  <button
                    className={'category-tab ' + (windowMode === 'manual' && windowDesiredOpen ? 'category-tab-active' : '')}
                    type="button"
                    onClick={() => void executeControl('window', 'open')}
                    disabled={controls === null || activeCommand !== null}
                    aria-pressed={windowMode === 'manual' && windowDesiredOpen}
                  >
                    Открыть
                  </button>
                  <button
                    className={'category-tab ' + (windowMode === 'manual' && !windowDesiredOpen ? 'category-tab-active' : '')}
                    type="button"
                    onClick={() => void executeControl('window', 'close')}
                    disabled={controls === null || activeCommand !== null}
                    aria-pressed={windowMode === 'manual' && !windowDesiredOpen}
                  >
                    Закрыть
                  </button>
                </div>
              </div>
              <p className="window-control-hint">
                {windowMode === 'manual' && controls?.window.override_until
                  ? 'Ручной режим действует до ' + formatTime(controls.window.override_until) + ', затем автоматика вернётся сама.'
                  : 'В режиме «Авто» окно открывается при критическом CO₂ и закрывается после минимального проветривания.'}
              </p>
            </article>
          </div>

          {controlError ? (
            <div className="control-feedback control-feedback-error" role="alert">
              <span>{controlError}</span>
              <button className="button-secondary" type="button" onClick={() => void loadData()}>Повторить</button>
            </div>
          ) : null}
          {controlNotice ? <div className="control-feedback" role="status">{controlNotice}</div> : null}
        </section>

        <section className="container dashboard-section" id="signals">
          <div className="section-toolbar">
            <div>
              <span className="eyebrow">01 / SENSOR ARRAY</span>
              <h2>Показатели комнаты</h2>
              <p>Текущие значения с локального набора датчиков.</p>
            </div>
            <span className="section-context"><span className="status-dot status-dot-success" /> room-01 · live</span>
          </div>

          <div className="metrics-grid">
            <MetricCard icon="temperature" label="Температура" value={formatValue(measurement?.indoor.temperature, 1)} unit="°C" note="внутри · сейчас" />
            <MetricCard icon="humidity" label="Влажность" value={formatValue(measurement?.indoor.humidity, 0)} unit="%" note="внутри · сейчас" />
            <MetricCard icon="pm25" label="PM2.5" value={formatValue(measurement?.indoor.pm25, 1)} unit="µg/m³" note="внутри · сейчас" />
            <MetricCard icon="window" label="Окно" value={windowLabel} note={measurement ? 'состояние · ' + formatTime(measurement.timestamp) : 'нет данных'} className="data-card-window" />
          </div>

          <div className="outdoor-context">
            <div className="outdoor-heading">
              <span className="section-context-icon"><Icon name="outdoor" /></span>
              <div>
                <span className="eyebrow">CONTEXT / OUTDOOR</span>
                <h3>Снаружи</h3>
              </div>
              <span>Параметры для принятия решения</span>
            </div>
            <div className="outdoor-grid">
              <MetricCard icon="temperature" label="Температура" value={formatValue(measurement?.outdoor.temperature, 1)} unit="°C" note="снаружи" className="data-card-compact" />
              <MetricCard icon="humidity" label="Влажность" value={formatValue(measurement?.outdoor.humidity, 0)} unit="%" note="снаружи" className="data-card-compact" />
              <MetricCard icon="pm25" label="PM2.5" value={formatValue(measurement?.outdoor.pm25, 1)} unit="µg/m³" note="снаружи" className="data-card-compact" />
            </div>
          </div>
        </section>

        <section className="container dashboard-section dashboard-history" id="history">
          <div className="section-toolbar history-toolbar">
            <div>
              <span className="eyebrow">02 / TIME SERIES</span>
              <h2>История измерений</h2>
              <p>Реальные ряды из PostgreSQL без сглаживания.</p>
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
            <ChartCard title="CO₂" caption="indoor / parts per million" footer="концентрация CO₂">
              <LineChart data={co2Series} unit="ppm" ariaLabel="График изменения концентрации CO2" />
            </ChartCard>
            <ChartCard title="Температура" caption="indoor / degrees celsius" footer="температура помещения">
              <LineChart data={temperatureSeries} unit="°C" ariaLabel="График температуры помещения" />
            </ChartCard>
            <ChartCard title="Состояние окна" caption="indoor / ventilation state" footer="серый — закрыто, зелёный — открыто" wide>
              <WindowChart data={history} ariaLabel="График состояния окна" />
            </ChartCard>
          </div>
        </section>

        <section className="container dashboard-section dashboard-note-section">
          <div className="dashboard-note">
            <span className="dashboard-note-icon"><Icon name="model" /></span>
            <div>
              <strong>Локальная установка</strong>
              <span>Источник можно заменить на физическую ESP32 без изменения JSON-контракта, API или этой панели.</span>
            </div>
            <span className="dashboard-note-code">REST / JSON · polling 30 с</span>
          </div>
        </section>
      </main>
    </div>
  )
}
