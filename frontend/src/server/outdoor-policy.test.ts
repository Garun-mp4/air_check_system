import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  assessOutdoor,
  defaultOutdoorPolicy,
  validateOutdoorPolicy,
} from './outdoor-policy'
import { MemoryRepository } from './repository'
import { ControlService } from './control-service'
import { getConfig } from './config'
import { evaluateRecommendation } from './recommendation'
import { getNodeSettingsDefaults } from './settings'
import type { Measurement } from './types'
const current = (pm25 = 8, temperature = 18, co2 = 1200): Measurement => ({
  dataSource: 'simulator',
  id: 1,
  createdAt: new Date(),
  timestamp: new Date(),
  indoor: { co2, temperature: 23, humidity: 45, pm25: 5 },
  outdoor: { pm25, temperature, humidity: 60 },
  windowOpen: false,
})
afterEach(() => vi.useRealTimers())
describe('outdoor air policy', () => {
  it('latches pollution/cold limits until recovery thresholds and rejects stale/missing data', () => {
    const blocked = assessOutdoor(current(36, 4), defaultOutdoorPolicy)
    const still = assessOutdoor(current(34, 6), defaultOutdoorPolicy, blocked)
    expect(still.allowWindow).toBe(false)
    expect(still.pollutionBlocked).toBe(true)
    expect(still.coldBlocked).toBe(true)
    const safe = assessOutdoor(current(29, 8), defaultOutdoorPolicy, still)
    expect(safe.allowWindow).toBe(true)
    expect(
      assessOutdoor(
        { ...current(), timestamp: new Date(Date.now() - 91_000) },
        defaultOutdoorPolicy,
      ).unavailable,
    ).toBe(true)
    expect(
      assessOutdoor(current(NaN), defaultOutdoorPolicy).allowVentilation,
    ).toBe(false)
    expect(
      assessOutdoor(current(40), {
        ...defaultOutdoorPolicy,
        filteredIntake: true,
      }).allowVentilation,
    ).toBe(true)
    expect(
      assessOutdoor(current(40, -5), {
        ...defaultOutdoorPolicy,
        filteredIntake: true,
      }).allowVentilation,
    ).toBe(false)
  })
  it('rejects invalid recovery settings and unknown capability fields', () => {
    expect(() =>
      validateOutdoorPolicy({ ...defaultOutdoorPolicy, pm25Recovery: 35 }),
    ).toThrow()
    expect(() =>
      validateOutdoorPolicy({
        ...defaultOutdoorPolicy,
        filteredIntake: 'true',
      }),
    ).toThrow()
    expect(() =>
      validateOutdoorPolicy({ ...defaultOutdoorPolicy, secret: 'no' }),
    ).toThrow()
  })
  it.each([
    { pm: 40, temp: 18, filtered: false, targets: [] },
    { pm: 40, temp: 18, filtered: true, targets: ['exhaust', 'intake'] },
    { pm: 8, temp: -5, filtered: true, targets: [] },
    {
      pm: 8,
      temp: 18,
      filtered: false,
      targets: ['window', 'exhaust', 'intake'],
    },
  ])(
    'agrees with recommendations for $pm PM2.5 / $temp °C / filter $filtered',
    async ({ pm, temp, filtered, targets }) => {
      const r = new MemoryRepository(),
        config = getConfig(),
        service = new ControlService(r, config)
      const defaults = getNodeSettingsDefaults(config)
      await r.updateNodeSettings(
        config.deviceId,
        {
          outdoorPolicy: { ...defaultOutdoorPolicy, filteredIntake: filtered },
        },
        defaults,
      )
      const m = current(pm, temp)
      const safety = await r.assessOutdoorAir(config.deviceId, m, {
        ...defaultOutdoorPolicy,
        filteredIntake: filtered,
      })
      const commands = await service.reconcile(m, null, safety)
      expect(commands.map((c) => c.target)).toEqual(targets)
      const recommendation = evaluateRecommendation(m, null, {
        normal: 800,
        critical: 1000,
        outdoorSafety: safety,
      })
      if (!safety.allowWindow) {
        expect(recommendation.reason).toBe(safety.reason)
        expect(recommendation.message).not.toContain('Откройте окно')
      }
    },
  )
  it('holds filtered ventilation for the minimum duration, but shuts it down on unsafe temperature', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
    const r = new MemoryRepository(),
      config = getConfig(),
      service = new ControlService(r, config)
    await r.updateNodeSettings(
      config.deviceId,
      { outdoorPolicy: { ...defaultOutdoorPolicy, filteredIntake: true } },
      getNodeSettingsDefaults(config),
    )
    const activation = await service.reconcile(current(40), null)
    await r.reportControlState({
      deviceId: config.deviceId,
      timestamp: new Date(),
      reported: { exhaustOn: true, intakeOn: true, windowOpen: false },
      appliedCommandIds: activation.map((c) => c.id),
    })
    vi.setSystemTime(new Date('2026-10-08T00:01:00Z'))
    expect(await service.reconcile(current(40, 18, 650), null)).toEqual([])
    const shutdown = await service.reconcile(current(40, -5, 650), null)
    expect(shutdown.map((c) => c.target)).toEqual(['exhaust', 'intake'])
    expect(shutdown.every((c) => !c.desiredState)).toBe(true)
  })
  it('refreshes safety after telemetry stops and closes only automatic equipment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
    const r = new MemoryRepository(),
      config = getConfig(),
      service = new ControlService(r, config)
    const m = await r.createMeasurement(current())
    const activation = await service.reconcile(m, null)
    await r.reportControlState({
      deviceId: config.deviceId,
      timestamp: new Date(),
      reported: { exhaustOn: true, intakeOn: true, windowOpen: true },
      appliedCommandIds: activation.map((c) => c.id),
    })
    vi.setSystemTime(new Date('2026-10-08T00:01:40Z'))
    const state = await service.status()
    expect(state.outdoorSafety?.unavailable).toBe(true)
    expect(
      (await r.listPendingControlCommands(config.deviceId, 20)).map(
        (c) => c.target,
      ),
    ).toEqual(['window', 'exhaust', 'intake'])
    expect(
      (await r.listPendingControlCommands(config.deviceId, 20)).every(
        (c) => !c.desiredState,
      ),
    ).toBe(true)
  })
  it('preserves manual window override even in conflicting outdoor conditions', async () => {
    const r = new MemoryRepository(),
      config = getConfig(),
      service = new ControlService(r, config)
    await service.issue({
      deviceId: config.deviceId,
      target: 'window',
      action: 'open',
    })
    expect(await service.reconcile(current(120, -5), null)).toEqual([])
  })
})
