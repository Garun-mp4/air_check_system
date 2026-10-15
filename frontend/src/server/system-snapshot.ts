import reference from '../lib/stand-reference.json'
import type { FanState, SystemSnapshot } from '../lib/system-state'
import { assessSensor, controllerWarnings, sensorChannels, windowFeedbackValid, type SensorId, type StoredTelemetry } from '../lib/telemetry'
import type { ControlStatus, DashboardResult, NodeSettings } from './types'

function point(values: number[]): [number, number, number] {
  if (values.length !== 3 || values.some(value => !Number.isFinite(value))) throw new Error('Invalid static stand reference')
  return [values[0], values[1], values[2]]
}

const sensorInfo: Record<SensorId, { model: string; zone: 'indoor' | 'outdoor'; interface: string }> = {
  indoor_climate: { model: 'Sensirion SCD41', zone: 'indoor', interface: 'I²C' },
  indoor_particles: { model: 'Sensirion SPS30', zone: 'indoor', interface: 'UART' },
  outdoor_climate: { model: 'Sensirion SHT45', zone: 'outdoor', interface: 'I²C' },
  outdoor_particles: { model: 'Sensirion SPS30', zone: 'outdoor', interface: 'UART' },
}
export function snapshotSettings(settings: NodeSettings): NonNullable<SystemSnapshot['settings']> {
  return { co2_normal_threshold: settings.co2NormalThreshold, co2_critical_threshold: settings.co2CriticalThreshold, pm25_good_limit: settings.pm25GoodLimit, pm25_elevated_limit: settings.pm25ElevatedLimit, updated_at: settings.updatedAt.toISOString() }
}

export function realSystemSnapshot(record: StoredTelemetry | null, controls: ControlStatus, settings: NodeSettings, dashboard: DashboardResult, now = new Date()): SystemSnapshot {
  const frame = record?.frame
  if (frame && frame.data_source !== 'real') throw new Error('Virtual telemetry cannot be shown as real')
  const stateAge = frame?.sampled_at ? now.getTime() - Date.parse(frame.sampled_at) : Number.POSITIVE_INFINITY
  const connection = controls.connectionStatus
  const stateFresh = connection === 'online' && stateAge >= -5000 && stateAge <= 90000 && frame?.controller.clock_synced === true
  const sensors = (Object.keys(sensorChannels) as SensorId[]).map(id => {
    const sensor = frame?.sensors.find(item => item.sensor_id === id)
    const assessed = sensor ? assessSensor(sensor, now.getTime(), frame?.controller.clock_synced) : null
    return { id, ...sensorInfo[id], measurements: [...sensorChannels[id]], online: assessed?.usable ?? false,
      quality: assessed?.quality ?? 'unknown', reason: assessed?.message ?? 'Нет подтверждённых данных',
      last_good_at: sensor?.last_good_at ?? null, age_ms: assessed?.ageMs ?? null,
      readings: Object.fromEntries(sensorChannels[id].map(key => [key, sensor?.values[key] ?? null])),
    }
  })
  const reading = (id: SensorId, key: 'co2' | 'temperature' | 'humidity' | 'pm25') => sensors.find(sensor => sensor.id === id)?.readings[key] ?? null
  const fan = (target: 'intake' | 'exhaust'): FanState => {
    const feedback = frame?.actuators[target]
    const rpm = feedback?.rpm ?? null
    const enabled = stateFresh && feedback?.status === 'measured' && rpm !== null ? rpm > 0 : null
    return { enabled, rpm, airflow_m3_h: null, nominal_rpm: null, nominal_airflow_m3_h: null, rated_power_w: null }
  }
  const window = frame?.actuators.window
  const conflictingLimits = window ? !windowFeedbackValid(window) : false
  const measuredPosition = window?.position_quality === 'measured' && !conflictingLimits ? window.position_percent : null
  const windowPending = controls.recentCommands?.some(command => command.target === 'window' && command.status === 'pending')
  const key = frame ? `v2:${frame.data_source}:${frame.device_id}:${frame.boot_id}:${frame.sequence}` : null
  const prediction = dashboard.measurement?.ingestKey === key ? dashboard.prediction : null
  return {
    schema_version: 2, mode: 'real', data_source: 'real', revision: record?.id ?? 0, device_id: controls.deviceId,
    timestamp: frame?.sampled_at ?? record?.received_at ?? now.toISOString(), telemetry: record,
    connection: { controller: connection, received_at: record?.received_at ?? null, assessed_at: now.toISOString() },
    settings: snapshotSettings(settings), warnings: frame ? controllerWarnings(frame) : ['Ожидаем телеметрию ESP32'],
    simulation: {
      ...reference, elapsed_seconds: null, speed: null, fixed_step_seconds: null, occupancy: null,
      scenario: 'real', scenarios: [], supported_speeds: [], developer_values: {}, developer_parameters: {},
      layout: { ...reference.layout, indoor_sensor_center: point(reference.layout.indoor_sensor_center), outdoor_station_center: point(reference.layout.outdoor_station_center), control_cabinet_center: point(reference.layout.control_cabinet_center) },
      camera: { ...reference.camera, start_position: point(reference.camera.start_position), start_target: point(reference.camera.start_target) },
    },
    indoor: { co2_ppm: reading('indoor_climate', 'co2'), temperature_c: reading('indoor_climate', 'temperature'), humidity_percent: reading('indoor_climate', 'humidity'), pm25_ug_m3: reading('indoor_particles', 'pm25') },
    outdoor: { co2_ppm: null, temperature_c: reading('outdoor_climate', 'temperature'), humidity_percent: reading('outdoor_climate', 'humidity'), pm25_ug_m3: reading('outdoor_particles', 'pm25') },
    sensors,
    window: {
      actual_position_percent: measuredPosition, target_position_percent: windowPending ? controls.desired.windowOpen ? 100 : 0 : measuredPosition,
      position_quality: measuredPosition === null ? 'unknown' : stateFresh ? 'measured' : 'stale',
      motor_state: !stateFresh ? 'unknown' : conflictingLimits ? 'fault' : window?.motion ?? 'unknown',
      reed_switch: window?.reed_switch ?? null,
      open_limit_switch: window?.open_limit ?? null, close_limit_switch: window?.close_limit ?? null,
    },
    ventilation: { intake: fan('intake'), exhaust: fan('exhaust'), filter_enabled: null, filter_efficiency: null },
    airflow: { infiltration_m3_h: null, window_m3_h: null, intake_m3_h: null, exhaust_m3_h: null, total_effective_m3_h: null, air_changes_per_hour: null },
    energy: { fan_energy_wh: null, estimated_ventilation_heat_loss_wh: null, total_relative_energy: null },
    backend: { online: true, message: connection === 'online' ? null : 'Нет свежего отчёта устройства; показано последнее известное состояние', last_telemetry_at: record?.received_at ?? null, pending_commands: controls.pendingCommands,
      forecast: prediction ? { predicted_co2_15min: prediction.predictedCo2, target_time: prediction.targetTime.toISOString(), model_name: prediction.modelName, model_version: prediction.modelVersion } : null },
    demo: { active: false, phase: 'disabled', detail: 'Реальный режим' },
  }
}
