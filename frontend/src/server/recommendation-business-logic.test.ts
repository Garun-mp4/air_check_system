import { describe, expect, it, vi } from 'vitest'

import { ControlService } from './control-service'
import type { AppConfig } from './config'
import { MemoryRepository } from './repository'
import { evaluateRecommendation } from './recommendation'
import { AirQualityService } from './service'
import type { Measurement, MeasurementInput, Prediction } from './types'

const config: AppConfig = {
  databaseUrl: 'postgres://test',
  mlServiceUrl: 'http://ml.test',
  historyLimit: 5000,
  mlHistoryLimit: 200,
  dataRetentionHours: 24,
  mlRequestTimeoutMs: 1000,
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

const thresholds = {
  normal: 800,
  critical: 1000,
  pm25Good: 10,
  pm25Elevated: 40,
  alertsEnabled: true,
}

function measurementAt(
  co2: number,
  options: {
    indoorPm25?: number
    outdoorPm25?: number
    windowOpen?: boolean
    timestamp?: Date
  } = {},
): Measurement {
  const timestamp = options.timestamp ?? new Date('2026-09-28T12:00:00Z')
  return {
    id: 1,
    timestamp,
    createdAt: timestamp,
    indoor: {
      co2,
      temperature: 23,
      humidity: 45,
      pm25: options.indoorPm25 ?? 5,
    },
    outdoor: {
      temperature: 18,
      humidity: 60,
      pm25: options.outdoorPm25 ?? 8,
    },
    windowOpen: options.windowOpen ?? false,
  }
}

function measurementInputAt(
  timestamp: Date,
  co2: number,
  options: { indoorPm25?: number; outdoorPm25?: number; windowOpen?: boolean } = {},
): MeasurementInput {
  return {
    timestamp,
    indoor: {
      co2,
      temperature: 23,
      humidity: 45,
      pm25: options.indoorPm25 ?? 5,
    },
    outdoor: {
      temperature: 18,
      humidity: 60,
      pm25: options.outdoorPm25 ?? 8,
    },
    windowOpen: options.windowOpen ?? false,
  }
}

function predictionAt(co2: number): Prediction {
  const createdAt = new Date('2026-09-28T12:00:00Z')
  return {
    id: 1,
    targetTime: new Date(createdAt.getTime() + 15 * 60_000),
    predictedCo2: co2,
    modelName: 'test-model',
    modelVersion: '1.0',
    createdAt,
  }
}

describe('recommendation business logic', () => {
  it.each([
    {
      name: 'just above the normal CO2 limit',
      co2: 801,
      prediction: null,
      type: 'monitor',
    },
    {
      name: 'above the critical CO2 limit despite a lower forecast',
      co2: 1001,
      prediction: 650,
      type: 'ventilate_now',
    },
  ])('handles $name', ({ co2, prediction, type }) => {
    const result = evaluateRecommendation(
      measurementAt(co2),
      prediction,
      thresholds,
    )

    expect(result.type).toBe(type)
  })

  it.each([
    { name: 'just below the normal PM2.5 limit', pm25: 9.99, type: 'normal' },
    { name: 'just above the normal PM2.5 limit', pm25: 10.01, type: 'monitor' },
  ])('handles $name using indoor PM2.5', ({ pm25, type }) => {
    const result = evaluateRecommendation(
      measurementAt(650, { indoorPm25: pm25, outdoorPm25: 120 }),
      null,
      thresholds,
    )

    expect(result.type).toBe(type)
  })

  it('uses an available forecast while treating a missing forecast as unavailable', () => {
    const current = measurementAt(799)

    expect(evaluateRecommendation(current, null, thresholds).type).toBe('normal')
    expect(evaluateRecommendation(current, 801, thresholds).type).toBe(
      'forecast_warning',
    )
  })

  it('returns the same recommendation for identical inputs', () => {
    const current = measurementAt(850, { indoorPm25: 20 })
    const prediction = 900

    const first = evaluateRecommendation(current, prediction, thresholds)
    const second = evaluateRecommendation(current, prediction, thresholds)

    expect(second).toEqual(first)
  })
})

describe('recommendation settings integration', () => {
  it('applies stored thresholds and alert settings to ingested measurements', async () => {
    const repository = new MemoryRepository()
    const service = new AirQualityService(repository, { predict: vi.fn() }, config)
    await service.updateNodeSettings('room-01', {
      co2NormalThreshold: 700,
      co2CriticalThreshold: 900,
      pm25GoodLimit: 10,
      pm25ElevatedLimit: 30,
      alertsEnabled: true,
    })

    const adjustedCo2 = await service.ingest(
      measurementInputAt(new Date('2026-09-28T12:00:00Z'), 701),
    )
    expect(adjustedCo2.recommendation?.type).toBe('monitor')
    expect(adjustedCo2.recommendation?.reason).toContain('700 ppm')

    const adjustedPm = await service.ingest(
      measurementInputAt(new Date('2026-09-28T12:00:30Z'), 650, {
        indoorPm25: 30.5,
        outdoorPm25: 120,
      }),
    )
    expect(adjustedPm.recommendation?.type).toBe('monitor')
    expect(adjustedPm.recommendation?.reason).toContain('30 µg/m³')

    await service.updateNodeSettings('room-01', { alertsEnabled: false })
    const alertsDisabled = await service.ingest(
      measurementInputAt(new Date('2026-09-28T12:01:00Z'), 650, {
        indoorPm25: 30.5,
        outdoorPm25: 120,
      }),
    )
    expect(alertsDisabled.recommendation?.type).toBe('normal')
  })

  it('keeps PM2.5 alerts separate from CO2-driven automatic commands', async () => {
    const repository = new MemoryRepository()
    const service = new AirQualityService(repository, { predict: vi.fn() }, config)

    const result = await service.ingest(
      measurementInputAt(new Date('2026-09-28T12:00:00Z'), 650, {
        indoorPm25: 45,
        outdoorPm25: 120,
      }),
    )

    expect(result.recommendation?.type).toBe('monitor')
    expect(await service.pendingControlCommands()).toEqual([])
  })
})

describe('automatic control reconciliation', () => {
  it.each([
    { source: 'current measurement', co2: 1000, prediction: null },
    { source: '15-minute forecast', co2: 799, prediction: predictionAt(1000) },
  ])(
    'opens the window and starts both fans at the critical boundary from $source',
    async ({ co2, prediction }) => {
      const repository = new MemoryRepository()
      const service = new ControlService(repository, config)

      const commands = await service.reconcile(measurementAt(co2), prediction)

      expect(commands.map((command) => command.target)).toEqual([
        'window',
        'exhaust',
        'intake',
      ])
      expect(commands.every((command) => command.desiredState)).toBe(true)
      expect(new Set(commands.map((command) => command.batchId)).size).toBe(1)
    },
  )

  it('starts both fans when an open window needs support', async () => {
    const repository = new MemoryRepository()
    const service = new ControlService(repository, config)
    const timestamp = new Date('2026-09-28T12:00:00Z')
    await repository.reportControlState({
      deviceId: 'room-01',
      timestamp,
      reported: { exhaustOn: false, intakeOn: false, windowOpen: true },
      appliedCommandIds: [],
    })

    const commands = await service.reconcile(
      measurementAt(801, { windowOpen: true, timestamp }),
      null,
    )

    expect(commands.map((command) => command.target)).toEqual([
      'exhaust',
      'intake',
    ])
    expect(commands.every((command) => command.desiredState)).toBe(true)
  })

  it('does not enqueue duplicate fan commands while open-window ventilation is running', async () => {
    const repository = new MemoryRepository()
    const service = new ControlService(repository, config)
    const openedAt = new Date('2026-09-28T12:00:00Z')
    const activation = await service.reconcile(
      measurementAt(1000, { timestamp: openedAt }),
      null,
    )
    await repository.reportControlState({
      deviceId: 'room-01',
      timestamp: openedAt,
      reported: { exhaustOn: true, intakeOn: true, windowOpen: true },
      appliedCommandIds: activation.map((command) => command.id),
    })

    const commands = await service.reconcile(
      measurementAt(801, {
        windowOpen: true,
        timestamp: new Date(openedAt.getTime() + 60_000),
      }),
      null,
    )

    expect(commands).toEqual([])
  })

  it('queues no automatic commands for normal CO2 with no active ventilation', async () => {
    const repository = new MemoryRepository()
    const service = new ControlService(repository, config)

    const commands = await service.reconcile(measurementAt(799), null)

    expect(commands).toEqual([])
  })
})
