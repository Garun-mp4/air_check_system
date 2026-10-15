export const sensorChannels = {
  indoor_climate: ['co2', 'temperature', 'humidity'],
  outdoor_climate: ['temperature', 'humidity'],
  indoor_particles: ['pm25'],
  outdoor_particles: ['pm25'],
} as const

export type SensorId = keyof typeof sensorChannels
export type SensorQuality = 'unknown' | 'warmup' | 'ok' | 'timeout' | 'crc' | 'protocol' | 'range' | 'stale' | 'suspect_jump' | 'suspect_stuck'
export interface SensorTelemetry {
  sensor_id: SensorId
  status: SensorQuality
  reason: string
  last_good_at: string | null
  age_ms: number
  consecutive_failures: number
  values: Partial<Record<'co2' | 'temperature' | 'humidity' | 'pm25', number | null>>
}
export interface FanTelemetry {
  requested_on: boolean
  rpm: number | null
  status: 'measured' | 'unknown' | 'fault'
}
export interface TelemetryFrame {
  schema_version: 2
  device_id: string
  data_source: 'real' | 'simulator'
  boot_id: string
  sequence: number
  sampled_at: string | null
  edge_forecast?: { model_sha256: string; horizon_minutes: 15 | 20; predicted_co2: number | null; inference_us: number }
  sensors: SensorTelemetry[]
  controller: {
    uptime_ms: number
    reset_reason: number | null
    firmware_version: string
    free_heap: number | null
    minimum_free_heap: number | null
    clock_synced: boolean
    outputs_commissioned: boolean
    dropped_packets: number
    queue_depth: number
    sd_status?: 'disabled' | 'missing' | 'ready' | 'full' | 'error'
    sd_backlog?: number
  }
  actuators: {
    window: {
      open_limit: boolean
      close_limit: boolean
      reed_switch?: boolean | null
      position_percent: number | null
      position_quality: 'unknown' | 'measured' | 'estimated'
      motion: 'stopped' | 'opening' | 'closing' | 'fault'
    }
    exhaust: FanTelemetry
    intake: FanTelemetry
  }
  command_results: { id: number; status: 'applied' | 'expired' | 'clock_unsynced' | 'disabled' | 'fault' | 'cancelled' | 'unsafe_air' }[]
}

export interface StoredTelemetry {
  id: number
  received_at: string
  frame: TelemetryFrame
}

export const sensorQualityLabels: Record<SensorQuality, string> = {
  unknown: 'Нет подтверждённых данных', warmup: 'Прогрев / ожидание измерения', ok: 'Данные получены',
  timeout: 'Нет ответа: проверьте питание и связь', crc: 'Ошибка контрольной суммы', protocol: 'Ошибка протокола',
  range: 'Недопустимое значение', stale: 'Измерение устарело', suspect_jump: 'Подозрительный скачок',
  suspect_stuck: 'Значение долго не меняется; нужна проверка',
}

export function windowFeedbackValid(window: TelemetryFrame['actuators']['window']): boolean {
  if (window.open_limit && window.close_limit) return false
  if (window.open_limit && window.reed_switch === false) return false
  if (window.position_quality === 'measured' && window.position_percent !== null) {
    if (window.open_limit && window.position_percent !== 100) return false
    if (window.close_limit && window.position_percent !== 0) return false
  }
  return true
}

export function assessSensor(sensor: SensorTelemetry, now = Date.now(), clockSynced = true) {
  const at = sensor.last_good_at ? Date.parse(sensor.last_good_at) : Number.NaN
  const ageMs = Number.isFinite(at) ? now - at : null
  const quality: SensorQuality = !clockSynced ? 'unknown'
    : sensor.status === 'ok' && (ageMs === null || ageMs < -5000 || ageMs > 15000) ? 'stale' : sensor.status
  return { quality, ageMs, usable: quality === 'ok', message: sensorQualityLabels[quality] }
}

export function controllerWarnings(frame: TelemetryFrame): string[] {
  const warnings: string[] = []
  const { controller: c, actuators: a } = frame
  if (!c.clock_synced) warnings.push('Часы устройства не синхронизированы')
  if (!c.outputs_commissioned) warnings.push('Исполнительные каналы не введены в эксплуатацию')
  if (c.reset_reason !== null && [5, 6, 7].includes(c.reset_reason)) warnings.push('Последний перезапуск вызван watchdog')
  if (c.reset_reason === 9) warnings.push('Последний перезапуск: падение питания (brownout)')
  if (c.minimum_free_heap !== null && c.minimum_free_heap < 32768) warnings.push('Малый запас свободной памяти')
  if (c.dropped_packets) warnings.push(`Пропущено пакетов: ${c.dropped_packets}`)
  if (c.sd_status === 'missing') warnings.push('SD-карта не обнаружена; работает ограниченный буфер в RAM')
  if (c.sd_status === 'full') warnings.push('SD-журнал заполнен; новые данные могут теряться до восстановления связи')
  if (c.sd_status === 'error') warnings.push('Ошибка SD-карты; управление продолжает работать')
  if (a.window.open_limit && a.window.close_limit) warnings.push('Противоречивые концевики окна')
  else if (!windowFeedbackValid(a.window)) warnings.push('Датчики положения окна не согласованы')
  const i2c = frame.sensors.filter(sensor => sensor.sensor_id.endsWith('_climate'))
  if (i2c.length === 2 && i2c.every(sensor => ['timeout', 'crc', 'protocol'].includes(sensor.status))) warnings.push('Возможна общая проблема I²C или питания; проверьте оба климатических датчика и шину')
  if (a.window.motion === 'fault') warnings.push('Ошибка привода окна; движение остановлено')
  if (a.window.position_quality !== 'measured') warnings.push('Положение окна не подтверждено измерением')
  for (const [name, fan] of [['Вытяжка', a.exhaust], ['Приток', a.intake]] as const) {
    if (fan.status === 'fault') warnings.push(`${name}: ошибка обратной связи`)
    if (fan.requested_on && (fan.rpm === null || fan.status === 'unknown')) warnings.push(`${name}: вращение не подтверждено`)
  }
  return warnings
}
