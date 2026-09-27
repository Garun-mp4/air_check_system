import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppConfig } from './config'
import { MlClient } from './ml-client'
import { MemoryRepository } from './repository'
import { serializeIngest } from './serializers'
import { AirQualityService } from './service'
import type { MeasurementInput } from './types'

const config: AppConfig = {
  databaseUrl: 'postgres://test',
  mlServiceUrl: 'http://ml.test',
  historyLimit: 5000,
  mlHistoryLimit: 200,
  mlRequestTimeoutMs: 1000,
  dataRetentionHours: 24,
  co2NormalThreshold: 800,
  co2CriticalThreshold: 1000,
  pm25GoodLimit: 15,
  pm25ElevatedLimit: 35,
  deviceId: 'room-01',
  deviceHeartbeatTimeoutMs: 90_000,
  windowManualOverrideMinutes: 30,
  autoVentilationMinimumMinutes: 5,
  automationEnabled: true,
  autoWindowEnabled: true,
  alertsEnabled: true,
}

function inputAt(timestamp: Date, co2 = 650): MeasurementInput {
  return {
    timestamp,
    indoor: { co2, temperature: 23, humidity: 45, pm25: 5 },
    outdoor: { temperature: 18, humidity: 60, pm25: 8 },
    windowOpen: false,
  }
}

async function seedSufficientHistory(repository: MemoryRepository) {
  const start = new Date('2026-09-06T10:00:00Z')
  for (let index = 0; index < 20; index += 1) {
    await repository.createMeasurement(
      inputAt(new Date(start.getTime() + index * 30_000), 650 + index * 3),
    )
  }
  return new Date(start.getTime() + 20 * 30_000)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ML service persistence and API serialization boundary', () => {
  it('persists and serializes only the validated forecast returned by the client', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            predicted_co2_15min: 740.5,
            model: 'random_forest',
            model_version: '1.0',
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const repository = new MemoryRepository()
    const service = new AirQualityService(repository, new MlClient(config.mlServiceUrl, 1000), config)
    const currentTime = await seedSufficientHistory(repository)

    const result = await service.ingest(inputAt(currentTime, 710))
    const serialized = serializeIngest(result)
    const latestStored = await repository.getLatestPrediction()
    const sentPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))

    expect(result.predictionStatus).toBe('ready')
    expect(result.prediction).toEqual(latestStored)
    expect(latestStored?.predictedCo2).toBe(740.5)
    expect(latestStored?.modelName).toBe('random_forest')
    expect(latestStored?.modelVersion).toBe('1.0')
    expect(serialized.prediction).toMatchObject({
      predicted_co2_15min: 740.5,
      model_name: 'random_forest',
      model_version: '1.0',
    })
    expect(serialized.prediction_status).toBe('ready')
    expect(sentPayload).toEqual({
      co2: 710,
      temperature: 23,
      humidity: 45,
      indoor_pm25: 5,
      outdoor_temperature: 18,
      outdoor_humidity: 60,
      outdoor_pm25: 8,
      window_open: false,
      co2_change_5min: 30,
      co2_change_10min: 60,
      hour: 10,
    })
  })

  it.each([
    [
      'HTTP unavailable status',
      JSON.stringify({ error: { code: 'model_unavailable', message: 'model is not ready' } }),
      503,
    ],
    ['malformed JSON', '{"predicted_co2_15min":', 200],
    [
      'negative forecast',
      JSON.stringify({
        predicted_co2_15min: -1,
        model: 'random_forest',
        model_version: '1.0',
      }),
      200,
    ],
  ])('keeps the measurement and reports no forecast after %s', async (_caseName, body, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: Number(status) })),
    )
    const repository = new MemoryRepository()
    const service = new AirQualityService(repository, new MlClient(config.mlServiceUrl, 1000), config)
    const currentTime = await seedSufficientHistory(repository)

    const result = await service.ingest(inputAt(currentTime, 710))
    const serialized = serializeIngest(result)

    expect(result.measurement.indoor.co2).toBe(710)
    expect(result.predictionStatus).toBe('unavailable')
    expect(result.prediction).toBeNull()
    expect(result.predictionError).toBeTruthy()
    expect(await repository.getLatestMeasurement()).toMatchObject({
      indoor: { co2: 710 },
    })
    expect(await repository.getLatestPrediction()).toBeNull()
    expect(serialized.prediction).toBeNull()
    expect(serialized.prediction_status).toBe('unavailable')
    expect(serialized.prediction_error).toBe(result.predictionError)
  })
})
