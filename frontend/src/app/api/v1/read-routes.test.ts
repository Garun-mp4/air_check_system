import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  latest: vi.fn(),
  history: vi.fn(),
  latestPrediction: vi.fn(),
  latestRecommendation: vi.fn(),
  nodeSettings: vi.fn(),
  updateNodeSettings: vi.fn(),
  config: { historyLimit: 250, deviceId: 'room-01' },
}))

vi.mock('../../../server/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/api')>()
  return {
    ...actual,
    getAirQualityService: () => ({
      latest: mocks.latest,
      history: mocks.history,
      latestPrediction: mocks.latestPrediction,
      latestRecommendation: mocks.latestRecommendation,
      nodeSettings: mocks.nodeSettings,
      updateNodeSettings: mocks.updateNodeSettings,
    }),
  }
})

vi.mock('../../../server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/config')>()
  return { ...actual, getConfig: () => mocks.config }
})

vi.mock('../../../server/access', () => ({
  accessErrorResponse: vi.fn(() => null),
  assertSameOrigin: vi.fn(),
  requireOperator: vi.fn(),
}))

import { GET as getLatestMeasurement } from './measurements/latest/route'
import { GET as getHistory } from './measurements/history/route'
import { GET as getLatestPrediction } from './prediction/latest/route'
import { GET as getRecommendation } from './recommendation/route'
import { GET as getSettings, PATCH as patchSettings } from './settings/route'

const date = new Date('2026-09-06T10:00:00Z')

function measurement(id = 12) {
  return {
    id,
    createdAt: new Date('2026-09-06T10:00:01Z'),
    timestamp: date,
    indoor: { co2: 720, temperature: 23.4, humidity: 45, pm25: 5.2 },
    outdoor: { temperature: 18, humidity: 60, pm25: 8 },
    windowOpen: false,
  }
}

function settings() {
  return {
    deviceId: 'room-01',
    automationEnabled: true,
    autoWindowEnabled: false,
    manualOverrideMinutes: 30,
    autoVentilationMinimumMinutes: 5,
    co2NormalThreshold: 800,
    co2CriticalThreshold: 1000,
    pm25GoodLimit: 15,
    pm25ElevatedLimit: 35,
    alertsEnabled: true,
    retentionHours: 24,
    updatedAt: date,
  }
}

function request(url: string, body?: string): Request {
  return new Request('http://aircheck.local' + url, {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body,
  })
}

describe('read and settings API route contracts', () => {
  beforeEach(() => {
    for (const mock of [
      mocks.latest,
      mocks.history,
      mocks.latestPrediction,
      mocks.latestRecommendation,
      mocks.nodeSettings,
      mocks.updateNodeSettings,
    ]) mock.mockReset()
    mocks.config = { historyLimit: 250, deviceId: 'room-01' }
  })

  it('serializes latest dashboard data to the documented snake_case schema', async () => {
    mocks.latest.mockResolvedValue({
      measurement: measurement(),
      prediction: {
        id: 5,
        createdAt: date,
        targetTime: new Date('2026-09-06T10:15:00Z'),
        predictedCo2: 910,
        modelName: 'linear_regression',
        modelVersion: '1.2',
      },
      recommendation: {
        id: 7,
        createdAt: date,
        type: 'monitor',
        message: 'Следите за уровнем CO₂',
        durationMinutes: null,
        reason: 'Текущий уровень повышен',
      },
    })

    const response = await getLatestMeasurement()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: {
      measurement: {
        id: 12,
        created_at: '2026-09-06T10:00:01.000Z',
        timestamp: '2026-09-06T10:00:00.000Z',
        indoor: { co2: 720, temperature: 23.4, humidity: 45, pm25: 5.2 },
        outdoor: { temperature: 18, humidity: 60, pm25: 8 },
        window_open: false,
      },
      prediction: {
        id: 5,
        created_at: '2026-09-06T10:00:00.000Z',
        target_time: '2026-09-06T10:15:00.000Z',
        predicted_co2_15min: 910,
        model_name: 'linear_regression',
        model_version: '1.2',
      },
      recommendation: {
        id: 7,
        created_at: '2026-09-06T10:00:00.000Z',
        type: 'monitor',
        message: 'Следите за уровнем CO₂',
        duration_minutes: null,
        reason: 'Текущий уровень повышен',
      },
    } })
  })

  it('keeps empty dashboard values explicitly null', async () => {
    mocks.latest.mockResolvedValue({ measurement: null, prediction: null, recommendation: null })

    const response = await getLatestMeasurement()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { measurement: null, prediction: null, recommendation: null } })
  })

  it('passes parsed history bounds and limit to the service and serializes response metadata', async () => {
    mocks.history.mockResolvedValue([measurement(13)])

    const response = await getHistory(request(
      '/api/v1/measurements/history?from=2026-09-06T13%3A00%3A00%2B03%3A00&to=2026-09-06T10%3A00%3A00Z&limit=12',
    ))

    expect(response.status).toBe(200)
    expect(mocks.history).toHaveBeenCalledWith({
      from: new Date('2026-09-06T10:00:00Z'),
      to: new Date('2026-09-06T10:00:00Z'),
      limit: 12,
    })
    expect(await response.json()).toEqual({
      data: [{
        id: 13,
        created_at: '2026-09-06T10:00:01.000Z',
        timestamp: '2026-09-06T10:00:00.000Z',
        indoor: { co2: 720, temperature: 23.4, humidity: 45, pm25: 5.2 },
        outdoor: { temperature: 18, humidity: 60, pm25: 8 },
        window_open: false,
      }],
      meta: { count: 1, from: '2026-09-06T10:00:00.000Z', to: '2026-09-06T10:00:00.000Z', limit: 12 },
    })
  })

  it('uses the configured history limit when the caller omits the limit', async () => {
    mocks.history.mockResolvedValue([])

    const response = await getHistory(request('/api/v1/measurements/history'))

    expect(response.status).toBe(200)
    expect(mocks.history).toHaveBeenCalledWith({ limit: 250 })
    expect(await response.json()).toMatchObject({ meta: { count: 0, limit: 250 } })
  })

  it('returns a structured 400 and does not query history when a limit is invalid', async () => {
    const response = await getHistory(request('/api/v1/measurements/history?limit=5001'))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'validation_error', fields: [expect.objectContaining({ field: 'limit' })] },
    })
    expect(mocks.history).not.toHaveBeenCalled()
  })

  it('returns null from prediction and recommendation read routes before records exist', async () => {
    mocks.latestPrediction.mockResolvedValue(null)
    mocks.latestRecommendation.mockResolvedValue(null)

    const prediction = await getLatestPrediction()
    const recommendation = await getRecommendation()

    expect(prediction.status).toBe(200)
    expect(await prediction.json()).toEqual({ data: null })
    expect(recommendation.status).toBe(200)
    expect(await recommendation.json()).toEqual({ data: null })
  })

  it('serializes existing prediction and recommendation values without renaming loss', async () => {
    mocks.latestPrediction.mockResolvedValue({
      id: 5, createdAt: date, targetTime: new Date('2026-09-06T10:15:00Z'),
      predictedCo2: 910, modelName: 'linear_regression', modelVersion: '1.2',
    })
    mocks.latestRecommendation.mockResolvedValue({
      id: 7, createdAt: date, type: 'normal', message: 'Норма', durationMinutes: null, reason: 'Порогов нет',
    })

    expect(await (await getLatestPrediction()).json()).toEqual({ data: {
      id: 5, created_at: '2026-09-06T10:00:00.000Z', target_time: '2026-09-06T10:15:00.000Z',
      predicted_co2_15min: 910, model_name: 'linear_regression', model_version: '1.2',
    } })
    expect(await (await getRecommendation()).json()).toEqual({ data: {
      id: 7, created_at: '2026-09-06T10:00:00.000Z', type: 'normal', message: 'Норма',
      duration_minutes: null, reason: 'Порогов нет',
    } })
  })

  it('uses the configured device fallback for settings and maps all fields to the public schema', async () => {
    mocks.nodeSettings.mockResolvedValue(settings())

    const response = await getSettings(request('/api/v1/settings'))

    expect(mocks.nodeSettings).toHaveBeenCalledWith('room-01')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: {
      device_id: 'room-01', automation_enabled: true, auto_window_enabled: false,
      manual_override_minutes: 30, auto_ventilation_minimum_minutes: 5,
      co2_normal_threshold: 800, co2_critical_threshold: 1000,
      pm25_good_limit: 15, pm25_elevated_limit: 35, alerts_enabled: true,
      retention_hours: 24, updated_at: '2026-09-06T10:00:00.000Z',
    } })
  })

  it('validates requested settings device_id before querying the service', async () => {
    const response = await getSettings(request('/api/v1/settings?device_id=room%2F02'))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'validation_error', fields: [expect.objectContaining({ field: 'device_id' })] },
    })
    expect(mocks.nodeSettings).not.toHaveBeenCalled()
  })

  it('forwards a syntactically valid non-default device_id without registry lookup', async () => {
    mocks.nodeSettings.mockResolvedValue({ ...settings(), deviceId: 'unregistered-room-99' })

    const response = await getSettings(request('/api/v1/settings?device_id=unregistered-room-99'))

    expect(response.status).toBe(200)
    expect(mocks.nodeSettings).toHaveBeenCalledWith('unregistered-room-99')
    expect(await response.json()).toMatchObject({ data: { device_id: 'unregistered-room-99' } })
  })

  it('maps partial settings PATCH input and serializes the returned persisted state', async () => {
    mocks.updateNodeSettings.mockResolvedValue({
      ...settings(), deviceId: 'room-02', automationEnabled: false, co2NormalThreshold: 750,
    })

    const response = await patchSettings(request('/api/v1/settings', JSON.stringify({
      device_id: 'room-02', automation_enabled: false, co2_normal_threshold: 750,
    })))

    expect(response.status).toBe(200)
    expect(mocks.updateNodeSettings).toHaveBeenCalledWith('room-02', {
      automationEnabled: false,
      co2NormalThreshold: 750,
    })
    expect(await response.json()).toMatchObject({ data: {
      device_id: 'room-02', automation_enabled: false, co2_normal_threshold: 750,
      retention_hours: 24,
    } })
  })

  it('rejects malformed settings JSON and invalid patches before update', async () => {
    const malformed = await patchSettings(request('/api/v1/settings', '{'))
    const emptyPatch = await patchSettings(request('/api/v1/settings', JSON.stringify({})))

    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: { code: 'invalid_json' } })
    expect(emptyPatch.status).toBe(400)
    expect(await emptyPatch.json()).toMatchObject({ error: { code: 'validation_error' } })
    expect(mocks.updateNodeSettings).not.toHaveBeenCalled()
  })
})
