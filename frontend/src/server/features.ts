import type { Measurement } from './types'

export const FEATURE_NAMES = [
  'current_co2',
  'indoor_temperature',
  'indoor_humidity',
  'indoor_pm25',
  'outdoor_temperature',
  'outdoor_humidity',
  'outdoor_pm25',
  'window_open',
  'co2_change_5min',
  'co2_change_10min',
  'hour',
] as const

export const PREDICTION_HORIZON_MS = 15 * 60 * 1000
export const MAX_LOOKBACK_GAP_MS = 2 * 60 * 1000

export type FeatureName = (typeof FEATURE_NAMES)[number]

export type FeatureVector = {
  [Key in FeatureName]: number
}

export class FeatureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeatureError'
  }
}

export class InsufficientHistoryError extends FeatureError {
  constructor(message = 'Недостаточно истории для построения признаков') {
    super(message)
    this.name = 'InsufficientHistoryError'
  }
}

export interface MlPredictionPayload {
  co2: number
  temperature: number
  humidity: number
  indoor_pm25: number
  outdoor_temperature: number
  outdoor_humidity: number
  outdoor_pm25: number
  window_open: boolean
  co2_change_5min: number
  co2_change_10min: number
  hour: number
}

function sortMeasurements(measurements: Measurement[]): Measurement[] {
  return [...measurements].sort(
    (left, right) =>
      left.timestamp.getTime() - right.timestamp.getTime() || left.id - right.id,
  )
}

function measurementAtOrBefore(
  records: Measurement[],
  targetTime: number,
): Measurement | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const recordTime = records[index].timestamp.getTime()
    if (recordTime > targetTime) {
      continue
    }
    if (targetTime - recordTime > MAX_LOOKBACK_GAP_MS) {
      return null
    }
    return records[index]
  }
  return null
}

export function buildFeatureVector(
  measurements: Measurement[],
  current: Measurement,
): FeatureVector {
  const records = sortMeasurements(
    measurements.some((record) => record.id === current.id)
      ? measurements
      : [...measurements, current],
  )
  const currentIndex = records.findIndex((record) => record.id === current.id)
  const history = records.slice(0, currentIndex + 1)
  const currentTime = current.timestamp.getTime()
  const previousFive = measurementAtOrBefore(history, currentTime - 5 * 60 * 1000)
  const previousTen = measurementAtOrBefore(history, currentTime - 10 * 60 * 1000)

  if (!previousFive || !previousTen) {
    throw new InsufficientHistoryError()
  }

  return {
    current_co2: current.indoor.co2,
    indoor_temperature: current.indoor.temperature,
    indoor_humidity: current.indoor.humidity,
    indoor_pm25: current.indoor.pm25,
    outdoor_temperature: current.outdoor.temperature,
    outdoor_humidity: current.outdoor.humidity,
    outdoor_pm25: current.outdoor.pm25,
    window_open: current.windowOpen ? 1 : 0,
    co2_change_5min: current.indoor.co2 - previousFive.indoor.co2,
    co2_change_10min: current.indoor.co2 - previousTen.indoor.co2,
    hour: current.timestamp.getUTCHours(),
  }
}

export function toMlPredictionPayload(features: FeatureVector): MlPredictionPayload {
  return {
    co2: features.current_co2,
    temperature: features.indoor_temperature,
    humidity: features.indoor_humidity,
    indoor_pm25: features.indoor_pm25,
    outdoor_temperature: features.outdoor_temperature,
    outdoor_humidity: features.outdoor_humidity,
    outdoor_pm25: features.outdoor_pm25,
    window_open: features.window_open === 1,
    co2_change_5min: features.co2_change_5min,
    co2_change_10min: features.co2_change_10min,
    hour: features.hour,
  }
}
