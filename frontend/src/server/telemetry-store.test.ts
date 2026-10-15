// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { frameFixture } from './test-fixtures/telemetry'
import { MemoryTelemetryStore, telemetryHash, TelemetryConflictError } from './telemetry-store'

describe('raw device telemetry ordering and identity', () => {
  it('keeps partial historical channels and filters the source before the limit', async () => {
    const store = new MemoryTelemetryStore()
    const frame = frameFixture(); frame.sensors[3].status = 'timeout'
    await store.save(frame)
    for (let i=0; i<10; i++) await store.save({ ...frame, sequence: 10+i, data_source: 'simulator' })
    const rows = await store.history('room-01','real',new Date('2026-10-15T11:00:00Z'),new Date('2026-10-15T13:00:00Z'),1)
    expect(rows).toHaveLength(1)
    expect(rows[0].frame.sensors[0].values.co2).toBe(900)
    expect(rows[0].frame.sensors[3].status).toBe('timeout')
  })
  it('accepts a retry once, preserves receipt time, and rejects conflicting reuse', async () => {
    let now = new Date('2026-10-15T12:00:01Z')
    const store = new MemoryTelemetryStore(() => now)
    const original = await store.save(frameFixture())
    now = new Date('2026-10-15T13:00:00Z')
    const retry = await store.save(frameFixture())
    expect(retry.duplicate).toBe(true)
    expect(retry.record).toEqual(original.record)
    const conflicting = frameFixture(); conflicting.sensors[0].values.co2 = 1500
    await expect(store.save(conflicting)).rejects.toBeInstanceOf(TelemetryConflictError)
  })
  it('does not change content hashes when JSON object keys are reordered', () => {
    const frame = frameFixture()
    const { command_results, ...rest } = frame
    const reordered = { command_results, ...rest }
    expect(telemetryHash(reordered)).toBe(telemetryHash(frame))
  })
  it('keeps late and replayed history without rolling the head back', async () => {
    const store = new MemoryTelemetryStore()
    const current = await store.save(frameFixture())
    const late = frameFixture(); late.sequence = 3; late.sampled_at = '2026-10-15T11:59:00Z'
    expect((await store.save(late)).current).toBe(false)
    expect((await store.latest('room-01', 'real'))?.id).toBe(current.record.id)
    late.sequence = 7
    expect((await store.save(late)).current).toBe(false)
  })
  it('moves to a new boot, but never lets a retired boot regain ownership', async () => {
    const store = new MemoryTelemetryStore()
    await store.save(frameFixture())
    const reboot = frameFixture(); reboot.boot_id = 'boot-00000002'; reboot.sequence = 0; reboot.sampled_at = '2026-10-15T12:00:10Z'
    expect((await store.save(reboot)).current).toBe(true)
    const old = frameFixture(); old.sequence = 100; old.sampled_at = '2026-10-15T12:00:20Z'
    expect((await store.save(old)).current).toBe(false)
    expect((await store.latest('room-01', 'real'))?.frame.boot_id).toBe(reboot.boot_id)
  })
  it('isolates physical and virtual devices even when the device id is the same', async () => {
    const store = new MemoryTelemetryStore()
    await store.save(frameFixture())
    const simulation = frameFixture(); simulation.data_source = 'simulator'; simulation.sensors[0].values.co2 = 4000
    await store.save(simulation)
    expect((await store.latest('room-01', 'real'))?.frame.sensors[0].values.co2).toBe(900)
    expect((await store.latest('room-01', 'simulator'))?.frame.sensors[0].values.co2).toBe(4000)
  })
  it('does not let an unsynchronized archive replace a dated state', async () => {
    const store = new MemoryTelemetryStore()
    const original = await store.save(frameFixture())
    const unknown = frameFixture(); unknown.boot_id = 'boot-00000002'; unknown.sampled_at = null; unknown.controller.clock_synced = false
    expect((await store.save(unknown, 'archive')).current).toBe(false)
    expect((await store.latest('room-01', 'real'))?.id).toBe(original.record.id)
  })
  it('shows a live reboot with unknown clock instead of old confirmed state, and rejects its old SD replay', async () => {
    const store = new MemoryTelemetryStore()
    await store.save(frameFixture())
    const reboot = frameFixture(); reboot.boot_id = 'boot-00000002'; reboot.sampled_at = null; reboot.controller.clock_synced = false
    expect((await store.save(reboot)).current).toBe(true)
    const old = frameFixture(); old.sequence=100
    expect((await store.save(old, 'archive')).current).toBe(false)
    expect((await store.latest('room-01','real'))?.frame.boot_id).toBe(reboot.boot_id)
  })
  it('returns independent copies and retains the head when pruning', async () => {
    const store = new MemoryTelemetryStore(() => new Date('2026-10-15T12:00:00Z'))
    const first = await store.save(frameFixture())
    first.record.frame.sensors[0].values.co2 = 8000
    expect((await store.latest('room-01', 'real'))?.frame.sensors[0].values.co2).toBe(900)
    const next = frameFixture(); next.sequence++
    await store.save(next)
    expect(await store.prune(new Date('2026-10-16T12:00:00Z'))).toBe(1)
    expect((await store.latest('room-01', 'real'))?.frame.sequence).toBe(6)
  })
})
