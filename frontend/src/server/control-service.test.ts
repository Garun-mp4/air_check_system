import { describe, expect, it, vi } from 'vitest'

import type { AppConfig } from './config'
import { ControlService } from './control-service'
import { MemoryRepository } from './repository'
import { getNodeSettingsDefaults } from './settings'
import type { Measurement, Prediction } from './types'

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

function measurement(co2: number, windowOpen = false): Measurement {
  const timestamp = new Date()
  return {
    id: 1,
    timestamp,
    indoor: { co2, temperature: 23, humidity: 45, pm25: 5 },
    outdoor: { temperature: 18, humidity: 60, pm25: 8 },
    windowOpen,
    createdAt: timestamp,
  }
}

function prediction(predictedCo2: number): Prediction {
  const timestamp = new Date()
  return {
    id: 1,
    createdAt: timestamp,
    targetTime: new Date(timestamp.getTime() + 15 * 60_000),
    predictedCo2,
    modelName: 'test-model',
    modelVersion: '1',
  }
}

describe('climate control service', () => {
  it('queues a manual actuator command once while it remains pending', async () => {
    const repository = new MemoryRepository()
    const service = new ControlService(repository, config)
    const request = {
      deviceId: 'room-01',
      target: 'exhaust' as const,
      action: 'on' as const,
    }

    const first = await service.issue(request)
    const repeated = await service.issue(request)

    expect(first.commands).toHaveLength(1)
    expect(first.commands[0]).toMatchObject({
      deviceId: 'room-01',
      target: 'exhaust',
      desiredState: true,
      source: 'manual',
      status: 'pending',
    })
    expect(repeated.commands).toEqual([])
    expect(await service.pendingCommands('room-01')).toEqual(first.commands)
  })

  it('sets a timed window override and releases it when the operator selects auto', async () => {
    vi.useFakeTimers()
    try {
      const now = new Date('2026-09-28T10:00:00Z')
      vi.setSystemTime(now)
      const repository = new MemoryRepository()
      await repository.updateNodeSettings(
        'room-01',
        { manualOverrideMinutes: 12 },
        getNodeSettingsDefaults(config),
      )
      const service = new ControlService(repository, config)

      const opened = await service.issue({
        deviceId: 'room-01',
        target: 'window',
        action: 'open',
      })

      expect(opened.commands).toHaveLength(1)
      expect(opened.status.windowMode).toBe('manual')
      expect(opened.status.overrideUntil).toEqual(
        new Date(now.getTime() + 12 * 60_000),
      )
      expect(opened.status.automation.status).toBe('manual_override')

      const returnedToAuto = await service.issue({
        deviceId: 'room-01',
        target: 'window',
        action: 'auto',
      })

      expect(returnedToAuto.commands).toEqual([])
      expect(returnedToAuto.status.windowMode).toBe('auto')
      expect(returnedToAuto.status.overrideUntil).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resumes automation when the manual window override expires', async () => {
    vi.useFakeTimers()
    try {
      const openedAt = new Date('2026-09-28T10:00:00Z')
      vi.setSystemTime(openedAt)
      const repository = new MemoryRepository()
      const service = new ControlService(repository, config)

      await service.issue({ deviceId: 'room-01', target: 'window', action: 'open' })
      vi.setSystemTime(new Date(openedAt.getTime() + 31 * 60_000))

      const commands = await service.reconcile(measurement(1200), null)

      expect(commands.map((command) => command.target)).toEqual(['exhaust', 'intake'])
      expect(commands.every((command) => command.source === 'automatic')).toBe(true)
      expect((await service.status()).windowMode).toBe('auto')
    } finally {
      vi.useRealTimers()
    }
  })

  it('repeats pending commands for an offline node until the node reports state', async () => {
    const repository = new MemoryRepository()
    const service = new ControlService(repository, config)
    const issued = await service.issue({
      deviceId: 'room-01',
      target: 'intake',
      action: 'on',
    })

    const firstPoll = await service.pendingCommands('room-01')
    const secondPoll = await service.pendingCommands('room-01')

    expect(issued.status.connectionStatus).toBe('offline')
    expect(issued.status.automation.status).toBe('waiting_for_device')
    expect(firstPoll.map((command) => command.id)).toEqual([issued.commands[0].id])
    expect(secondPoll.map((command) => command.id)).toEqual([issued.commands[0].id])
    expect((await service.status()).pendingCommands).toBe(1)
  })

  it('creates one automatic batch for window and both fans when only the forecast is critical', async () => {
    const repository = new MemoryRepository()
    const service = new ControlService(repository, config)

    const commands = await service.reconcile(measurement(700), prediction(1100))

    expect(commands.map((command) => command.target)).toEqual([
      'window',
      'exhaust',
      'intake',
    ])
    expect(commands.every((command) => command.source === 'automatic')).toBe(true)
    expect(new Set(commands.map((command) => command.batchId)).size).toBe(1)
  })

  it('honors node settings that disable automation or automatic window operation', async () => {
    const disabledRepository = new MemoryRepository()
    const defaults = getNodeSettingsDefaults(config)
    await disabledRepository.updateNodeSettings(
      'room-01',
      { automationEnabled: false },
      defaults,
    )
    const disabledService = new ControlService(disabledRepository, config)

    expect(await disabledService.reconcile(measurement(1200), null)).toEqual([])

    const fansOnlyRepository = new MemoryRepository()
    await fansOnlyRepository.updateNodeSettings(
      'room-01',
      { autoWindowEnabled: false },
      defaults,
    )
    const fansOnlyService = new ControlService(fansOnlyRepository, config)

    const commands = await fansOnlyService.reconcile(measurement(1200), null)

    expect(commands.map((command) => command.target)).toEqual(['exhaust', 'intake'])
  })

  it('keeps an acknowledged command pending when actual state disagrees with desired state', async () => {
    const repository = new MemoryRepository()
    const [command] = await repository.queueControlCommands([
      {
        deviceId: 'room-01',
        target: 'exhaust',
        desiredState: true,
        source: 'manual',
        reason: 'test',
        batchId: 'actual-state-mismatch',
      },
    ])

    const state = await repository.reportControlState({
      deviceId: 'room-01',
      timestamp: new Date(),
      reported: { exhaustOn: false, intakeOn: false, windowOpen: false },
      appliedCommandIds: [command.id],
    })

    expect(state.reported.exhaustOn).toBe(false)
    expect(state.desired.exhaustOn).toBe(true)
    expect(state.pendingCommands).toBe(1)
    expect(state.lastCommand?.status).toBe('pending')
  })
})
