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
  return { id: record.id, created_at: record.received_at, timestamp: frame.sampled_at ?? record.received_at,
    indoor: { co2: read('indoor_climate', 'co2'), temperature: read('indoor_climate', 'temperature'), humidity: read('indoor_climate', 'humidity'), pm25: read('indoor_particles', 'pm25') },
    outdoor: { temperature: read('outdoor_climate', 'temperature'), humidity: read('outdoor_climate', 'humidity'), pm25: read('outdoor_particles', 'pm25') },
    window_open: fresh && frame.controller.clock_synced && windowFeedbackValid(window) && window.position_quality === 'measured' && window.position_percent !== null ? window.position_percent > 0 : null,
  }
}
