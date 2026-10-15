import type { ClientMeasurement } from './client-api'
import { assessSensor, windowFeedbackValid, type SensorId, type StoredTelemetry } from './telemetry'

export function liveMeasurement(record: StoredTelemetry | null | undefined, fallback: ClientMeasurement | null, now = Date.now()): ClientMeasurement | null {
  if (!record) return fallback
  const frame = record.frame
  const read = (id: SensorId, channel: 'co2' | 'temperature' | 'humidity' | 'pm25') => {
    const sensor = frame.sensors.find(item => item.sensor_id === id)
    return sensor && assessSensor(sensor, now, frame.controller.clock_synced).usable ? sensor.values[channel] ?? null : null
  }
  const window = frame.actuators.window
  const fresh = frame.sampled_at && now - Date.parse(frame.sampled_at) <= 90000 && now - Date.parse(frame.sampled_at) >= -5000
  return { id: record.id, observation_key: `v2:${frame.data_source}:${frame.device_id}:${frame.boot_id}:${frame.sequence}`, created_at: record.received_at, timestamp: frame.sampled_at ?? record.received_at,
    indoor: { co2: read('indoor_climate', 'co2'), temperature: read('indoor_climate', 'temperature'), humidity: read('indoor_climate', 'humidity'), pm25: read('indoor_particles', 'pm25') },
    outdoor: { temperature: read('outdoor_climate', 'temperature'), humidity: read('outdoor_climate', 'humidity'), pm25: read('outdoor_particles', 'pm25') },
    window_open: fresh && frame.controller.clock_synced && windowFeedbackValid(window) && window.position_quality === 'measured' && window.position_percent !== null ? window.position_percent > 0 : null,
  }
}

export function mergeObservationHistory(history: ClientMeasurement[], latest: ClientMeasurement, from: number, limit = 20000): ClientMeasurement[] {
  const key = (value: ClientMeasurement) => value.observation_key ?? 'legacy:' + value.id
  const retained = history.filter(value => Number.isFinite(Date.parse(value.timestamp)) && Date.parse(value.timestamp) >= from && key(value) !== key(latest))
  if (Number.isFinite(Date.parse(latest.timestamp)) && Date.parse(latest.timestamp) >= from) retained.push(latest)
  return retained.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id - b.id).slice(-limit)
}
