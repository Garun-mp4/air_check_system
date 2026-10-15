// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest'
import { realSystemSnapshot } from './system-snapshot'
import { frameFixture } from './test-fixtures/telemetry'
import { getConfig } from './config'
import { MemoryRepository } from './repository'
import { AirQualityService } from './service'
import { liveMeasurement, mergeObservationHistory } from '../lib/telemetry-view'
import { isSystemSnapshot } from '../components/simulator/useSimulatorState'
import { createStateStream } from './state-stream'

afterEach(() => vi.useRealTimers())
async function fixture() {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
  const service = new AirQualityService(new MemoryRepository(), { predict: vi.fn() }, { ...getConfig(), automationEnabled: false })
  await service.reportControlState({ deviceId: 'room-01', timestamp: new Date(), reported: { windowOpen: false, exhaustOn: false, intakeOn: false }, appliedCommandIds: [] })
  const controls = await service.controlsStatus(), settings = await service.nodeSettings(), dashboard = await service.latest()
  return { controls, settings, dashboard, record: { id: 1, received_at: new Date().toISOString(), frame: frameFixture() } }
}
describe('shared real system state', () => {
  it('updates healthy live history during a partial failure without colliding with legacy IDs or retaining an old range', async () => {
    const { record } = await fixture()
    record.frame.sensors[3].status = 'timeout'
    const current = liveMeasurement(record, null)!
    const legacy = { ...current, observation_key: undefined, timestamp: new Date(Date.now()-5000).toISOString() }
    const merged = mergeObservationHistory([legacy], current, Date.now()-10000)
    expect(merged).toHaveLength(2)
    expect(merged[1].indoor.co2).toBe(900); expect(merged[1].outdoor.pm25).toBeNull()
    expect(mergeObservationHistory(merged, current, Date.now()-10000)).toHaveLength(2)
    expect(mergeObservationHistory(merged, current, Date.now()-10000,1)).toEqual([current])
    expect(mergeObservationHistory(merged, current, Date.now()+1000)).toEqual([])
  })
  it('keeps actual readings, static geometry and unknown unmeasured power/flow without physics', async () => {
    const { record, controls, settings, dashboard } = await fixture()
    const snapshot = realSystemSnapshot(record, controls, settings, dashboard)
    expect(isSystemSnapshot(snapshot)).toBe(true)
    expect(snapshot.indoor.co2_ppm).toBe(900)
    expect(snapshot.outdoor.co2_ppm).toBeNull()
    expect(snapshot.energy.fan_energy_wh).toBeNull()
    expect(snapshot.ventilation.intake.airflow_m3_h).toBeNull()
    expect(snapshot.window.reed_switch).toBeNull()
    expect(snapshot.simulation.scenarios).toEqual([])
    expect(() => realSystemSnapshot({ ...record, frame: { ...record.frame, data_source: 'simulator' } }, controls, settings, dashboard)).toThrow()
  })
  it('freezes stale movement and does not present stale rotation as active', async () => {
    const { record, controls, settings, dashboard } = await fixture()
    record.frame.actuators.window.motion = 'opening'; record.frame.actuators.intake.rpm = 1000
    const snapshot = realSystemSnapshot(record, { ...controls, connectionStatus: 'offline' }, settings, dashboard)
    expect(snapshot.window.motor_state).toBe('unknown')
    expect(snapshot.window.position_quality).toBe('stale')
    expect(snapshot.ventilation.intake.enabled).toBeNull()
  })
  it('preserves healthy channels and last good diagnostics without reusing a failed value as current', async () => {
    const { record } = await fixture()
    record.frame.sensors[3].status = 'timeout'
    const current = liveMeasurement(record, null)
    expect(current?.indoor.co2).toBe(900)
    expect(current?.indoor.pm25).toBe(8)
    expect(current?.outdoor.pm25).toBeNull()
    expect(record.frame.sensors[3].values.pm25).toBe(12)
    record.frame.sensors[0].status = 'timeout'
    expect(liveMeasurement(record, null)?.indoor.co2).toBeNull()
    expect(liveMeasurement(record, null)?.indoor.pm25).toBe(8)
    record.frame.actuators.window.open_limit = true
    expect(liveMeasurement(record, null)?.window_open).toBeNull()
    expect(liveMeasurement(record, null, Date.now() + 16000)?.indoor.co2).toBeNull()
  })
  it('shows no default confirmed position when no device report exists', async () => {
    const { controls, settings, dashboard } = await fixture()
    const snapshot = realSystemSnapshot(null, { ...controls, connectionStatus: 'offline' }, settings, dashboard)
    expect(snapshot.window.actual_position_percent).toBeNull()
    expect(snapshot.ventilation.intake.enabled).toBeNull()
    expect(snapshot.sensors.every(sensor => !sensor.online)).toBe(true)
  })
})
describe('real snapshot stream', () => {
  it('recovers after a producer error and releases work after cancellation', async () => {
    const abort = new AbortController()
    const produce = vi.fn().mockRejectedValueOnce(new Error('private error')).mockResolvedValue({ revision: 1 })
    const reader = createStateStream(abort.signal, produce, 1).getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('event: stream_error'); expect(first).not.toContain('private error')
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"revision":1')
    await reader.cancel(); const count = produce.mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(produce).toHaveBeenCalledTimes(count)
  })
  it('does not produce when already aborted', async () => {
    const abort = new AbortController(); abort.abort(); const produce = vi.fn()
    expect((await createStateStream(abort.signal, produce).getReader().read()).done).toBe(true)
    expect(produce).not.toHaveBeenCalled()
  })
})
