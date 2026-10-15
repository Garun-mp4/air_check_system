// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from './config'
import { frameFixture } from './test-fixtures/telemetry'
import { MemoryTelemetryStore } from './telemetry-store'
import { MemoryRepository } from './repository'
import { AirQualityService } from './service'
import { completeMeasurement, TelemetryService } from './telemetry-service'
import { parseMeasurementInput, parseDeviceStateReport } from './validation'

const now = Date.parse('2026-10-15T12:00:01Z')
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
function setup() {
  const repository = new MemoryRepository()
  const store = new MemoryTelemetryStore()
  const predictor = { predict: vi.fn(async () => ({ predictedCo2_15min: 950, model: 'test', modelVersion: 'test' })) }
  const air = new AirQualityService(repository, predictor, { ...getConfig(), dataSource: 'real', deviceId: 'room-01', automationEnabled: false })
  return { repository, store, predictor, air, service: new TelemetryService(store, repository, air, 'room-01') }
}

describe('telemetry, persistence and confirmed control', () => {
  it('archives a recent frame for history without changing current measurements, feedback, ACK or automation', async () => {
    const { repository, service, air, predictor } = setup()
    const { commands } = await air.issueControl({ deviceId: 'room-01', target: 'window', action: 'open' })
    const frame = frameFixture(); frame.sensors[0].values.co2 = 3000
    frame.actuators.window.position_percent=100; frame.actuators.window.open_limit=true; frame.actuators.window.close_limit=false
    frame.command_results=[{ id: commands[0].id, status: 'applied' }]
    expect((await service.ingest(frame,'archive')).current).toBe(false)
    expect(await repository.getLatestMeasurement()).toBeNull()
    expect(await repository.listMeasurements({ limit: 20 })).toHaveLength(1)
    expect((await repository.listPendingControlCommands('room-01',20))[0].id).toBe(commands[0].id)
    expect((await repository.getControlState('room-01')).lastReportedAt).toBeNull()
    expect(predictor.predict).not.toHaveBeenCalled()
    expect(await repository.getLatestRecommendation()).toBeNull()
  })
  it('projects complete channels, and a retry does not create measurements or recommendations again', async () => {
    const { repository, service } = setup()
    const first = await service.ingest(frameFixture())
    const repeated = await service.ingest(frameFixture())
    expect(repeated.duplicate).toBe(true)
    expect(repeated.measurementId).toBe(first.measurementId)
    expect(await repository.listMeasurements({ limit: 100 })).toHaveLength(1)
    expect((await repository.getLatestRecommendation())?.id).toBe((await repository.getRecommendationForMeasurement(first.measurementId!))?.id)
  })
  it('preserves working sensors when one channel fails and does not fabricate a complete ML vector', async () => {
    const { repository, service } = setup()
    const frame = frameFixture(); frame.sensors[3].status = 'crc'
    expect((await service.ingest(frame)).measurementId).toBeNull()
    const current = await service.latest('real')
    expect(current?.frame.sensors[0].values.co2).toBe(900)
    expect(current?.frame.sensors[3].values.pm25).toBe(12)
    expect(await repository.listMeasurements({ limit: 10 })).toHaveLength(0)
  })
  it('does not acknowledge an opening request while position is unknown or intermediate', async () => {
    const { repository, air, service } = setup()
    const { commands } = await air.issueControl({ deviceId: 'room-01', target: 'window', action: 'open' })
    const frame = frameFixture(); frame.command_results = [{ id: commands[0].id, status: 'applied' }]
    frame.actuators.window.position_quality = 'unknown'; frame.actuators.window.position_percent = null
    await service.ingest(frame)
    expect((await repository.getControlState('room-01')).knownTargets).not.toContain('window')
    expect(await repository.listPendingControlCommands('room-01', 20)).toHaveLength(1)
    frame.sequence++; frame.actuators.window.position_quality = 'measured'; frame.actuators.window.position_percent = 25
    await service.ingest(frame)
    expect(await repository.listPendingControlCommands('room-01', 20)).toHaveLength(1)
    frame.sequence++; frame.actuators.window.position_percent = 100; frame.actuators.window.open_limit = true; frame.actuators.window.close_limit = false
    await service.ingest(frame)
    expect(await repository.listPendingControlCommands('room-01', 20)).toHaveLength(0)
    expect((await repository.getControlState('room-01')).reported.windowOpen).toBe(true)
  })
  it('does not treat GPIO request or coasting rotation as a completed fan command', async () => {
    const { repository, air, service } = setup()
    const { commands } = await air.issueControl({ deviceId: 'room-01', target: 'intake', action: 'on' })
    const frame = frameFixture(); frame.command_results = [{ id: commands[0].id, status: 'applied' }]
    frame.actuators.intake.requested_on = true
    await service.ingest(frame)
    expect(await repository.listPendingControlCommands('room-01', 20)).toHaveLength(1)
    frame.sequence++; frame.actuators.intake.requested_on = false; frame.actuators.intake.rpm = 800
    await service.ingest(frame)
    expect(await repository.listPendingControlCommands('room-01', 20)).toHaveLength(1)
    frame.sequence++; frame.actuators.intake.requested_on = true
    await service.ingest(frame)
    expect(await repository.listPendingControlCommands('room-01', 20)).toHaveLength(0)
  })
  it('records a device refusal without claiming a physical failure', async () => {
    const { repository, air, service } = setup()
    const { commands } = await air.issueControl({ deviceId: 'room-01', target: 'window', action: 'open' })
    const frame = frameFixture(); frame.controller.outputs_commissioned = false
    frame.command_results = [{ id: commands[0].id, status: 'disabled' }]
    await service.ingest(frame)
    const state = await repository.getControlState('room-01')
    expect(state.lastCommand?.status).toBe('failed')
    expect(state.lastCommand?.failureReason).toContain('не введены в эксплуатацию')
    expect(state.knownTargets).toEqual([])
  })
  it('keeps late complete history but does not roll actual state back or apply old ACKs', async () => {
    const { repository, air, service } = setup()
    const current = frameFixture(); current.sequence = 10; current.actuators.window.position_percent = 100; current.actuators.window.open_limit = true; current.actuators.window.close_limit = false
    await service.ingest(current)
    const { commands } = await air.issueControl({ deviceId: 'room-01', target: 'window', action: 'close' })
    const late = frameFixture(); late.sequence = 9; late.sampled_at = '2026-10-15T11:59:00Z'; late.sensors.forEach(sensor => { sensor.last_good_at = late.sampled_at })
    late.command_results = [{ id: commands[0].id, status: 'applied' }]
    expect((await service.ingest(late)).current).toBe(false)
    expect(await repository.listMeasurements({ limit: 10 })).toHaveLength(2)
    expect((await repository.getControlState('room-01')).reported.windowOpen).toBe(true)
    expect(await repository.listPendingControlCommands('room-01', 20)).toHaveLength(1)
  })
  it('does not refresh heartbeat time when the same packet is replayed', async () => {
    const { repository, service } = setup()
    await service.ingest(frameFixture())
    const first = (await repository.getControlState('room-01')).lastReportedAt
    vi.setSystemTime(now + 10000)
    await service.ingest(frameFixture())
    expect((await repository.getControlState('room-01')).lastReportedAt).toEqual(first)
  })
  it('does not accept another device id and does not fabricate a window feature', async () => {
    const { service } = setup()
    const frame = frameFixture(); frame.device_id = 'other-room'
    await expect(service.ingest(frame)).rejects.toThrow()
    frame.actuators.window.position_quality = 'unknown'; frame.actuators.window.position_percent = null
    expect(completeMeasurement(frame)).toBeNull()
  })
})

describe('legacy ingress regression guards', () => {
  it('rejects future measurements and heartbeats before they can poison latest state', () => {
    expect(() => parseMeasurementInput({ timestamp: new Date(now + 6000).toISOString(), indoor: { co2: 600, temperature: 23, humidity: 45, pm25: 5 }, outdoor: { temperature: 18, humidity: 50, pm25: 8 }, window_open: false })).toThrow()
    expect(() => parseDeviceStateReport({ device_id: 'room-01', timestamp: new Date(now + 6000).toISOString(), exhaust_on: false, intake_on: false, window_open: false }, 'room-01')).toThrow()
  })
  it('deduplicates ten concurrent legacy ingests and persists the independent outdoor timestamp', async () => {
    const { repository, air } = setup()
    const frame = completeMeasurement(frameFixture())!
    delete frame.ingestKey
    frame.outdoorSampledAt = new Date(now - 3600000)
    const results = await Promise.all(Array.from({ length: 10 }, () => air.ingest(frame)))
    expect(new Set(results.map(result => result.measurement.id)).size).toBe(1)
    expect(await repository.listMeasurements({ limit: 20 })).toHaveLength(1)
    expect((await repository.getLatestMeasurement())?.outdoorSampledAt).toEqual(frame.outdoorSampledAt)
    expect((await repository.getControlState('room-01')).outdoorSafety?.allowWindow).toBe(false)
  })
})
