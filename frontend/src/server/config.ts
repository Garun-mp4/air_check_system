export interface AppConfig {
  databaseUrl: string
  mlServiceUrl: string
  historyLimit: number
  mlHistoryLimit: number
  mlRequestTimeoutMs: number
  co2NormalThreshold: number
  co2CriticalThreshold: number
  deviceId: string
  deviceHeartbeatTimeoutMs: number
  windowManualOverrideMinutes: number
  autoVentilationMinimumMinutes: number
  automationEnabled: boolean
}

function readNumber(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(name + ' must be a finite number >= ' + minimum)
  }
  return value
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false
  }
  throw new Error(name + ' must be true or false')
}

export function getConfig(): AppConfig {
  const normal = readNumber('CO2_NORMAL_THRESHOLD', 800, 0)
  const critical = readNumber('CO2_CRITICAL_THRESHOLD', 1000, normal)
  if (critical <= normal) {
    throw new Error('CO2_CRITICAL_THRESHOLD must be greater than CO2_NORMAL_THRESHOLD')
  }

  return {
    databaseUrl:
      process.env.DATABASE_URL ??
      'postgres://air_quality:air_quality_dev@localhost:5432/air_quality',
    mlServiceUrl: (process.env.ML_SERVICE_URL ?? 'http://localhost:8000').replace(/\/+$/, ''),
    historyLimit: Math.floor(readNumber('HISTORY_LIMIT', 200, 1)),
    mlHistoryLimit: Math.floor(readNumber('ML_HISTORY_LIMIT', 200, 1)),
    mlRequestTimeoutMs: Math.floor(readNumber('ML_REQUEST_TIMEOUT_MS', 5000, 100)),
    co2NormalThreshold: normal,
    co2CriticalThreshold: critical,
    deviceId: (process.env.DEVICE_ID ?? 'room-01').trim() || 'room-01',
    deviceHeartbeatTimeoutMs: Math.floor(
      readNumber('DEVICE_HEARTBEAT_TIMEOUT_MS', 90_000, 1_000),
    ),
    windowManualOverrideMinutes: Math.floor(
      readNumber('WINDOW_MANUAL_OVERRIDE_MINUTES', 30, 1),
    ),
    autoVentilationMinimumMinutes: Math.floor(
      readNumber('AUTO_VENTILATION_MINIMUM_MINUTES', 5, 1),
    ),
    automationEnabled: readBoolean('AUTOMATION_ENABLED', true),
  }
}
