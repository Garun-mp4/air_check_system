import { describe, expect, it, vi } from 'vitest'

import { buildFeatureVector, InsufficientHistoryError } from './features'
import { ControlService } from './control-service'
import { InvalidMlResponseError, MlClient } from './ml-client'
import { MemoryRepository } from './repository'
import { evaluateRecommendation } from './recommendation'
import { AirQualityService } from './service'
import type {
  AppConfig,
} from './config'
import type {
  Measurement,
  MeasurementInput,
} from './types'
import {
  ValidationError,
  parseHistoryQuery,
  parseMeasurementInput,
  parseNodeSettingsPatch,
  parseVentilationCommand,
} from './validation'

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

function inputAt(timestamp: Date, co2 = 650, windowOpen = false): MeasurementInput {
  return {
    timestamp,
    indoor: {
      co2,
      temperature: 23,
      humidity: 45,
      pm25: 5,
    },
    outdoor: {
      temperature: 18,
      humidity: 60,
      pm25: 8,
    },
    windowOpen,
  }
}

function measurementAt(
  id: number,
  timestamp: Date,
  co2 = 650,
  windowOpen = false,
): Measurement {
  return {
    ...inputAt(timestamp, co2, windowOpen),
    id,
    createdAt: timestamp,
  }
}

function validPayload() {
  return {
    timestamp: '2026-09-06T10:00:00Z',
    indoor: {
      co2: 720,
      temperature: 23.4,
      humidity: 45,
      pm25: 5.2,
    },
    outdoor: {
      temperature: 18,
      humidity: 60,
      pm25: 8,
    },
    window_open: false,
  }
}

describe('measurement validation', () => {
  it('normalizes a valid nested ESP32 payload', () => {
    const result = parseMeasurementInput(validPayload())

    expect(result.timestamp.toISOString()).toBe('2026-09-06T10:00:00.000Z')
    expect(result.indoor.co2).toBe(720)
    expect(result.windowOpen).toBe(false)
  })

  it('reports all malformed fields without storing a record', () => {
    expect(() =>
      parseMeasurementInput({
        ...validPayload(),
        timestamp: '2026-09-06T10:00:00',
        indoor: { co2: 12000 },
        window_open: 'yes',
      }),
    ).toThrow(ValidationError)
  })
})

describe('history validation', () => {
  it('accepts a full 24-hour history request and rejects larger limits', () => {
    expect(parseHistoryQuery(new URLSearchParams('limit=5000'), 5000).limit).toBe(5000)
    expect(() => parseHistoryQuery(new URLSearchParams('limit=5001'), 5000)).toThrow(
      ValidationError,
    )
  })
})

describe('ventilation command validation', () => {
  it('accepts a composite on/off command without changing device targets', () => {
    expect(
      parseVentilationCommand({ device_id: 'room-01', action: 'on' }, 'fallback'),
    ).toEqual({ deviceId: 'room-01', action: 'on' })
  })

  it('rejects window-style actions on the composite ventilation endpoint', () => {
    expect(() => parseVentilationCommand({ action: 'open' }, 'room-01')).toThrow(
      ValidationError,
    )
  })
})

describe('feature preparation', () => {
  it('uses only measurements at or before the current timestamp', () => {
    const start = new Date('2026-09-06T10:00:00Z')
    const measurements = Array.from({ length: 21 }, (_, index) =>
      measurementAt(
        index + 1,
        new Date(start.getTime() + index * 30_000),
        600 + index * 2,
      ),
    )
    const current = measurements[20]
    const withFuture = [
      ...measurements,
      measurementAt(22, new Date(current.timestamp.getTime() + 60_000), 9000),
    ]

    const features = buildFeatureVector(withFuture, current)

    expect(features.co2_change_5min).toBe(20)
    expect(features.co2_change_10min).toBe(40)
    expect(features.current_co2).toBe(640)
  })

  it('rejects a current point when lookback history is missing', () => {
    const current = measurementAt(1, new Date('2026-09-06T10:00:00Z'))

    expect(() => buildFeatureVector([current], current)).toThrow(
      InsufficientHistoryError,
    )
  })
})

describe('recommendation engine', () => {
  it('asks for immediate ventilation when CO2 is critical and window is closed', () => {
    const result = evaluateRecommendation(
      measurementAt(1, new Date(), 1250, false),
      null,
      { normal: 800, critical: 1000 },
    )

    expect(result.type).toBe('ventilate_now')
    expect(result.durationMinutes).toBe(10)
  })

  it('recognizes active ventilation when the window is open', () => {
    const result = evaluateRecommendation(
      measurementAt(1, new Date(), 1100, true),
      null,
      { normal: 800, critical: 1000 },
    )

    expect(result.type).toBe('ventilating')
    expect(result.message).toContain('проветр')
  })

  it('warns about a future threshold crossing', () => {
    const result = evaluateRecommendation(
      measurementAt(1, new Date(), 760, false),
      1050,
      { normal: 800, critical: 1000 },
    )

    expect(result.type).toBe('forecast_warning')
  })

  it('uses the configured PM2.5 limits for air-quality recommendations', () => {
    const measurement = measurementAt(1, new Date(), 650, false)
    measurement.indoor.pm25 = 42

    const result = evaluateRecommendation(
      measurement,
      null,
      {
        normal: 800,
        critical: 1000,
        pm25Good: 10,
        pm25Elevated: 40,
        alertsEnabled: true,
      },
    )

    expect(result.type).toBe('monitor')
    expect(result.reason).toContain('40')
  })

  it('does not create a PM2.5 warning when alerts are disabled', () => {
    const measurement = measurementAt(1, new Date(), 650, false)
    measurement.indoor.pm25 = 42

    const result = evaluateRecommendation(
      measurement,
      null,
      {
        normal: 800,
        critical: 1000,
        pm25Good: 10,
        pm25Elevated: 40,
        alertsEnabled: false,
      },
    )

    expect(result.type).toBe('normal')
  })
})

describe('node settings', () => {
  it('parses a partial settings update and preserves the device id', () => {
    expect(parseNodeSettingsPatch({
      device_id: 'room-02',
      co2_normal_threshold: 750,
      alerts_enabled: false,
    }, 'room-01')).toEqual({
      deviceId: 'room-02',
      patch: {
        co2NormalThreshold: 750,
        alertsEnabled: false,
      },
    })
  })

  it('rejects an empty settings update and invalid numeric values', () => {
    expect(() => parseNodeSettingsPatch({}, 'room-01')).toThrow(ValidationError)
    expect(() => parseNodeSettingsPatch({ pm25_good_limit: -1 }, 'room-01')).toThrow(ValidationError)
  })
})

describe('memory repository', () => {
  it('stores and retrieves measurements in timestamp order', async () => {
    const repository = new MemoryRepository()
    await repository.createMeasurement(
      inputAt(new Date('2026-09-06T10:01:00Z'), 700),
    )
    await repository.createMeasurement(
      inputAt(new Date('2026-09-06T10:00:00Z'), 680),
    )

    const history = await repository.listMeasurements({
      from: new Date('2026-09-06T10:00:00Z'),
      to: new Date('2026-09-06T10:02:00Z'),
      limit: 10,
    })

    expect(history.map((item) => item.indoor.co2)).toEqual([680, 700])
    expect((await repository.getLatestMeasurement())?.indoor.co2).toBe(700)
  })

  it('persists node settings and returns defaults for a new node', async () => {
    const repository = new MemoryRepository()
    const defaults = {
      automationEnabled: true,
      autoWindowEnabled: true,
      manualOverrideMinutes: 30,
      autoVentilationMinimumMinutes: 5,
      co2NormalThreshold: 800,
      co2CriticalThreshold: 1000,
      pm25GoodLimit: 15,
      pm25ElevatedLimit: 35,
      alertsEnabled: true,
      retentionHours: 24,
    }

    const initial = await repository.getNodeSettings('room-01', defaults)
    expect(initial.co2NormalThreshold).toBe(800)

    const updated = await repository.updateNodeSettings(
      'room-01',
      { co2NormalThreshold: 750, co2CriticalThreshold: 950 },
      defaults,
    )

    expect(updated.co2NormalThreshold).toBe(750)
    expect((await repository.getNodeSettings('room-01', defaults)).co2CriticalThreshold).toBe(950)
  })

  it('purges expired readings and derived records but keeps pending commands', async () => {
    vi.useFakeTimers()
    try {
      const repository = new MemoryRepository()
      const cutoff = new Date('2026-09-06T12:00:00Z')
      vi.setSystemTime(new Date('2026-09-06T11:59:00Z'))
      await repository.createMeasurement(
        inputAt(new Date('2026-09-06T11:59:00Z'), 700),
      )
      await repository.createPrediction({
        targetTime: new Date('2026-09-06T12:14:00Z'),
        predictedCo2: 720,
        modelName: 'linear_regression',
        modelVersion: '1.0',
      })
      await repository.createRecommendation({
        type: 'normal',
        message: 'Воздух в норме',
        durationMinutes: null,
        reason: 'test',
      })
      await repository.queueControlCommands([
        {
          deviceId: 'room-01',
          target: 'exhaust',
          desiredState: true,
          source: 'manual',
          reason: 'test',
          batchId: 'retention-test',
        },
      ])

      vi.setSystemTime(new Date('2026-09-06T12:01:00Z'))
      await repository.createMeasurement(
        inputAt(new Date('2026-09-06T12:01:00Z'), 710),
      )
      await repository.createPrediction({
        targetTime: new Date('2026-09-06T12:16:00Z'),
        predictedCo2: 730,
        modelName: 'linear_regression',
        modelVersion: '1.0',
      })
      await repository.createRecommendation({
        type: 'monitor',
        message: 'Продолжайте наблюдение',
        durationMinutes: null,
        reason: 'test',
      })

      const result = await repository.purgeExpiredData(cutoff)

      expect(result).toMatchObject({
        measurements: 1,
        predictions: 1,
        recommendations: 1,
        commands: 0,
      })
      expect(
        (await repository.listMeasurements({ limit: 10 })).map(
          (item) => item.indoor.co2,
        ),
      ).toEqual([710])
      expect((await repository.getLatestPrediction())?.predictedCo2).toBe(730)
      expect((await repository.getLatestRecommendation())?.type).toBe('monitor')
      expect((await repository.getControlState('room-01')).pendingCommands).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('queues simultaneous fan commands and acknowledges device state', async () => {
    const repository = new MemoryRepository()
    const batchId = 'batch-1'
    const commands = await repository.queueControlCommands([
      {
        deviceId: 'room-01',
        target: 'exhaust',
        desiredState: true,
        source: 'manual',
        reason: 'test',
        batchId,
      },
      {
        deviceId: 'room-01',
        target: 'intake',
        desiredState: true,
        source: 'manual',
        reason: 'test',
        batchId,
      },
      {
        deviceId: 'room-01',
        target: 'window',
        desiredState: true,
        source: 'manual',
        reason: 'test',
        batchId,
      },
    ])

    expect(commands).toHaveLength(3)
    expect((await repository.getControlState('room-01')).desired).toEqual({
      exhaustOn: true,
      intakeOn: true,
      windowOpen: true,
    })

    const state = await repository.reportControlState({
      deviceId: 'room-01',
      timestamp: new Date(),
      reported: { exhaustOn: true, intakeOn: true, windowOpen: true },
      appliedCommandIds: commands.map((command) => command.id),
    })
    expect(state.reported).toEqual({
      exhaustOn: true,
      intakeOn: true,
      windowOpen: true,
    })
    expect(state.pendingCommands).toBe(0)
  })

  it('does not acknowledge a command belonging to another device', async () => {
    const repository = new MemoryRepository()
    const [command] = await repository.queueControlCommands([
      {
        deviceId: 'room-01',
        target: 'exhaust',
        desiredState: true,
        source: 'manual',
        reason: 'test',
        batchId: 'batch-mismatch',
      },
    ])

    const state = await repository.reportControlState({
      deviceId: 'room-02',
      timestamp: new Date(),
      reported: { exhaustOn: true, intakeOn: false, windowOpen: false },
      appliedCommandIds: [command.id],
    })

    expect(state.pendingCommands).toBe(0)
    expect((await repository.getControlState('room-01')).pendingCommands).toBe(1)
    expect((await repository.getControlState('room-01')).lastCommand?.status).toBe('pending')
  })

  it('ignores stale device reports and keeps the newer acknowledgement state', async () => {
    const repository = new MemoryRepository()
    const freshTimestamp = new Date('2026-09-09T13:00:00Z')
    await repository.reportControlState({
      deviceId: 'room-01',
      timestamp: freshTimestamp,
      reported: { exhaustOn: true, intakeOn: true, windowOpen: true },
      appliedCommandIds: [],
    })
    const [stopCommand] = await repository.queueControlCommands([
      {
        deviceId: 'room-01',
        target: 'exhaust',
        desiredState: false,
        source: 'manual',
        reason: 'test',
        batchId: 'stale-report',
      },
    ])

    const state = await repository.reportControlState({
      deviceId: 'room-01',
      timestamp: new Date('2026-09-09T12:00:00Z'),
      reported: { exhaustOn: false, intakeOn: false, windowOpen: false },
      appliedCommandIds: [stopCommand.id],
    })

    expect(state.reported).toEqual({ exhaustOn: true, intakeOn: true, windowOpen: true })
    expect(state.lastReportedAt).toEqual(freshTimestamp)
    expect(state.windowOpenSince).toEqual(freshTimestamp)
    expect(state.pendingCommands).toBe(1)
  })

  it('acknowledges every command explicitly applied in one device report', async () => {
    const repository = new MemoryRepository()
    const [started] = await repository.queueControlCommands([
      {
        deviceId: 'room-01',
        target: 'exhaust',
        desiredState: true,
        source: 'manual',
        reason: 'test',
        batchId: 'sequence',
      },
    ])
    const [stopped] = await repository.queueControlCommands([
      {
        deviceId: 'room-01',
        target: 'exhaust',
        desiredState: false,
        source: 'manual',
        reason: 'test',
        batchId: 'sequence',
      },
    ])

    const state = await repository.reportControlState({
      deviceId: 'room-01',
      timestamp: new Date('2026-09-09T13:00:00Z'),
      reported: { exhaustOn: false, intakeOn: false, windowOpen: false },
      appliedCommandIds: [started.id, stopped.id],
    })

    expect(state.pendingCommands).toBe(0)
    expect((await repository.getLatestControlCommand('room-01', 'exhaust'))?.status).toBe('applied')
  })
})

describe('control service', () => {
  it('queues one manual batch for both ventilation channels', async () => {
    const repository = new MemoryRepository()
    const service = new ControlService(repository, config)

    const result = await service.issueVentilation({
      deviceId: 'room-01',
      action: 'on',
    })

    expect(result.commands.map((command) => command.target)).toEqual([
      'exhaust',
      'intake',
    ])
    expect(new Set(result.commands.map((command) => command.batchId)).size).toBe(1)
    expect(result.commands.every((command) => command.desiredState)).toBe(true)
    expect(result.commands.every((command) => command.source === 'manual')).toBe(true)
    expect((await service.status()).desired).toMatchObject({
      exhaustOn: true,
      intakeOn: true,
    })
  })

  it('creates a synchronized automatic plan for critical CO2', async () => {
    const repository = new MemoryRepository()
    const service = new ControlService(repository, config)
    const commands = await service.reconcile(
      measurementAt(1, new Date(), 1200, false),
      null,
    )

    expect(commands.map((command) => command.target)).toEqual([
      'window',
      'exhaust',
      'intake',
    ])
    expect(new Set(commands.map((command) => command.batchId)).size).toBe(1)
    expect(commands.every((command) => command.source === 'automatic')).toBe(true)
  })

  it('keeps automation from overriding a manual window command', async () => {
    const repository = new MemoryRepository()
    const service = new ControlService(repository, config)
    await service.issue({ deviceId: 'room-01', target: 'window', action: 'open' })

    const commands = await service.reconcile(
      measurementAt(1, new Date(), 1300, false),
      null,
    )

    expect(commands).toEqual([])
    expect((await service.status()).windowMode).toBe('manual')
  })

  it('keeps a manually enabled fan running while air quality is normal', async () => {
    const repository = new MemoryRepository()
    const service = new ControlService(repository, config)
    const result = await service.issue({
      deviceId: 'room-01',
      target: 'exhaust',
      action: 'on',
    })
    await repository.reportControlState({
      deviceId: 'room-01',
      timestamp: new Date('2026-09-06T10:00:00Z'),
      reported: { exhaustOn: true, intakeOn: false, windowOpen: false },
      appliedCommandIds: result.commands.map((command) => command.id),
    })

    const commands = await service.reconcile(
      measurementAt(1, new Date('2026-09-06T10:01:00Z'), 650, false),
      null,
    )

    expect(commands).toEqual([])
    expect((await service.status()).desired.exhaustOn).toBe(true)
  })

  it('stops automatically enabled fans when a normal cycle has no open window', async () => {
    const repository = new MemoryRepository()
    const service = new ControlService(repository, config)
    const started = await repository.queueControlCommands([
      {
        deviceId: 'room-01',
        target: 'exhaust',
        desiredState: true,
        source: 'automatic',
        reason: 'test',
        batchId: 'automatic-on',
      },
      {
        deviceId: 'room-01',
        target: 'intake',
        desiredState: true,
        source: 'automatic',
        reason: 'test',
        batchId: 'automatic-on',
      },
    ])
    await repository.reportControlState({
      deviceId: 'room-01',
      timestamp: new Date('2026-09-06T10:00:00Z'),
      reported: { exhaustOn: true, intakeOn: true, windowOpen: false },
      appliedCommandIds: started.map((command) => command.id),
    })

    const commands = await service.reconcile(
      measurementAt(1, new Date('2026-09-06T10:01:00Z'), 650, false),
      null,
    )

    expect(commands.map((command) => command.target)).toEqual([
      'exhaust',
      'intake',
    ])
    expect(commands.every((command) => command.desiredState === false)).toBe(true)
  })

  it('closes the automatic ventilation batch after CO2 recovers', async () => {
    vi.useFakeTimers()
    try {
      const repository = new MemoryRepository()
      const service = new ControlService(repository, config)
      const openedAt = new Date('2026-09-06T10:00:00Z')
      vi.setSystemTime(openedAt)

      const openedCommands = await repository.queueControlCommands([
        {
          deviceId: 'room-01',
          target: 'window',
          desiredState: true,
          source: 'automatic',
          reason: 'test',
          batchId: 'open-batch',
        },
        {
          deviceId: 'room-01',
          target: 'exhaust',
          desiredState: true,
          source: 'automatic',
          reason: 'test',
          batchId: 'open-batch',
        },
        {
          deviceId: 'room-01',
          target: 'intake',
          desiredState: true,
          source: 'automatic',
          reason: 'test',
          batchId: 'open-batch',
        },
      ])
      await repository.reportControlState({
        deviceId: 'room-01',
        timestamp: openedAt,
        reported: { exhaustOn: true, intakeOn: true, windowOpen: true },
        appliedCommandIds: openedCommands.map((command) => command.id),
      })

      vi.setSystemTime(new Date('2026-09-06T10:06:00Z'))
      const closingCommands = await service.reconcile(
        measurementAt(1, new Date('2026-09-06T10:06:00Z'), 620, true),
        null,
      )

      expect(closingCommands.map((command) => command.target)).toEqual([
        'window',
        'exhaust',
        'intake',
      ])
      expect(closingCommands.every((command) => command.desiredState === false)).toBe(true)
      expect(new Set(closingCommands.map((command) => command.batchId)).size).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ML client', () => {
  it('rejects a malformed successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ predicted_co2_15min: 'bad' }), { status: 200 })),
    )
    const client = new MlClient('http://ml.test', 1000)

    await expect(
      client.predict({
        co2: 700,
        temperature: 23,
        humidity: 45,
        indoor_pm25: 5,
        outdoor_temperature: 18,
        outdoor_humidity: 60,
        outdoor_pm25: 8,
        window_open: false,
        co2_change_5min: 10,
        co2_change_10min: 20,
        hour: 10,
      }),
    ).rejects.toBeInstanceOf(InvalidMlResponseError)
    vi.unstubAllGlobals()
  })
})

describe('air quality service', () => {
  it('validates and persists operator settings for the node', async () => {
    const repository = new MemoryRepository()
    const service = new AirQualityService(repository, { predict: vi.fn() }, config)

    const updated = await service.updateNodeSettings('room-01', {
      automationEnabled: false,
      co2NormalThreshold: 750,
      co2CriticalThreshold: 950,
    })

    expect(updated.automationEnabled).toBe(false)
    expect(updated.co2NormalThreshold).toBe(750)
    await expect(service.updateNodeSettings('room-01', {
      co2CriticalThreshold: 700,
    })).rejects.toThrow(ValidationError)
  })

  it('stores a measurement and prediction after enough history', async () => {
    const repository = new MemoryRepository()
    const predictor = {
      predict: vi.fn(async () => ({
        predictedCo2_15min: 930,
        model: 'linear_regression',
        modelVersion: '1.0',
      })),
    }
    const service = new AirQualityService(repository, predictor, config)
    const start = new Date('2026-09-06T10:00:00Z')
    for (let index = 0; index < 20; index += 1) {
      await repository.createMeasurement(
        inputAt(new Date(start.getTime() + index * 30_000), 650 + index * 3),
      )
    }

    const result = await service.ingest(
      inputAt(new Date(start.getTime() + 20 * 30_000), 710),
    )

    expect(result.predictionStatus).toBe('ready')
    expect(result.prediction?.predictedCo2).toBe(930)
    expect(result.recommendation?.type).toBe('forecast_warning')
    expect(predictor.predict).toHaveBeenCalledOnce()
  })

  it('calculates the rolling retention cutoff from configuration', async () => {
    const repository = new MemoryRepository()
    const service = new AirQualityService(repository, { predict: vi.fn() }, config)
    const now = new Date('2026-09-07T12:00:00Z')

    await repository.createMeasurement(
      inputAt(new Date('2026-09-06T11:59:59Z'), 700),
    )
    await repository.createMeasurement(
      inputAt(new Date('2026-09-06T12:00:01Z'), 710),
    )

    const result = await service.cleanupExpiredData(now)

    expect(result.cutoff).toEqual(new Date('2026-09-06T12:00:00Z'))
    expect(result.measurements).toBe(1)
    expect((await repository.getLatestMeasurement())?.indoor.co2).toBe(710)
  })

  it('keeps the measurement and returns an honest unavailable status without history', async () => {
    const repository = new MemoryRepository()
    const predictor = {
      predict: vi.fn(),
    }
    const service = new AirQualityService(repository, predictor, config)

    const result = await service.ingest(
      inputAt(new Date('2026-09-06T10:00:00Z'), 1150),
    )

    expect(result.measurement.indoor.co2).toBe(1150)
    expect(result.predictionStatus).toBe('insufficient_history')
    expect(result.prediction).toBeNull()
    expect(result.recommendation?.type).toBe('ventilate_now')
    expect(predictor.predict).not.toHaveBeenCalled()
  })

  it('does not turn an invalid ML response into a fake prediction', async () => {
    const repository = new MemoryRepository()
    const predictor = {
      predict: vi.fn(async () => {
        throw new InvalidMlResponseError()
      }),
    }
    const service = new AirQualityService(repository, predictor, config)
    const start = new Date('2026-09-06T10:00:00Z')
    for (let index = 0; index < 20; index += 1) {
      await repository.createMeasurement(
        inputAt(new Date(start.getTime() + index * 30_000), 650),
      )
    }

    const result = await service.ingest(
      inputAt(new Date(start.getTime() + 20 * 30_000), 850),
    )

    expect(result.predictionStatus).toBe('unavailable')
    expect(result.prediction).toBeNull()
    expect(result.predictionError).toContain('ML-сервис')
  })
})
