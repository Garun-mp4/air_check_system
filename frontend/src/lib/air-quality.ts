export const PM25_GOOD_LIMIT = 15
export const PM25_ELEVATED_LIMIT = 35
export const PM25_SCALE_MAX = 50

export type Pm25Level = 'good' | 'elevated' | 'high' | 'unknown'
export type Pm25Tone = 'success' | 'warning' | 'error' | 'neutral'

export function getPm25Level(value: number | null | undefined): Pm25Level {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'unknown'
  }
  if (value <= PM25_GOOD_LIMIT) {
    return 'good'
  }
  if (value <= PM25_ELEVATED_LIMIT) {
    return 'elevated'
  }
  return 'high'
}

export function getPm25Label(level: Pm25Level): string {
  if (level === 'good') {
    return 'Норма'
  }
  if (level === 'elevated') {
    return 'Повышено'
  }
  if (level === 'high') {
    return 'Высокий уровень'
  }
  return 'Нет данных'
}

export function getPm25Tone(level: Pm25Level): Pm25Tone {
  if (level === 'good') {
    return 'success'
  }
  if (level === 'elevated') {
    return 'warning'
  }
  if (level === 'high') {
    return 'error'
  }
  return 'neutral'
}

export function getPm25MarkerPosition(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null
  }
  return Math.min(97, Math.max(3, (value / PM25_SCALE_MAX) * 100))
}

export function getPm25AriaLabel(value: number | null | undefined): string {
  const level = getPm25Level(value)
  const label = getPm25Label(level)
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'PM2.5: нет данных'
  }
  return `PM2.5: ${value.toFixed(1)} µg/m³, ${label}`
}
