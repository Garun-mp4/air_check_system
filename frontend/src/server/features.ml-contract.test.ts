import { describe, expect, it } from 'vitest'

import {
  FEATURE_NAMES,
  InsufficientHistoryError,
  buildFeatureVector,
  toMlPredictionPayload,
} from './features'
import type { Measurement } from './types'

const EXPECTED_FEATURE_NAMES = [
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

function measurementAt(
  id: number,
  timestamp: string,
  co2: number,
  overrides: Partial<Measurement['indoor']> = {},
): Measurement {
  return {
    id,
    timestamp: new Date(timestamp),
    createdAt: new Date(timestamp),
    indoor: {
      co2,
      temperature: 22,
      humidity: 45,
      pm25: 5,
      ...overrides,
    },
    outdoor: {
      temperature: 18,
      humidity: 60,
      pm25: 8,
    },
    windowOpen: false,
  }
}

describe('ML feature contract', () => {
  it('builds the full documented feature vector and maps it to the flat service payload', () => {
    const tenMinute = measurementAt(1, '2026-09-06T10:00:00Z', 700)
    const fiveMinute = measurementAt(2, '2026-09-06T10:05:00Z', 800)
    const current = measurementAt(3, '2026-09-06T10:10:00Z', 1011, {
      temperature: 21.4,
      humidity: 47.6,
      pm25: 2.8,
    })
    current.outdoor = {
      temperature: 13.2,
      humidity: 64.7,
      pm25: 6.3,
    }
    current.windowOpen = true
    const future = measurementAt(4, '2026-09-06T10:11:00Z', 99_999)
    const features = buildFeatureVector([future, current, tenMinute, fiveMinute], current)
    const payload = toMlPredictionPayload(features)

    expect(FEATURE_NAMES).toEqual(EXPECTED_FEATURE_NAMES)
    expect(Object.keys(features)).toEqual(EXPECTED_FEATURE_NAMES)
    expect(Object.values(features)).toEqual([
      1011,
      21.4,
      47.6,
      2.8,
      13.2,
      64.7,
      6.3,
      1,
      211,
      311,
      10,
    ])
    expect(Object.keys(payload)).toEqual([
      'co2',
      'temperature',
      'humidity',
      'indoor_pm25',
      'outdoor_temperature',
      'outdoor_humidity',
      'outdoor_pm25',
      'window_open',
      'co2_change_5min',
      'co2_change_10min',
      'hour',
    ])
    expect(payload).toEqual({
      co2: 1011,
      temperature: 21.4,
      humidity: 47.6,
      indoor_pm25: 2.8,
      outdoor_temperature: 13.2,
      outdoor_humidity: 64.7,
      outdoor_pm25: 6.3,
      window_open: true,
      co2_change_5min: 211,
      co2_change_10min: 311,
      hour: 10,
    })
  })

  it('accepts each lookback measurement at the documented two-minute boundary', () => {
    const current = measurementAt(3, '2026-09-06T10:12:00Z', 1000)
    const atFiveMinuteBoundary = measurementAt(2, '2026-09-06T10:05:00Z', 800)
    const atTenMinuteBoundary = measurementAt(1, '2026-09-06T10:00:00Z', 700)

    const features = buildFeatureVector(
      [current, atTenMinuteBoundary, atFiveMinuteBoundary],
      current,
    )

    expect(features.co2_change_5min).toBe(200)
    expect(features.co2_change_10min).toBe(300)
  })

  it('rejects history that misses the five-minute lookback gap by one second', () => {
    const current = measurementAt(3, '2026-09-06T10:12:00Z', 1000)
    const tooOldForFiveMinuteLookback = measurementAt(
      2,
      '2026-09-06T10:04:59Z',
      800,
    )
    const tenMinute = measurementAt(1, '2026-09-06T10:00:00Z', 700)

    expect(() =>
      buildFeatureVector(
        [tenMinute, tooOldForFiveMinuteLookback, current],
        current,
      ),
    ).toThrow(InsufficientHistoryError)
  })
})
