import { sensorChannels, type FanTelemetry, type SensorId, type SensorQuality, type TelemetryFrame } from '../lib/telemetry'
import { ValidationError, type ValidationIssue } from './validation'

const qualities: SensorQuality[] = ['unknown', 'warmup', 'ok', 'timeout', 'crc', 'protocol', 'range', 'stale', 'suspect_jump', 'suspect_stuck']
const resultStatuses: TelemetryFrame['command_results'][number]['status'][] = ['applied', 'expired', 'clock_unsynced', 'disabled', 'fault', 'cancelled', 'unsafe_air']

export function parseTelemetry(payload: unknown, now = Date.now()): TelemetryFrame {
  const issues: ValidationIssue[] = []
  const fail = (field: string, message: string) => { issues.push({ field, message }) }
  const record = (value: unknown, field: string): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) { fail(field, 'требуется объект'); return {} }
    return value as Record<string, unknown>
  }
  const text = (value: unknown, field: string, maximum = 120): string => {
    if (typeof value !== 'string' || !value.length || value.length > maximum) { fail(field, 'требуется непустая строка до ' + maximum + ' символов'); return '' }
    return value
  }
  const number = (value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER, integer = true): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) { fail(field, 'число вне допустимого диапазона'); return 0 }
    return value
  }
  const boolean = (value: unknown, field: string): boolean => {
    if (typeof value !== 'boolean') { fail(field, 'требуется boolean'); return false }
    return value
  }
  const choice = <T extends string>(value: unknown, field: string, values: readonly T[]): T => {
    if (typeof value !== 'string' || !values.includes(value as T)) { fail(field, 'неизвестное значение'); return values[0] }
    return value as T
  }
  const date = (value: unknown, field: string): string | null => {
    if (value === null) return null
    const candidate = text(value, field, 40)
    const parsed = Date.parse(candidate)
    if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(candidate) || !Number.isFinite(parsed) || parsed > now + 5000) { fail(field, 'нужна дата RFC3339 не более чем на 5 секунд в будущем'); return null }
    return new Date(parsed).toISOString()
  }
  const root = record(payload, 'body')
  if (root.schema_version !== 2) fail('schema_version', 'поддерживается версия 2')
  const deviceId = text(root.device_id, 'device_id', 80)
  if (!/^[a-zA-Z0-9_-]+$/.test(deviceId)) fail('device_id', 'недопустимый идентификатор')
  const bootId = text(root.boot_id, 'boot_id', 80)
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(bootId)) fail('boot_id', 'недопустимый идентификатор загрузки')
  const sampledAt = date(root.sampled_at, 'sampled_at')
  const info = record(root.controller, 'controller')
  const controller: TelemetryFrame['controller'] = {
    uptime_ms: number(info.uptime_ms, 'controller.uptime_ms'), reset_reason: number(info.reset_reason, 'controller.reset_reason', 0, 255),
    firmware_version: text(info.firmware_version, 'controller.firmware_version', 80),
    free_heap: number(info.free_heap, 'controller.free_heap', 0, 1_073_741_824), minimum_free_heap: number(info.minimum_free_heap, 'controller.minimum_free_heap', 0, 1_073_741_824),
    clock_synced: boolean(info.clock_synced, 'controller.clock_synced'), outputs_commissioned: boolean(info.outputs_commissioned, 'controller.outputs_commissioned'),
    dropped_packets: number(info.dropped_packets, 'controller.dropped_packets'), queue_depth: number(info.queue_depth, 'controller.queue_depth', 0, 100000),
  }
  if (controller.clock_synced !== (sampledAt !== null)) fail('sampled_at', 'состояние часов не согласовано с датой')
  if (controller.minimum_free_heap > controller.free_heap) fail('controller.minimum_free_heap', 'минимум не может превышать текущее значение')
  const sensors: TelemetryFrame['sensors'] = []
  if (!Array.isArray(root.sensors) || root.sensors.length !== 4) fail('sensors', 'требуются четыре известных датчика')
  const seen = new Set<string>()
  for (const [i, raw] of (Array.isArray(root.sensors) ? root.sensors.slice(0, 4) : []).entries()) {
    const path = `sensors.${i}`
    const sensor = record(raw, path)
    const id = choice(sensor.sensor_id, path + '.sensor_id', Object.keys(sensorChannels) as SensorId[])
    if (seen.has(id)) fail(path + '.sensor_id', 'датчик указан повторно')
    seen.add(id)
    const quality = choice(sensor.status, path + '.status', qualities)
    const lastGood = date(sensor.last_good_at, path + '.last_good_at')
    const age = number(sensor.age_ms, path + '.age_ms')
    if (sampledAt && lastGood) {
      const difference = Date.parse(sampledAt) - Date.parse(lastGood)
      if (difference < -5000 || Math.abs(difference - age) > 2000) fail(path + '.age_ms', 'возраст не соответствует времени измерения')
    }
    const values = record(sensor.values, path + '.values')
    const checked: TelemetryFrame['sensors'][number]['values'] = {}
    for (const key of sensorChannels[id]) {
      const range = key === 'co2' ? [250, 10000] : key === 'temperature' ? [-60, 80] : key === 'humidity' ? [0, 100] : [0, 1000]
      checked[key] = values[key] === null ? null : number(values[key], `${path}.values.${key}`, range[0], range[1], false)
      if (quality === 'ok' && (checked[key] === null || (controller.clock_synced && lastGood === null))) fail(path, 'достоверное измерение требует значения и времени')
    }
    sensors.push({ sensor_id: id, status: quality, reason: text(sensor.reason, path + '.reason', 240), last_good_at: lastGood, age_ms: age, consecutive_failures: number(sensor.consecutive_failures, path + '.consecutive_failures'), values: checked })
  }
  const actuators = record(root.actuators, 'actuators')
  const window = record(actuators.window, 'actuators.window')
  const position = window.position_percent === null ? null : number(window.position_percent, 'actuators.window.position_percent', 0, 100, false)
  const positionQuality = choice(window.position_quality, 'actuators.window.position_quality', ['unknown', 'measured', 'estimated'] as const)
  if ((position === null) !== (positionQuality === 'unknown')) fail('actuators.window.position_quality', 'качество не согласовано с положением')
  const fan = (value: unknown, name: string): FanTelemetry => {
    const f = record(value, name)
    const status = choice(f.status, name + '.status', ['measured', 'unknown', 'fault'] as const)
    const rpm = f.rpm === null ? null : number(f.rpm, name + '.rpm', 0, 100000)
    if (status === 'measured' && rpm === null) fail(name + '.rpm', 'измеренные обороты требуют значения')
    return { requested_on: boolean(f.requested_on, name + '.requested_on'), rpm, status }
  }
  const results: TelemetryFrame['command_results'] = []
  if (!Array.isArray(root.command_results) || root.command_results.length > 20) fail('command_results', 'требуется массив до 20 результатов')
  const resultIds = new Set<number>()
  for (const [i, raw] of (Array.isArray(root.command_results) ? root.command_results.slice(0, 20) : []).entries()) {
    const result = record(raw, `command_results.${i}`)
    const id = number(result.id, `command_results.${i}.id`, 1)
    if (resultIds.has(id)) fail(`command_results.${i}.id`, 'повтор результата')
    resultIds.add(id)
    results.push({ id, status: choice(result.status, `command_results.${i}.status`, resultStatuses) })
  }
  const frame: TelemetryFrame = {
    schema_version: 2, device_id: deviceId, boot_id: bootId,
    data_source: choice(root.data_source, 'data_source', ['real', 'simulator'] as const), sequence: number(root.sequence, 'sequence'), sampled_at: sampledAt,
    sensors, controller, actuators: {
      window: { open_limit: boolean(window.open_limit, 'actuators.window.open_limit'), close_limit: boolean(window.close_limit, 'actuators.window.close_limit'), position_percent: position, position_quality: positionQuality, motion: choice(window.motion, 'actuators.window.motion', ['stopped', 'opening', 'closing', 'fault'] as const) },
      exhaust: fan(actuators.exhaust, 'actuators.exhaust'), intake: fan(actuators.intake, 'actuators.intake'),
    }, command_results: results,
  }
  if (issues.length) throw new ValidationError(issues)
  return frame
}
