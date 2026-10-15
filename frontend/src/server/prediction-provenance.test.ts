import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRepository } from './repository'
import { AirQualityService } from './service'
import { MlServiceError } from './ml-client'
import { getConfig } from './config'
const input = (timestamp: Date) => ({
  dataSource: 'simulator' as const,
  timestamp,
  indoor: { co2: 950, temperature: 23, humidity: 45, pm25: 5 },
  outdoor: { temperature: 18, humidity: 60, pm25: 8 },
  windowOpen: false,
})
afterEach(() => vi.useRealTimers())
describe('prediction provenance and freshness', () => {
  it('keeps a failed measurement, hides the previous forecast, and recovers on a new measurement', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
    const r = new MemoryRepository(),
      predict = vi
        .fn()
        .mockResolvedValueOnce({
          predictedCo2_15min: 1000,
          model: 'model',
          modelVersion: '1',
        })
        .mockRejectedValueOnce(
          new MlServiceError('Модель не обучена', 503, 'model_unavailable'),
        )
        .mockResolvedValue({
          predictedCo2_15min: 980,
          model: 'model',
          modelVersion: '2',
        })
    const service = new AirQualityService(r, { predict }, getConfig())
    for (let i = 0; i < 20; i++)
      await r.createMeasurement(
        input(new Date(Date.now() - 600_000 + i * 30_000)),
      )
    const first = await service.ingest(input(new Date()))
    expect(first.prediction?.measurementId).toBe(first.measurement.id)
    expect(first.prediction?.sourceTimestamp).toEqual(
      first.measurement.timestamp,
    )
    expect((await service.latest()).diagnostics?.prediction).toBe('ready')
    vi.setSystemTime(new Date(Date.now() + 30_000))
    const failed = await service.ingest(input(new Date()))
    expect(failed.measurement.id).not.toBe(first.measurement.id)
    expect((await r.getLatestMeasurement())?.predictionErrorCode).toBe(
      'model_unavailable',
    )
    const dashboard = await service.latest()
    expect(dashboard.prediction).toBeNull()
    expect(dashboard.diagnostics?.prediction).toBe('model_untrained')
    expect(await service.latestPrediction()).toBeNull()
    expect((await r.getLatestPrediction())?.id).toBe(first.prediction?.id)
    vi.setSystemTime(new Date(Date.now() + 30_000))
    const recovered = await service.ingest(input(new Date()))
    expect((await service.latest()).prediction?.measurementId).toBe(
      recovered.measurement.id,
    )
    vi.setSystemTime(new Date(Date.now() + 100_000))
    expect((await service.latest()).diagnostics?.prediction).toBe('stale')
    expect((await service.latest()).prediction).toBeNull()
  })
  it('preserves unknown legacy artifacts without exposing them in simulation', async () => {
    const r = new MemoryRepository(),
      service = new AirQualityService(r, { predict: vi.fn() }, getConfig())
    const m = await r.createMeasurement(input(new Date()))
    await r.createPrediction({
      targetTime: new Date(m.timestamp.getTime() + 900_000),
      predictedCo2: 1100,
      modelName: 'legacy',
      modelVersion: '1',
    })
    const result = await service.latest()
    expect(result.prediction).toBeNull()
    expect(result.diagnostics?.prediction).toBe('pending')
    expect((await r.getLatestPrediction())?.modelName).toBe('legacy')
  })
  it('reports no data and separately tracks connection loss', async () => {
    const r = new MemoryRepository(),
      service = new AirQualityService(r, { predict: vi.fn() }, getConfig())
    expect((await service.latest()).diagnostics).toMatchObject({
      measurement: 'missing',
      device: 'offline',
      prediction: 'pending',
    })
    await r.createMeasurement(input(new Date(Date.now() - 300_000)))
    expect((await service.latest()).diagnostics).toMatchObject({
      measurement: 'stale',
      device: 'offline',
    })
  })
})
