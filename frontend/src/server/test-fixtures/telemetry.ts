import type { TelemetryFrame } from '../../lib/telemetry'
const now = Date.parse('2026-10-15T12:00:00Z')
export function frameFixture(): TelemetryFrame {
  return {
    schema_version: 2, device_id: 'room-01', data_source: 'real', boot_id: 'boot-00000001', sequence: 5, sampled_at: new Date(now).toISOString(),
    sensors: [
      { sensor_id: 'indoor_climate', status: 'ok', reason: 'ok', last_good_at: new Date(now).toISOString(), age_ms: 0, consecutive_failures: 0, values: { co2: 900, temperature: 23, humidity: 45 } },
      { sensor_id: 'outdoor_climate', status: 'ok', reason: 'ok', last_good_at: new Date(now).toISOString(), age_ms: 0, consecutive_failures: 0, values: { temperature: 15, humidity: 50 } },
      { sensor_id: 'indoor_particles', status: 'ok', reason: 'ok', last_good_at: new Date(now).toISOString(), age_ms: 0, consecutive_failures: 0, values: { pm25: 8 } },
      { sensor_id: 'outdoor_particles', status: 'ok', reason: 'ok', last_good_at: new Date(now).toISOString(), age_ms: 0, consecutive_failures: 0, values: { pm25: 12 } },
    ],
    controller: { uptime_ms: 30000, reset_reason: 1, firmware_version: '2.0.0', free_heap: 180000, minimum_free_heap: 160000, clock_synced: true, outputs_commissioned: true, dropped_packets: 0, queue_depth: 0 },
    actuators: { window: { open_limit: false, close_limit: true, position_percent: 0, position_quality: 'measured', motion: 'stopped' }, intake: { requested_on: false, rpm: 0, status: 'measured' }, exhaust: { requested_on: false, rpm: 0, status: 'measured' } },
    command_results: [],
  }
}
