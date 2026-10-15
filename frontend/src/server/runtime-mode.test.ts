// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireDeviceToken } from './access'
import { getConfig } from './config'
import { MemoryRepository } from './repository'
import { AirQualityService } from './service'
import { fetchSimulator } from './simulator'

const physicalToken = 'physical-test-token-' + 'a'.repeat(32)
const virtualToken = 'virtual-test-token-' + 'b'.repeat(32)
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function request(source: string, token: string) { return new Request('https://aircheck.test/api/v1/controls/commands', { headers: { authorization: 'Bearer ' + token, 'x-aircheck-source': source } }) }
function service(repository: MemoryRepository, dataSource: 'real' | 'simulator', mlHistoryLimit = 200) { return new AirQualityService(repository, { predict: vi.fn(async () => ({ predictedCo2_15min: 900, model: 'test', modelVersion: 'test' })) }, { ...getConfig(), dataSource, mlHistoryLimit, automationEnabled: false }) }
function measurement(dataSource: 'real' | 'simulator', co2 = 650, timestamp = new Date()) { return { dataSource, timestamp, indoor: { co2, temperature: 23, humidity: 45, pm25: 5 }, outdoor: { temperature: 18, humidity: 50, pm25: 8 }, windowOpen: false } }

describe('physical/virtual runtime isolation', () => {
  it('requires real scope and the physical credential in real mode', () => {
    vi.stubEnv('AIRCHECK_MODE', 'real'); vi.stubEnv('DEVICE_API_TOKEN', physicalToken); vi.stubEnv('SIMULATOR_DEVICE_TOKEN', virtualToken)
    expect(() => requireDeviceToken(request('real', physicalToken))).not.toThrow()
    expect(() => requireDeviceToken(request('simulator', virtualToken))).toThrow()
    expect(() => requireDeviceToken(request('simulator', physicalToken))).toThrow()
    expect(() => requireDeviceToken(request('real', virtualToken))).toThrow()
    expect(() => requireDeviceToken(new Request('https://aircheck.test/api', { headers: { authorization: 'Bearer ' + physicalToken } }))).toThrow()
  })
  it('uses the separate virtual credential in simulation mode', () => {
    vi.stubEnv('AIRCHECK_MODE', 'simulation'); vi.stubEnv('DEVICE_API_TOKEN', physicalToken); vi.stubEnv('SIMULATOR_DEVICE_TOKEN', virtualToken)
    expect(() => requireDeviceToken(request('simulator', virtualToken))).not.toThrow()
    expect(() => requireDeviceToken(request('simulator', physicalToken))).toThrow()
    expect(() => requireDeviceToken(request('real', physicalToken))).toThrow()
  })
  it('disables the physics proxy in real mode before making a network call', async () => {
    vi.stubEnv('AIRCHECK_MODE', 'real')
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(fetchSimulator('/v1/actions', { method: 'POST' })).rejects.toMatchObject({ code: 'simulation_disabled', status: 403 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('cancels pending commands at a source transition, preserving history and settings', async () => {
    const repository = new MemoryRepository()
    const virtual = service(repository, 'simulator')
    await virtual.nodeSettings()
    await virtual.ingest(measurement('simulator', 3500))
    const { commands } = await virtual.issueControl({ deviceId: 'room-01', target: 'window', action: 'open' })
    const physical = service(repository, 'real')
    await physical.nodeSettings()
    expect((await physical.latest()).measurement).toBeNull()
    expect(await physical.pendingControlCommands()).toHaveLength(0)
    expect((await repository.getControlBatch('room-01', commands[0].id))[0].status).toBe('cancelled')
    expect((await physical.controlsStatus()).knownTargets).toEqual([])
    expect(await repository.listMeasurements({ dataSource: 'simulator', limit: 20 })).toHaveLength(1)
    await expect(physical.ingest(measurement('simulator'))).rejects.toThrow()
    await expect(physical.pendingControlCommands('other-room')).rejects.toThrow()
  })
  it('does not reset commands or confirmed state when the same mode is initialized again', async () => {
    const repository = new MemoryRepository()
    const first = service(repository, 'real'); await first.nodeSettings()
    await first.reportControlState({ deviceId: 'room-01', timestamp: new Date(), reported: { exhaustOn: false, intakeOn: false, windowOpen: true }, appliedCommandIds: [] })
    await first.issueControl({ deviceId: 'room-01', target: 'window', action: 'close' })
    const second = service(repository, 'real'); await second.nodeSettings()
    expect((await second.controlsStatus()).reported.windowOpen).toBe(true)
    expect(await second.pendingControlCommands()).toHaveLength(1)
  })
  it('allows homing to closed when the last boolean is false but feedback is unknown', async () => {
    const repository = new MemoryRepository()
    const physical = service(repository, 'real'); await physical.nodeSettings()
    const result = await physical.issueControl({ deviceId: 'room-01', target: 'window', action: 'close' })
    expect(result.commands).toHaveLength(1)
    expect((await physical.issueControl({ deviceId: 'room-01', target: 'window', action: 'close' })).commands).toHaveLength(0)
  })
  it('filters the ML lookback by source before applying the row limit', async () => {
    const repository = new MemoryRepository()
    const physical = service(repository, 'real', 3); await physical.nodeSettings()
    const now = Date.now()
    await repository.createMeasurement(measurement('real', 600, new Date(now - 600000)))
    await repository.createMeasurement(measurement('real', 650, new Date(now - 300000)))
    for (let i = 0; i < 30; i++) await repository.createMeasurement(measurement('simulator', 4000, new Date(now - i * 1000)))
    const result = await physical.ingest(measurement('real', 700, new Date(now)))
    expect(result.predictionStatus).toBe('ready')
    expect((await physical.history({ limit: 100 })).every(row => row.dataSource === 'real')).toBe(true)
  })
  it('retries a transient initialization failure without needing a browser or restarting state', async () => {
    const repository = new MemoryRepository()
    const activation = vi.spyOn(repository, 'activateMode').mockRejectedValueOnce(new Error('temporary DB failure'))
    const physical = service(repository, 'real')
    await expect(physical.readyForRuntime()).rejects.toThrow('temporary DB failure')
    await physical.readyForRuntime()
    await physical.controlsStatus()
    expect(activation).toHaveBeenCalledTimes(2)
  })
})
