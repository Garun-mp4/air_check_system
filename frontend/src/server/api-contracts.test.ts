import { describe, expect, it } from 'vitest'

import {
  parseDeviceId,
  parseHistoryQuery,
  parseMeasurementInput,
  parseNodeSettingsPatch,
  ValidationError,
} from './validation'

function validMeasurement() {
  return {
    timestamp: '2026-09-06T10:00:00Z',
    indoor: { co2: 720, temperature: 23.4, humidity: 45, pm25: 5.2 },
    outdoor: { temperature: 18, humidity: 60, pm25: 8 },
    window_open: false,
  }
}

function issueFields(action: () => unknown): string[] {
  try {
    action()
  } catch (error) {
    if (error instanceof ValidationError) {
      return error.issues.map((issue) => issue.field)
    }
    throw error
  }
  throw new Error('Expected ValidationError')
}

describe('measurements API contract validation', () => {
  it('normalizes timestamps with Z and numeric offsets without changing sensor units', () => {
    const utc = parseMeasurementInput(validMeasurement())
    const offset = parseMeasurementInput({
      ...validMeasurement(),
      timestamp: '2026-09-06T13:00:00+03:00',
    })

    expect(utc.timestamp.toISOString()).toBe('2026-09-06T10:00:00.000Z')
    expect(offset.timestamp.toISOString()).toBe(utc.timestamp.toISOString())
    expect(utc.indoor).toEqual({ co2: 720, temperature: 23.4, humidity: 45, pm25: 5.2 })
    expect(utc.outdoor).toEqual({ temperature: 18, humidity: 60, pm25: 8 })
    expect(utc.windowOpen).toBe(false)
  })

  it('accepts the inclusive documented sensor boundaries', () => {
    const parsed = parseMeasurementInput({
      timestamp: '2026-09-06T10:00:00Z',
      indoor: { co2: 250, temperature: -40, humidity: 0, pm25: 0 },
      outdoor: { temperature: -60, humidity: 100, pm25: 1000 },
      window_open: true,
    })

    expect(parsed.indoor).toEqual({ co2: 250, temperature: -40, humidity: 0, pm25: 0 })
    expect(parsed.outdoor).toEqual({ temperature: -60, humidity: 100, pm25: 1000 })

    const upper = parseMeasurementInput({
      timestamp: '2026-09-06T10:00:00Z',
      indoor: { co2: 10000, temperature: 80, humidity: 100, pm25: 1000 },
      outdoor: { temperature: 80, humidity: 0, pm25: 0 },
      window_open: false,
    })
    expect(upper.indoor.co2).toBe(10000)
    expect(upper.indoor.pm25).toBe(1000)
  })

  it('rejects non-object bodies, missing nested sensor fields, and non-boolean window state', () => {
    expect(() => parseMeasurementInput(null)).toThrow(ValidationError)
    expect(() => parseMeasurementInput([])).toThrow(ValidationError)
    expect(issueFields(() => parseMeasurementInput({
      timestamp: validMeasurement().timestamp,
      indoor: { co2: 720 },
      outdoor: {},
      window_open: 'false',
    }))).toEqual(expect.arrayContaining([
      'indoor.temperature',
      'indoor.humidity',
      'indoor.pm25',
      'outdoor.temperature',
      'outdoor.humidity',
      'outdoor.pm25',
      'window_open',
    ]))
  })

  it.each([
    ['indoor.co2', (payload: ReturnType<typeof validMeasurement>) => { payload.indoor.co2 = 249 }],
    ['indoor.temperature', (payload: ReturnType<typeof validMeasurement>) => { payload.indoor.temperature = 80.01 }],
    ['indoor.humidity', (payload: ReturnType<typeof validMeasurement>) => { payload.indoor.humidity = 100.01 }],
    ['indoor.pm25', (payload: ReturnType<typeof validMeasurement>) => { payload.indoor.pm25 = -0.01 }],
    ['outdoor.temperature', (payload: ReturnType<typeof validMeasurement>) => { payload.outdoor.temperature = -60.01 }],
    ['outdoor.humidity', (payload: ReturnType<typeof validMeasurement>) => { payload.outdoor.humidity = -0.01 }],
    ['outdoor.pm25', (payload: ReturnType<typeof validMeasurement>) => { payload.outdoor.pm25 = 1000.01 }],
  ])('rejects an out-of-range value for %s', (_field, change) => {
    const payload = validMeasurement()
    change(payload)
    expect(issueFields(() => parseMeasurementInput(payload))).toContain(_field)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '720'])('rejects non-finite or non-numeric sensor values (%s)', (value) => {
    const payload = validMeasurement()
    payload.indoor.co2 = value as number
    expect(issueFields(() => parseMeasurementInput(payload))).toContain('indoor.co2')
  })

  it.each([
    '2026-09-06T10:00:00',
    'not-a-dateZ',
  ])('rejects timestamps without timezone or with invalid date syntax: %s', (timestamp) => {
    expect(issueFields(() => parseMeasurementInput({ ...validMeasurement(), timestamp }))).toContain('timestamp')
  })
})

describe('history query contract validation', () => {
  it('uses configured defaults and parses inclusive RFC3339 range endpoints', () => {
    expect(parseHistoryQuery(new URLSearchParams(''), 250)).toEqual({ limit: 250 })
    expect(parseHistoryQuery(
      new URLSearchParams('from=2026-09-06T10%3A00%3A00%2B03%3A00&to=2026-09-06T08%3A00%3A00Z&limit=5000'),
      100,
    )).toEqual({
      from: new Date('2026-09-06T07:00:00Z'),
      to: new Date('2026-09-06T08:00:00Z'),
      limit: 5000,
    })
  })

  it.each(['0', '5001', '-1', '1.5', 'abc'])('rejects invalid history limit %s', (limit) => {
    expect(() => parseHistoryQuery(new URLSearchParams('limit=' + limit), 500)).toThrow(ValidationError)
  })

  it('rejects a reversed range and malformed or timezone-free timestamps', () => {
    expect(() => parseHistoryQuery(
      new URLSearchParams('from=2026-09-06T11%3A00%3A00Z&to=2026-09-06T10%3A00%3A00Z'),
      500,
    )).toThrow(ValidationError)
    expect(() => parseHistoryQuery(new URLSearchParams('from=2026-09-06T10%3A00%3A00'), 500)).toThrow(ValidationError)
  })
})

describe('node settings data contract validation', () => {
  it('trims and validates device identifiers while applying the configured fallback', () => {
    expect(parseDeviceId(null, 'room-01')).toBe('room-01')
    expect(parseDeviceId('  Room_02-west  ', 'room-01')).toBe('Room_02-west')
    expect(parseDeviceId('a'.repeat(64), 'room-01')).toHaveLength(64)
    for (const invalid of ['bad id', '../room', 'ё', 'a'.repeat(65)]) {
      expect(() => parseDeviceId(invalid, 'room-01')).toThrow(ValidationError)
    }
  })

  it('maps a partial settings patch to the internal fields and leaves omitted values absent', () => {
    expect(parseNodeSettingsPatch({
      device_id: 'room-02',
      automation_enabled: false,
      co2_normal_threshold: 750,
      alerts_enabled: true,
    }, 'room-01')).toEqual({
      deviceId: 'room-02',
      patch: {
        automationEnabled: false,
        co2NormalThreshold: 750,
        alertsEnabled: true,
      },
    })
  })

  it.each([
    { manual_override_minutes: 0 },
    { manual_override_minutes: 1.5 },
    { auto_ventilation_minimum_minutes: 121 },
    { co2_normal_threshold: 249 },
    { co2_critical_threshold: 10001 },
    { pm25_good_limit: -1 },
    { pm25_elevated_limit: 1001 },
    { alerts_enabled: 'false' },
    { device_id: 'room/02', co2_normal_threshold: 800 },
    {},
  ])('rejects malformed settings patch %o', (patch) => {
    expect(() => parseNodeSettingsPatch(patch, 'room-01')).toThrow(ValidationError)
  })

  it('does not treat the retention read-only field as an update', () => {
    expect(() => parseNodeSettingsPatch({ retention_hours: 1 }, 'room-01')).toThrow(ValidationError)
  })
})
