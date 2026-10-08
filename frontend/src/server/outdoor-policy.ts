import type { Measurement } from './types'

export interface OutdoorPolicy {
  maxPm25: number
  pm25Recovery: number
  minTemperature: number
  temperatureRecovery: number
  filteredIntake: boolean
  maxAgeSeconds: number
}
export interface OutdoorSafety {
  pollutionBlocked: boolean
  coldBlocked: boolean
  unavailable: boolean
  allowWindow: boolean
  allowVentilation: boolean
  reason: string
  assessedAt: string
  measurementAt: string
}
export const defaultOutdoorPolicy: OutdoorPolicy = {
  maxPm25: 35,
  pm25Recovery: 30,
  minTemperature: 5,
  temperatureRecovery: 7,
  filteredIntake: false,
  maxAgeSeconds: 90,
}
export function validateOutdoorPolicy(value: unknown): OutdoorPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Требуется объект правил наружного воздуха')
  const p = value as Record<string, unknown>
  const ranges = {
    maxPm25: [1, 1000],
    pm25Recovery: [0, 999],
    minTemperature: [-40, 40],
    temperatureRecovery: [-39, 45],
    maxAgeSeconds: [5, 3600],
  }
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (
      typeof p[key] !== 'number' ||
      !Number.isFinite(p[key]) ||
      p[key] < min ||
      p[key] > max
    )
      throw new Error('Недопустимое значение ' + key)
  }
  if (
    typeof p.filteredIntake !== 'boolean' ||
    Object.keys(p).some((k) => !(k in defaultOutdoorPolicy))
  )
    throw new Error('Недопустимые параметры фильтрации')
  if (
    (p.pm25Recovery as number) >= (p.maxPm25 as number) ||
    (p.temperatureRecovery as number) <= (p.minTemperature as number)
  )
    throw new Error(
      'Порог восстановления должен отличаться от порога ограничения',
    )
  return { ...p } as unknown as OutdoorPolicy
}
export function assessOutdoor(
  measurement: Measurement,
  policy: OutdoorPolicy,
  previous?: OutdoorSafety | null,
  now = new Date(),
): OutdoorSafety {
  const age = now.getTime() - measurement.timestamp.getTime()
  const unavailable =
    age < -5000 ||
    age > policy.maxAgeSeconds * 1000 ||
    !Number.isFinite(measurement.outdoor.pm25) ||
    !Number.isFinite(measurement.outdoor.temperature)
  const pollutionBlocked = unavailable
    ? (previous?.pollutionBlocked ?? false)
    : measurement.outdoor.pm25 >=
      (previous?.pollutionBlocked ? policy.pm25Recovery : policy.maxPm25)
  const coldBlocked = unavailable
    ? (previous?.coldBlocked ?? false)
    : measurement.outdoor.temperature <=
      (previous?.coldBlocked
        ? policy.temperatureRecovery
        : policy.minTemperature)
  const allowWindow = !unavailable && !pollutionBlocked && !coldBlocked
  const allowVentilation =
    !unavailable && !coldBlocked && (!pollutionBlocked || policy.filteredIntake)
  const reason = unavailable
    ? 'Нет свежих достоверных наружных измерений. Проверьте датчики.'
    : coldBlocked
      ? 'Наружный воздух слишком холодный. Автоматический приток и открытие окна ограничены.'
      : pollutionBlocked
        ? policy.filteredIntake
          ? 'Наружный PM2.5 повышен: окно закрыто, доступен подтверждённый фильтрованный приток.'
          : 'Наружный PM2.5 повышен. Без подтверждённой фильтрации приток и окно ограничены.'
        : 'Наружный воздух допускает проветривание.'
  return {
    pollutionBlocked,
    coldBlocked,
    unavailable,
    allowWindow,
    allowVentilation,
    reason,
    assessedAt: now.toISOString(),
    measurementAt: measurement.timestamp.toISOString(),
  }
}
