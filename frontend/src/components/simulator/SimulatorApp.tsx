'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { sendControlCommand } from '../../lib/client-api'
import { getCo2Level } from '../../lib/air-quality'
import { sensorQualityLabels } from '../../lib/telemetry'
import SceneCanvas from './SceneLoader'
import StandBootScreen from './StandBootScreen'
import { getSimulatorBootStage } from './boot-state'
import { useSceneFullscreen } from './useSceneFullscreen'
import { useSimulatorState } from './useSimulatorState'
import type { CutawayMode, SimulatorSnapshot, VisualizationMode } from './types'
import { getLoginHref } from '../../lib/auth-navigation'
import BrandLogo from '../BrandLogo'
import AccountMenu from '../auth/AccountMenu'
import { useAccessSession } from '../auth/AccessSessionProvider'

type Point = [number, number, number]
type DeviceDescription = { title: string; category: string; zone: string; interface: string; purpose: string }

const MODE_OPTIONS: Array<{ id: VisualizationMode; label: string; help: string }> = [
  { id: 'normal', label: 'Общий вид', help: 'Оборудование и стенд' },
  { id: 'airflow', label: 'Воздушный поток', help: 'Поток по фактическому расходу' },
  { id: 'sensors', label: 'Датчики', help: 'Узлы и измерительные точки' },
  { id: 'wiring', label: 'Проводка', help: 'Питание, земля и сигнальные линии' },
  { id: 'technical', label: 'Техника', help: 'Электроника и состояние оборудования' },
]

const DEVICE_INFO: Record<string, DeviceDescription> = {
  'sensor.scd41.indoor': { title: 'Sensirion SCD41', category: 'Датчик воздуха', zone: 'Внутренний узел', interface: 'I²C', purpose: 'Измерение CO₂, температуры и относительной влажности в комнате.' },
  'sensor.sps30.indoor': { title: 'Sensirion SPS30', category: 'Датчик частиц', zone: 'Внутренний узел', interface: 'UART', purpose: 'Измерение массовой концентрации частиц PM1.0–PM10 в комнате.' },
  'sensor.sht45.outdoor': { title: 'Sensirion SHT45', category: 'Датчик воздуха', zone: 'Наружный узел', interface: 'I²C', purpose: 'Измерение наружной температуры и относительной влажности в погодозащитном экране.' },
  'sensor.sps30.outdoor': { title: 'Sensirion SPS30', category: 'Датчик частиц', zone: 'Наружный узел', interface: 'UART', purpose: 'Измерение наружной концентрации частиц для оценки качества приточного воздуха.' },
  'device.esp32': { title: 'ESP32-DevKitC V4', category: 'Контроллер', zone: 'Шкаф управления', interface: 'I²C · UART · GPIO · Wi-Fi', purpose: 'Сбор данных датчиков, исполнение команд и передача телеметрии AirCheck.' },
  'window.assembly': { title: 'Оконная створка', category: 'Исполнительный узел', zone: 'Оконный узел', interface: 'Механическая связь с приводом', purpose: 'Положение створки следует подтверждённым данным выбранного источника.' },
  'window.actuator': { title: 'Линейный привод окна', category: 'Исполнительный узел', zone: 'Оконный узел', interface: '12 V DC · H-мост', purpose: 'Перемещает створку между крайними положениями. Команда проходит через backend.' },
  'window.reed_switch': { title: 'Геркон и магнит', category: 'Датчик положения', zone: 'Оконный узел', interface: 'GPIO', purpose: 'Сигнализирует о фактическом положении створки.' },
  'window.limit_open': { title: 'Концевик открытия', category: 'Датчик положения', zone: 'Оконный узел', interface: 'GPIO', purpose: 'Срабатывает при достижении полного открытия.' },
  'window.limit_close': { title: 'Концевик закрытия', category: 'Датчик положения', zone: 'Оконный узел', interface: 'GPIO', purpose: 'Срабатывает при достижении полного закрытия.' },
  'window.magnet': { title: 'Магнит створки', category: 'Датчик положения', zone: 'Оконный узел', interface: 'Магнитное сопряжение', purpose: 'Подвижная часть герконового датчика на створке.' },
  'fan.intake': { title: 'Приточный вентилятор', category: 'Вентиляция', zone: 'Внутренний узел', interface: '12 V DC · MOSFET', purpose: 'Подаёт наружный воздух через фильтр в помещение.' },
  'fan.exhaust': { title: 'Вытяжной вентилятор', category: 'Вентиляция', zone: 'Внутренний узел', interface: '12 V DC · MOSFET', purpose: 'Удаляет воздух из помещения наружу.' },
  'power.psu_12v': { title: 'Блок питания 12 V', category: 'Питание', zone: 'Шкаф управления', interface: '230 VAC → 12 V DC', purpose: 'Изолированное питание вентиляторов и оконного привода.' },
  'power.dc_dc': { title: 'Преобразователь DC/DC', category: 'Питание', zone: 'Шкаф управления', interface: '12 V → 5 V', purpose: 'Понижает напряжение для ESP32 и сенсорных узлов.' },
  'power.mosfet_module': { title: 'MOSFET-модуль', category: 'Управление нагрузкой', zone: 'Шкаф управления', interface: '2 канала · 12 V DC', purpose: 'Коммутирует питание приточного и вытяжного вентиляторов.' },
  'power.h_bridge': { title: 'H-мост', category: 'Управление нагрузкой', zone: 'Шкаф управления', interface: 'Реверс двигателя 12 V', purpose: 'Меняет полярность питания линейного привода окна.' },
  'power.fuses': { title: 'Предохранители', category: 'Защита', zone: 'Шкаф управления', interface: 'Силовые линии 12 V', purpose: 'Раздельная защита ветвей вентиляторов и оконного привода.' },
  'power.terminal_blocks': { title: 'Клеммники и шины', category: 'Коммутация', zone: 'Шкаф управления', interface: '+12 V · GND · 5 V · DATA', purpose: 'Распределение питания и подключение проводных линий.' },
}

const DEBUG_LABELS: Record<string, string> = {
  occupancy: 'Людей в комнате',
  outdoor_co2_ppm: 'Наружный CO₂',
  outdoor_pm25_ug_m3: 'Наружный PM2.5',
  outdoor_temperature_c: 'Наружная температура',
  outdoor_humidity_percent: 'Наружная влажность',
  indoor_pm25_generation_ug_min: 'Источник PM2.5 внутри',
  wind_speed_m_s: 'Скорость ветра',
  infiltration_ach: 'Инфильтрация',
  filter_efficiency: 'Эффективность фильтра',
  intake_airflow_m3_h: 'Расход притока',
  exhaust_airflow_m3_h: 'Расход вытяжки',
  sensor_noise_percent: 'Шум датчиков',
}

function fmt(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)
}

function co2ToneClass(snapshot: SimulatorSnapshot): string {
  const sensor = snapshot.sensors.find(item => item.id === 'indoor_climate')
  const level = sensor?.online && snapshot.settings ? getCo2Level(snapshot.indoor.co2_ppm, {
    normal: snapshot.settings.co2_normal_threshold, critical: snapshot.settings.co2_critical_threshold,
  }) : 'unknown'
  return level === 'normal' ? 'is-good' : level === 'elevated' ? 'is-warning' : level === 'critical' ? 'is-danger' : ''
}
function fanStateLabel(fan: SimulatorSnapshot['ventilation']['intake']): string {
  return fan.enabled === null ? 'нет подтверждения' : fan.enabled ? `${fmt(fan.rpm)} об/мин` : 'остановлен'
}
function signalLabel(value: boolean | null): string { return value === null ? 'нет данных' : value ? 'активен' : 'неактивен' }
function devicePoint(id: string, snapshot: SimulatorSnapshot): Point {
  const { layout, room_dimensions: d } = snapshot.simulation
  const reference = id.includes('outdoor') ? layout.outdoor_station_center : id.startsWith('sensor.') ? layout.indoor_sensor_center : layout.control_cabinet_center
  if (id.startsWith('window.')) return [0, d.window_sill_height_m + d.window_height_m / 2, d.depth_m / 2]
  if (id.startsWith('fan.')) return [(id === 'fan.intake' ? -1 : 1) * d.width_m * .37, d.height_m * .81, d.depth_m / 2]
  return [reference[0], reference[2], reference[1]]
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const result: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = typeof result === 'object' && result !== null && 'error' in result
      && typeof result.error === 'object' && result.error !== null && 'message' in result.error && typeof result.error.message === 'string'
      ? result.error.message
      : typeof result === 'object' && result !== null && 'detail' in result && typeof result.detail === 'string'
        ? result.detail
        : 'Сервер не выполнил действие'
    throw new Error(message)
  }
  return result as T
}

export default function SimulatorApp() {
  const { snapshot: reportedSnapshot, connected, error } = useSimulatorState()
  const snapshot = useMemo<SimulatorSnapshot | null>(() => {
    if (!reportedSnapshot || connected) return reportedSnapshot
    return { ...reportedSnapshot,
      sensors: reportedSnapshot.sensors.map(sensor => ({ ...sensor, online: false, quality: 'unknown', reason: 'Нет обновлений браузерного потока; показано последнее значение' })),
      window: { ...reportedSnapshot.window, motor_state: 'unknown', position_quality: reportedSnapshot.window.actual_position_percent === null ? 'unknown' : 'stale' },
      ventilation: { ...reportedSnapshot.ventilation, intake: { ...reportedSnapshot.ventilation.intake, enabled: null }, exhaust: { ...reportedSnapshot.ventilation.exhaust, enabled: null } },
    }
  }, [reportedSnapshot, connected])
  const realMode = snapshot?.mode === 'real'
  const { access, status: accessStatus } = useAccessSession()
  const [mode, setMode] = useState<VisualizationMode>('normal')
  const [cutaway, setCutaway] = useState<CutawayMode>('hidden')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null)
  const [cameraCommand, setCameraCommand] = useState<{ id: number; focus: Point | null }>({ id: 0, focus: null })
  const [panel, setPanel] = useState<'devices' | 'controls' | 'tools'>('devices')
  const [notice, setNotice] = useState<string | null>(null)
  const [rendererReady, setRendererReady] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)
  const [sceneError, setSceneError] = useState<string | null>(null)
  const [sceneAttempt, setSceneAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [touchCameraMode, setTouchCameraMode] = useState(false)
  const [coarsePointer, setCoarsePointer] = useState(false)
  const [mobileMetricsExpanded, setMobileMetricsExpanded] = useState(false)
  const [mobileDevicePanelOpen, setMobileDevicePanelOpen] = useState(false)
  const devicePanelToggleRef = useRef<HTMLButtonElement>(null)
  const fullscreenDevicesRef = useRef<HTMLButtonElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const fullscreenToggleRef = useRef<HTMLButtonElement>(null)
  const fullscreen = useSceneFullscreen(workspaceRef, fullscreenToggleRef)
  const isOperator = accessStatus === 'ready' && (access?.role === 'operator' || access?.role === 'owner')
  const bootStage = sceneError ? 'error' : getSimulatorBootStage(Boolean(snapshot), rendererReady, sceneReady)
  const markRendererReady = useCallback(() => setRendererReady(true), [])
  const markSceneReady = useCallback(() => setSceneReady(true), [])
  const reportSceneError = useCallback((message: string) => setSceneError(message), [])
  const resetSceneStartup = useCallback(() => {
    setRendererReady(false)
    setSceneReady(false)
    setSceneError(null)
  }, [])
  const retryScene = useCallback(() => {
    resetSceneStartup()
    setSceneAttempt((attempt) => attempt + 1)
  }, [resetSceneStartup])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const pointerQuery = window.matchMedia('(pointer: coarse)')
    const syncPointerMode = () => setCoarsePointer(pointerQuery.matches)
    syncPointerMode()
    pointerQuery.addEventListener('change', syncPointerMode)
    return () => pointerQuery.removeEventListener('change', syncPointerMode)
  }, [])

  const callAction = useCallback(async (action: string, payload: Record<string, string | number | boolean> = {}) => {
    if (realMode) { setNotice('Испытательные сценарии доступны в режиме симуляции.'); return }
    setBusy(true)
    setNotice(null)
    try {
      await requestJson('/api/simulator/actions', { method: 'POST', body: JSON.stringify({ action, payload }) })
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Не удалось выполнить действие')
    } finally {
      setBusy(false)
    }
  }, [realMode])

  const sendDeviceCommand = useCallback(async (target: 'window' | 'intake' | 'exhaust', action: 'open' | 'close' | 'on' | 'off') => {
    if (!isOperator) return
    setBusy(true)
    setNotice(null)
    try {
      await sendControlCommand(target, action, snapshot?.device_id)
      setNotice('Команда добавлена в очередь AirCheck. Сцена изменится после фактического исполнения устройством.')
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Не удалось отправить команду')
    } finally {
      setBusy(false)
    }
  }, [isOperator, snapshot?.device_id])

  const pick = useCallback((id: string, point: Point) => {
    setSelectedId(id)
    setSelectedPoint(point)
    setPanel('devices')
    setMobileDevicePanelOpen(true)
    setCameraCommand((previous) => ({ id: previous.id + 1, focus: point }))
  }, [])

  const resetCamera = useCallback(() => {
    setSelectedId(null)
    setSelectedPoint(null)
    setMobileDevicePanelOpen(false)
    setMobileMetricsExpanded(false)
    setCameraCommand((previous) => ({ id: previous.id + 1, focus: null }))
  }, [])

  const closeMobileDevicePanel = useCallback(() => {
    setMobileDevicePanelOpen(false)
    ;(fullscreen.expanded ? fullscreenDevicesRef : devicePanelToggleRef).current?.focus({ preventScroll: true })
  }, [fullscreen.expanded])

  const selectedInfo = selectedId ? DEVICE_INFO[selectedId] : null
  const selectedSensor = useMemo(() => {
    if (!selectedId) return undefined
    const id = selectedId === 'sensor.scd41.indoor'
      ? 'indoor_climate'
      : selectedId === 'sensor.sps30.indoor'
        ? 'indoor_particles'
        : selectedId === 'sensor.sht45.outdoor'
          ? 'outdoor_climate'
          : selectedId === 'sensor.sps30.outdoor'
            ? 'outdoor_particles'
            : null
    return id ? snapshot?.sensors.find((sensor) => sensor.id === id) : undefined
  }, [selectedId, snapshot])

  if (!snapshot) {
    return <StandBootScreen stage="snapshot" errorMessage={error ?? undefined} />
  }

  const airflow = snapshot.airflow
  const windowMoving = snapshot.window.motor_state === 'opening' || snapshot.window.motor_state === 'closing'

  return (
    <>
    <main className="simulator-page" aria-hidden={bootStage ? true : undefined} inert={bootStage ? true : undefined}>
      <header className="simulator-topbar">
        <a href="/simulator" className="simulator-brand">
          <BrandLogo className="simulator-brand-logo" width={36} height={27} priority />
          <span>AirCheck</span>
          <span className="simulator-brand-subtitle">3D-стенд</span>
        </a>
        <nav className="simulator-primary-nav" aria-label="Основная навигация"><a href="/">Панель</a><a href="/simulator" aria-current="page">3D-стенд</a></nav>
        <div className="simulator-topbar-center">
          <span className={'sim-status-pill ' + (connected ? 'is-online' : 'is-offline')}><i />{connected ? 'Поток подключён' : 'Нет обновлений'}</span>
          <span className={'sim-status-pill ' + (connected && snapshot.backend.online ? 'is-online' : 'is-warning')}><i />{connected ? snapshot.backend.online ? 'Сервер доступен' : 'Нет связи с сервером данных' : 'Нет свежего статуса сервера'}</span>
          <span className="sim-device-id">Узел <strong>{snapshot.device_id}</strong></span>
        </div>
        <div className="simulator-topbar-actions">
          <AccountMenu variant="simulator" />
          <a className="sim-button sim-button-primary" href="/">Панель AirCheck <span aria-hidden="true">↗</span></a>
          <button className="sim-mobile-menu-toggle" type="button" aria-label={mobileMenuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}><span aria-hidden="true">☰</span></button>
        </div>
      </header>

      <div className={'simulator-main-nav ' + (mobileMenuOpen ? 'is-open' : '')}>
        <div className="simulator-nav-title"><h1>Цифровой стенд</h1><p className="sim-muted">{realMode ? 'Реальная система · ESP32' : 'Симуляция · испытательный режим'}</p></div>
        <nav className="simulator-nav-tabs" aria-label="Разделы цифрового стенда">
          {(['devices', 'controls', 'tools'] as const).map((item) => <button key={item} type="button" aria-pressed={panel === item} className={panel === item ? 'is-active' : ''} onClick={() => { setPanel(item); setMobileDevicePanelOpen(item === 'devices'); setMobileMenuOpen(false) }}>{item === 'devices' ? 'Устройства' : item === 'controls' ? 'Сценарии' : realMode ? 'Диагностика' : 'Инструменты'}</button>)}
        </nav>
      </div>

      <section id="simulator-workspace" ref={workspaceRef} className={'simulator-workspace' + (fullscreen.expanded ? ' is-expanded' : '')} role={fullscreen.expanded ? 'dialog' : undefined} aria-modal={fullscreen.expanded ? true : undefined} aria-label="Рабочая область 3D-стенда">
        <div className="simulator-stage-column">
          <div className="simulator-stage-frame">
            <div className="simulator-stage-topline">
              <div><span className="eyebrow">{realMode ? 'Реальная система' : fullscreen.expanded ? 'Симуляция' : snapshot.simulation.scenario}</span><strong>{realMode ? 'Одна ESP32 · показания устройств' : <>{snapshot.simulation.room_volume_m3.toFixed(1)} м³ · {snapshot.simulation.occupancy} {snapshot.simulation.occupancy === 1 ? 'человек' : 'чел.'}</>}</strong></div>
              <div className="sim-stage-quick-actions">
                <label className="sim-compact-select"><span className="sr-only">Режим стены</span><select value={cutaway} onChange={(event) => setCutaway(event.target.value as CutawayMode)}><option value="visible">Стена: видимая</option><option value="transparent">Стена: прозрачная</option><option value="hidden">Стена: скрыта</option></select></label>
                {coarsePointer ? (
                  <button
                    className={'sim-icon-button simulator-touch-camera-toggle' + (touchCameraMode ? ' is-active' : '')}
                    type="button"
                    aria-label={touchCameraMode ? 'Выключить управление камерой' : 'Включить управление камерой'}
                    aria-pressed={touchCameraMode}
                    onClick={() => setTouchCameraMode((enabled) => !enabled)}
                  >
                    Камера
                  </button>
                ) : null}
                <button className="sim-icon-button" type="button" onClick={resetCamera} aria-label="Сбросить камеру" title="Сброс камеры">⌖</button>
                <button className="sim-icon-button" type="button" onClick={() => selectedPoint && setCameraCommand((previous) => ({ id: previous.id + 1, focus: selectedPoint }))} disabled={!selectedPoint} aria-label="Сфокусировать камеру на выбранном устройстве" title="Фокус на выбранном устройстве">◎</button>
                {fullscreen.expanded ? <button ref={fullscreenDevicesRef} className="sim-icon-button simulator-fullscreen-devices" type="button" aria-expanded={panel === 'devices' && mobileDevicePanelOpen} aria-controls="simulator-device-panel" onClick={() => { setPanel('devices'); setMobileDevicePanelOpen(open => panel === 'devices' ? !open : true) }}>Устройства</button> : null}
                <button ref={fullscreenToggleRef} className={'sim-icon-button simulator-fullscreen-toggle' + (fullscreen.expanded ? ' is-active' : '')} type="button" onClick={() => void fullscreen.toggle()} disabled={fullscreen.pending} aria-busy={fullscreen.pending} aria-pressed={fullscreen.expanded} aria-controls="simulator-workspace" aria-label={fullscreen.expanded ? 'Выйти из полноэкранного режима' : 'Развернуть 3D-стенд на весь экран'} title={fullscreen.expanded ? 'Выйти из полноэкранного режима · Esc' : 'Развернуть 3D-стенд на весь экран'}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={fullscreen.expanded ? 'M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5' : 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5'} /></svg>
                  {fullscreen.expanded ? <span>Свернуть стенд</span> : null}
                </button>
              </div>
            </div>
            {fullscreen.error ? <p className="control-feedback simulator-fullscreen-notice" role="alert">{fullscreen.error}</p> : null}
            <div className={'simulator-stage-hud' + (mobileMetricsExpanded ? ' is-expanded' : '')}>
              <div className="sim-hud-card sim-hud-co2"><span>CO₂ · ВНУТРИ</span><strong>{fmt(snapshot.indoor.co2_ppm)} <small>ppm</small></strong><i className={co2ToneClass(snapshot)} /></div>
              <button className="sim-hud-mobile-toggle" type="button" aria-expanded={mobileMetricsExpanded} aria-controls="simulator-air-metrics" onClick={() => setMobileMetricsExpanded((expanded) => !expanded)}>{mobileMetricsExpanded ? 'Скрыть показатели' : 'Показатели воздуха'}</button>
              <div className="sim-hud-secondary" id="simulator-air-metrics">
                <div className="sim-hud-card"><span>PM2.5 · ВНУТРИ</span><strong>{fmt(snapshot.indoor.pm25_ug_m3, 1)} <small>мкг/м³</small></strong></div>
                <div className="sim-hud-card"><span>ТЕМПЕРАТУРА · ВНУТРИ</span><strong>{fmt(snapshot.indoor.temperature_c, 1)} <small>°C</small></strong></div>
                <div className="sim-hud-card"><span>ВЛАЖНОСТЬ · ВНУТРИ</span><strong>{fmt(snapshot.indoor.humidity_percent)} <small>%</small></strong></div>
                <div className="sim-hud-card sim-hud-forecast"><span>ПРОГНОЗ AIRCHECK{snapshot.backend.forecast ? ` · +${snapshot.backend.forecast.horizon_minutes ?? 15} МИН` : ''}</span><strong>{snapshot.backend.forecast ? `${fmt(snapshot.backend.forecast.predicted_co2 ?? snapshot.backend.forecast.predicted_co2_15min)} ppm` : 'Ожидание ML'}</strong></div>
              </div>
            </div>
            <SceneCanvas key={sceneAttempt} snapshot={snapshot} mode={mode} cutaway={cutaway} selectedId={selectedId} cameraCommand={cameraCommand} touchCameraMode={touchCameraMode} touchDevice={coarsePointer} onSelect={pick} onClearSelection={() => { setSelectedId(null); setSelectedPoint(null); setMobileDevicePanelOpen(false) }} onRendererReady={markRendererReady} onFirstFrame={markSceneReady} onSceneRestart={resetSceneStartup} onSceneError={reportSceneError} />
            <div className="simulator-stage-footer">
              <div className="sim-stage-state"><span className={windowMoving ? 'sim-live-indicator is-moving' : 'sim-live-indicator'} /><strong>Окно</strong> {snapshot.window.motor_state === 'opening' ? 'открывается' : snapshot.window.motor_state === 'closing' ? 'закрывается' : snapshot.window.motor_state === 'fault' ? 'ошибка' : snapshot.window.motor_state === 'unknown' || snapshot.window.actual_position_percent === null ? 'нет подтверждения' : `${fmt(snapshot.window.actual_position_percent)}%`}<span className="sim-state-divider" /><strong>Приток</strong> {fanStateLabel(snapshot.ventilation.intake)}<span className="sim-state-divider" /><strong>Вытяжка</strong> {fanStateLabel(snapshot.ventilation.exhaust)}</div>
              <div className="sim-flow-caption">{realMode ? 'Расход и энергия не измеряются' : <>Оценка модели: <strong>{fmt(airflow.total_effective_m3_h)} м³/ч</strong> · {fmt(airflow.air_changes_per_hour, 2)} ACH</>}</div>
            </div>
          </div>

          <button
            ref={devicePanelToggleRef}
            className="simulator-mobile-device-toggle"
            type="button"
            aria-expanded={mobileDevicePanelOpen}
            aria-controls="simulator-device-panel"
            onClick={() => setMobileDevicePanelOpen((open) => !open)}
          >
            <span>{selectedInfo ? 'Выбрано устройство' : 'Устройства стенда'}</span>
            <strong>{selectedInfo?.title ?? 'Выберите объект на сцене'}</strong>
            <span className="simulator-mobile-device-toggle-action">{mobileDevicePanelOpen ? 'Свернуть' : 'Показать'}</span>
          </button>

          <div className="simulator-view-toolbar">
            <div className="sim-view-switcher" role="group" aria-label="Режим отображения сцены">
              {MODE_OPTIONS.map((option) => <button key={option.id} type="button" aria-pressed={mode === option.id} className={mode === option.id ? 'is-active' : ''} onClick={() => setMode(option.id)} title={option.help}>{option.label}</button>)}
            </div>
            <div className="simulator-mobile-camera-control">
              <p>{touchCameraMode ? 'Перетаскивайте одним пальцем для вращения; двумя пальцами — масштаб и сдвиг. Короткое касание выбирает объект.' : 'Коснитесь объекта, чтобы выбрать его. Для жестов камеры включите режим управления; страницу можно прокручивать за пределами сцены.'}</p>
            </div>
            <div className="sim-camera-hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> движение <kbd>Q</kbd><kbd>E</kbd> высота <kbd>Shift</kbd> быстрее · правая кнопка вращает</div>
          </div>
        </div>

        <aside
          id="simulator-device-panel"
          className={'simulator-sidebar' + (panel === 'devices' ? ' is-device-panel' : '') + (panel === 'devices' && mobileDevicePanelOpen ? ' is-mobile-sheet-open' : '')}
          aria-label={panel === 'devices' ? 'Информация об устройстве' : panel === 'controls' ? 'Сценарии симуляции' : 'Инструменты стенда'}
        >
          {panel === 'devices' ? <label className="sim-tool-group"><span className="sim-tool-title">Выбрать устройство</span><select className="form-select" aria-label="Устройство стенда" value={selectedId ?? ''} onChange={event => { const id = event.target.value; setSelectedId(id || null); setSelectedPoint(id ? devicePoint(id, snapshot) : null); setPanel('devices'); setMobileDevicePanelOpen(true) }}><option value="">Все устройства</option>{Object.entries(DEVICE_INFO).map(([id, info]) => <option key={id} value={id}>{info.title} · {info.zone}</option>)}</select></label> : null}
          {panel === 'devices' && mobileDevicePanelOpen ? <button className="simulator-mobile-device-close" type="button" onClick={closeMobileDevicePanel}>Закрыть сведения об устройстве</button> : null}
          {panel === 'devices' ? (
            <DevicePanel snapshot={snapshot} selectedId={selectedId} info={selectedInfo} sensor={selectedSensor} isOperator={isOperator} busy={busy} onCommand={sendDeviceCommand} />
          ) : panel === 'controls' ? (
            <ScenarioPanel snapshot={snapshot} isOperator={isOperator} busy={busy} onAction={callAction} />
          ) : (
            <ToolsPanel snapshot={snapshot} isOperator={isOperator} busy={busy} onAction={callAction} onMode={setMode} onCutaway={setCutaway} />
          )}
          <div className="simulator-sidebar-bottom">
            {notice ? <p className="sim-feedback" role="status">{notice}</p> : null}
            <div className="sim-outdoor-strip"><span><i className="sim-outdoor-icon">↗</i><span>Наружный воздух</span></span><strong>{fmt(snapshot.outdoor.temperature_c, 1)} °C <b>·</b> {fmt(snapshot.outdoor.humidity_percent)}% RH</strong><small>PM2.5 {fmt(snapshot.outdoor.pm25_ug_m3, 1)} мкг/м³</small></div>
            <div className="simulator-footnote"><span>{realMode ? 'ESP32' : 'SIM'} · {connected ? 'поток активен' : 'последний снимок'}</span><span>{new Date(snapshot.timestamp).toLocaleTimeString('ru-RU')}</span></div>
          </div>
        </aside>
      </section>
    </main>
    {bootStage ? <StandBootScreen stage={bootStage} errorMessage={sceneError ?? undefined} onRetry={bootStage === 'error' ? retryScene : undefined} /> : null}
    </>
  )
}

function PanelHeading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: string; children?: ReactNode }) {
  return <div className="sim-panel-heading"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{description ? <p>{description}</p> : null}{children}</div>
}

function DevicePanel({
  snapshot,
  selectedId,
  info,
  sensor,
  isOperator,
  busy,
  onCommand,
}: {
  snapshot: SimulatorSnapshot
  selectedId: string | null
  info: DeviceDescription | null
  sensor: SimulatorSnapshot['sensors'][number] | undefined
  isOperator: boolean
  busy: boolean
  onCommand: (target: 'window' | 'intake' | 'exhaust', action: 'open' | 'close' | 'on' | 'off') => Promise<void>
}) {
  const stateRows: Array<[string, string]> = []
  if (selectedId === 'window.assembly' || selectedId === 'window.actuator') stateRows.push(['Положение', `${fmt(snapshot.window.actual_position_percent)}% / цель ${fmt(snapshot.window.target_position_percent)}%`], ['Привод', snapshot.window.motor_state.toUpperCase()], ['Геркон', snapshot.window.reed_switch === null ? 'Нет данных' : snapshot.window.reed_switch ? 'Активен' : 'Неактивен'], ['Концевики', `ОТКР ${signalLabel(snapshot.window.open_limit_switch)} · ЗАКР ${signalLabel(snapshot.window.close_limit_switch)}`])
  if (selectedId === 'window.reed_switch' || selectedId === 'window.limit_open' || selectedId === 'window.limit_close') stateRows.push(['Сигнал геркона', signalLabel(snapshot.window.reed_switch)], ['Концевик открытия', signalLabel(snapshot.window.open_limit_switch)], ['Концевик закрытия', signalLabel(snapshot.window.close_limit_switch)])
  if (selectedId === 'fan.intake' || selectedId === 'fan.exhaust') {
    const fan = selectedId === 'fan.intake' ? snapshot.ventilation.intake : snapshot.ventilation.exhaust
    stateRows.push(['Состояние', fan.enabled === null ? 'Нет подтверждения' : fan.enabled ? 'Вращение подтверждено' : 'Вращение не обнаружено'], ['Обороты', `${fmt(fan.rpm)} об/мин`], ['Расход', `${fmt(fan.airflow_m3_h)} м³/ч`], ['Фильтр', snapshot.ventilation.filter_enabled === null ? 'Нет измерения' : `${snapshot.ventilation.filter_enabled ? 'установлен' : 'не используется'} · ${fmt(snapshot.ventilation.filter_efficiency === null ? null : snapshot.ventilation.filter_efficiency * 100)}%`])
  }
  if (selectedId?.startsWith('power.')) stateRows.push([snapshot.mode === 'real' ? 'Обратная связь питания' : 'Виртуальное состояние', snapshot.mode === 'real' ? 'Не измеряется; показана проектная схема' : 'Силовой узел стенда'], ['Система питания', '12 V DC → DC/DC 5 V'], ['Связь с узлом', snapshot.backend.online ? 'Backend online' : 'Локальный режим'])
  if (selectedId === 'device.esp32') stateRows.push(['Связь ESP32–сервер', snapshot.connection ? snapshot.connection.controller === 'online' ? 'Есть свежий отчёт' : snapshot.connection.controller === 'stale' ? 'Отчёт устарел' : 'Нет свежего отчёта' : snapshot.backend.online ? 'Виртуальный узел на связи' : 'Нет связи'], ['Device ID', snapshot.device_id], ['Команды в очереди', String(snapshot.backend.pending_commands)])

  const readings = sensor?.readings ?? {}
  const readingEntries = Object.entries(readings).filter(([, value]) => value !== null)
  return (
    <>
      <div className="sim-sidebar-primary">
        <PanelHeading eyebrow="Узел стенда" title={info?.title ?? 'Выберите устройство'} description={info?.purpose ?? 'Нажмите на оборудование в 3D-сцене, чтобы открыть назначение и текущие показания.'}>
          {selectedId ? <span className="sim-device-chip"><i className={sensor?.online === false ? 'is-offline' : ''} />{info?.category ?? 'Оборудование'} · {selectedId}</span> : null}
        </PanelHeading>
        {info ? <dl className="sim-device-meta"><div><dt>Размещение</dt><dd>{info.zone}</dd></div><div><dt>Интерфейс</dt><dd>{info.interface}</dd></div><div><dt>Доступ</dt><dd>{isOperator ? 'Управление доступно' : 'Только просмотр'}</dd></div></dl> : null}
        {sensor ? (
          <div className="sim-reading-group"><div className="sim-reading-group-title"><span>{sensor.online ? 'Текущие показания' : 'Последние полученные показания'}</span><span className={'sim-device-online ' + (sensor.online ? 'is-online' : 'is-offline')}>{sensor.reason ?? (sensor.quality ? sensorQualityLabels[sensor.quality] : sensor.online ? 'Данные получены' : 'Нет достоверных данных')}</span></div>{sensor.last_good_at ? <p className="sim-muted">Измерено: {new Date(sensor.last_good_at).toLocaleString('ru-RU')}</p> : null}
            {readingEntries.length ? readingEntries.map(([key, value]) => <div className="sim-reading-row" key={key}><span>{key === 'co2' ? 'CO₂' : key === 'pm25' ? 'PM2.5' : key === 'temperature' ? 'Температура' : key === 'humidity' ? 'Влажность' : key}</span><strong>{fmt(value, key === 'pm25' || key === 'temperature' ? 1 : 0)} <small>{key === 'co2' ? 'ppm' : key === 'pm25' ? 'мкг/м³' : key === 'temperature' ? '°C' : key === 'humidity' ? '%' : ''}</small></strong></div>) : <p className="sim-muted">Датчик недоступен или ещё не передал показания.</p>}
          </div>
        ) : null}
        {info && stateRows.length ? <div className="sim-reading-group"><div className="sim-reading-group-title"><span>Состояние узла</span><span className="sim-live-label">СОСТОЯНИЕ</span></div>{stateRows.map(([label, value]) => <div className="sim-reading-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div> : null}
      </div>
      <div className="sim-sidebar-control-block">
        <div className="sim-control-block-heading"><span>Команды устройствам</span><small>через очередь AirCheck</small></div>
        {!isOperator ? <div className="sim-readonly-note">Для отправки команд войдите с правами оператора. <a href={getLoginHref('/simulator')}>Войти →</a></div> : selectedId === 'window.assembly' || selectedId === 'window.actuator' ? <div className="sim-command-buttons"><button type="button" className="sim-button sim-button-primary" disabled={busy || windowMoving(snapshot)} onClick={() => void onCommand('window', 'open')}>Открыть окно</button><button type="button" className="sim-button" disabled={busy || windowClosed(snapshot)} onClick={() => void onCommand('window', 'close')}>Закрыть</button></div> : selectedId === 'fan.intake' || selectedId === 'fan.exhaust' ? <div className="sim-command-buttons"><button type="button" className="sim-button sim-button-primary" disabled={busy} onClick={() => void onCommand(selectedId === 'fan.intake' ? 'intake' : 'exhaust', selectedId === 'fan.intake' ? snapshot.ventilation.intake.enabled ? 'off' : 'on' : snapshot.ventilation.exhaust.enabled ? 'off' : 'on')}>{(selectedId === 'fan.intake' ? snapshot.ventilation.intake.enabled : snapshot.ventilation.exhaust.enabled) ? 'Выключить' : 'Включить'}</button></div> : <p className="sim-readonly-note">Выберите окно или вентилятор, чтобы отправить команду. Сцена обновится после подтверждения устройства.</p>}
      </div>
    </>
  )
}

function windowMoving(snapshot: SimulatorSnapshot) { return snapshot.window.motor_state === 'opening' || snapshot.window.motor_state === 'closing' }
function windowClosed(snapshot: SimulatorSnapshot) { return snapshot.window.actual_position_percent !== null && snapshot.window.actual_position_percent <= 0.01 || snapshot.window.motor_state === 'closing' }

function ScenarioPanel({ snapshot, isOperator, busy, onAction }: { snapshot: SimulatorSnapshot; isOperator: boolean; busy: boolean; onAction: (action: string, payload?: Record<string, string | number | boolean>) => Promise<void> }) {
  if (snapshot.mode === 'real') return <div className="sim-sidebar-primary"><PanelHeading eyebrow="Источник данных" title="Подключена ESP32" description="Сцена показывает телеметрию физической системы. Испытательные сценарии доступны при запуске системы в режиме симуляции." /><p className="sim-muted">Команды реальным механизмам находятся на вкладке «Устройства».</p></div>
  return (
    <div className="sim-sidebar-primary">
      <PanelHeading eyebrow="Среда помещения" title="Сценарии демонстрации" description="Готовые исходные условия загружаются из конфигурации Simulation Core. Формулы и автоматика остаются в Python/backend." />
      <div className="sim-scenario-current"><span>Текущий сценарий</span><strong>{snapshot.simulation.scenario}</strong><small>{snapshot.simulation.occupancy} {snapshot.simulation.occupancy === 1 ? 'человек' : 'чел.'} · скорость {fmt(snapshot.simulation.speed)}×</small></div>
      <div className="sim-scenario-list">{snapshot.simulation.scenarios.map((scenario, index) => <button key={scenario.id} type="button" aria-pressed={scenario.title === snapshot.simulation.scenario} disabled={!isOperator || busy} className={scenario.title === snapshot.simulation.scenario ? 'is-selected' : ''} onClick={() => void onAction('scenario', { scenario_id: scenario.id })}><span className="sim-scenario-number">{String(index + 1).padStart(2, '0')}</span><span>{scenario.title}</span><span aria-hidden="true">→</span></button>)}</div>
      <div className="sim-auto-demo-card"><div><span className="eyebrow">Сквозная демонстрация</span><strong>{snapshot.demo.active ? snapshot.demo.phase : 'Автоматический показ'}</strong><p>{snapshot.demo.detail}</p></div><button className="sim-button sim-button-primary" type="button" disabled={!isOperator || busy || snapshot.demo.active} onClick={() => void onAction('demo_start')}>{snapshot.demo.active ? 'Идёт показ' : 'Запустить'}</button>{snapshot.demo.active && isOperator ? <button className="sim-button" type="button" disabled={busy} onClick={() => void onAction('demo_stop')}>Остановить</button> : null}</div>
      {!isOperator ? <p className="sim-readonly-note">Сценарии и demo доступны оператору. <a href={getLoginHref('/simulator')}>Войти →</a></p> : null}
    </div>
  )
}

function ToolsPanel({ snapshot, isOperator, busy, onAction, onMode, onCutaway }: { snapshot: SimulatorSnapshot; isOperator: boolean; busy: boolean; onAction: (action: string, payload?: Record<string, string | number | boolean>) => Promise<void>; onMode: (mode: VisualizationMode) => void; onCutaway: (mode: CutawayMode) => void }) {
  const real = snapshot.mode === 'real'
  return (
    <div className="sim-sidebar-primary">
      <PanelHeading eyebrow="Представление сцены" title={real ? 'Диагностика системы' : 'Инструменты стенда'} description={real ? 'Состояние контроллера и слои отображения.' : 'Управление камерой, слоями оборудования и тестовыми параметрами симуляции.'} />
      {real ? <div className="sim-reading-group"><p className="sim-muted">Последний приём: {snapshot.connection?.received_at ? new Date(snapshot.connection.received_at).toLocaleString('ru-RU') : 'нет данных'}</p>{snapshot.telemetry ? <dl className="sim-device-meta"><div><dt>Прошивка</dt><dd>{snapshot.telemetry.frame.controller.firmware_version}</dd></div><div><dt>Uptime</dt><dd>{fmt(snapshot.telemetry.frame.controller.uptime_ms / 1000)} с</dd></div><div><dt>Свободная память</dt><dd>{fmt(snapshot.telemetry.frame.controller.free_heap)} байт</dd></div><div><dt>Минимум памяти</dt><dd>{fmt(snapshot.telemetry.frame.controller.minimum_free_heap)} байт</dd></div><div><dt>Пакет / очередь</dt><dd>{snapshot.telemetry.frame.sequence} / {snapshot.telemetry.frame.controller.queue_depth}</dd></div>{Object.entries(snapshot.telemetry.frame.controller.stack_watermarks ?? {}).map(([task, bytes]) => <div key={task}><dt>Стек {task}: минимум свободного</dt><dd>{fmt(bytes)} байт</dd></div>)}</dl> : null}{snapshot.warnings?.map(message => <p className="sim-readonly-note" key={message}>{message}</p>)}</div> : <div className="sim-tool-group"><span className="sim-tool-title">Скорость симуляции</span><div className="sim-speed-options">{snapshot.simulation.supported_speeds.map((speed) => <button key={speed} type="button" disabled={!isOperator || busy} className={snapshot.simulation.speed === speed ? 'is-active' : ''} onClick={() => void onAction('speed', { speed })}>{speed === 0 ? 'Пауза' : `${fmt(speed)}×`}</button>)}</div></div>}
      <div className="sim-tool-group"><span className="sim-tool-title">Слои отображения</span><div className="sim-tool-choice-list">{MODE_OPTIONS.map((option) => <button key={option.id} type="button" className={undefined} onClick={() => onMode(option.id)}><span>{option.label}</span><small>{option.help}</small></button>)}</div></div>
      <div className="sim-tool-group"><span className="sim-tool-title">Стена</span><div className="sim-cutaway-options">{(['visible', 'transparent', 'hidden'] as const).map((value) => <button key={value} type="button" onClick={() => onCutaway(value)}>{value === 'visible' ? 'Видимая' : value === 'transparent' ? 'Прозрачная' : 'Скрыта'}</button>)}</div></div>
      {!real ? <details className="sim-debug-panel" open={false}>
        <summary><span><b>Developer / Debug</b><small>Изменение условий среды</small></span><i>⌄</i></summary>
        {!isOperator ? <p className="sim-readonly-note">Настройки доступны только оператору.</p> : <div className="sim-debug-fields">{Object.entries(snapshot.simulation.developer_parameters).map(([key, parameter]) => {
          const value = snapshot.simulation.developer_values[key]
          if (value === undefined) return null
          return <label className="sim-debug-slider" key={key}><span>{DEBUG_LABELS[key] ?? key}<strong>{fmt(value, parameter.integral ? 0 : 2)}{key.endsWith('percent') || key === 'filter_efficiency' ? '%' : key.endsWith('_c') ? ' °C' : key.endsWith('_m3_h') ? ' м³/ч' : ''}</strong></span><input type="range" min={parameter.minimum} max={parameter.maximum} step={parameter.step} defaultValue={value} disabled={busy} onChange={(event) => { const input = event.currentTarget; const output = input.parentElement?.querySelector('strong'); if (output) output.textContent = `${fmt(Number(input.value), parameter.integral ? 0 : 2)}${key.endsWith('percent') || key === 'filter_efficiency' ? '%' : key.endsWith('_c') ? ' °C' : key.endsWith('_m3_h') ? ' м³/ч' : ''}` }} onPointerUp={(event) => void onAction('debug_set', { key, value: Number(event.currentTarget.value) })} onKeyUp={(event) => void onAction('debug_set', { key, value: Number(event.currentTarget.value) })} /></label>
        })}</div>}
      </details> : null}
      {snapshot.backend.message ? <div className="sim-backend-message"><span className={snapshot.backend.online ? 'is-online' : 'is-offline'} />{snapshot.backend.message}</div> : null}
    </div>
  )
}
