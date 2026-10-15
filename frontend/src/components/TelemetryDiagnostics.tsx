import { assessSensor, controllerWarnings, type StoredTelemetry } from '../lib/telemetry'

const names = { indoor_climate: 'SCD41 · внутри', indoor_particles: 'SPS30 · внутри', outdoor_climate: 'SHT45 · снаружи', outdoor_particles: 'SPS30 · снаружи' }
export default function TelemetryDiagnostics({ telemetry }: { telemetry?: StoredTelemetry | null }) {
  if (!telemetry) return null
  return <details className="dashboard-card telemetry-diagnostics"><summary>Диагностика · {telemetry.frame.device_id}</summary><p>Получено сервером: {new Date(telemetry.received_at).toLocaleString('ru-RU')}. Последние исправные значения при отказе сохранены отдельно и не считаются текущими.</p><dl>{telemetry.frame.sensors.map(sensor => {
    const status = assessSensor(sensor, Date.now(), telemetry.frame.controller.clock_synced)
    return <div key={sensor.sensor_id}><dt>{names[sensor.sensor_id]}</dt><dd>{status.message}{!status.usable && sensor.last_good_at ? ` · последнее измерение ${new Date(sensor.last_good_at).toLocaleString('ru-RU')}: ${Object.entries(sensor.values).map(([key, value]) => `${key} ${value ?? '—'}`).join(', ')}` : ''}{sensor.consecutive_failures ? ` · ошибок подряд: ${sensor.consecutive_failures}` : ''}</dd></div>
  })}</dl>{controllerWarnings(telemetry.frame).map(warning => <p className="control-feedback" key={warning}>{warning}</p>)}</details>
}
