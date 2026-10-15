// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assessSensor, controllerWarnings } from '../lib/telemetry'
import { parseTelemetry } from './telemetry-validation'
import { frameFixture } from './test-fixtures/telemetry'

const now = Date.parse('2026-10-15T12:00:00Z')

describe('device telemetry v2', () => {
  it('accepts a complete frame and keeps stable channel identities', () => {
    expect(parseTelemetry(frameFixture(), now)).toEqual(frameFixture())
  })
  it('keeps working sensors and the last good value/time when another fails', () => {
    const frame = frameFixture()
    frame.sensors[3] = { ...frame.sensors[3], status: 'crc', reason: 'checksum', last_good_at: new Date(now - 60000).toISOString(), age_ms: 60000, consecutive_failures: 4 }
    const saved = parseTelemetry(frame, now)
    expect(saved.sensors[0].values.co2).toBe(900)
    expect(saved.sensors[3].values.pm25).toBe(12)
    expect(assessSensor(saved.sensors[3], now).usable).toBe(false)
    expect(assessSensor(saved.sensors[0], now).usable).toBe(true)
  })
  it('accepts a missing sensor without inventing zero or a recent reading', () => {
    const frame = frameFixture()
    frame.sensors[2] = { ...frame.sensors[2], status: 'timeout', reason: 'timeout', values: { pm25: null }, last_good_at: null, age_ms: 30000 }
    expect(parseTelemetry(frame, now).sensors[2].values.pm25).toBeNull()
  })
  it('expires each reading independently even while packets keep arriving', () => {
    const frame = frameFixture()
    frame.sensors[3].last_good_at = new Date(now - 16000).toISOString()
    frame.sensors[3].age_ms = 16000
    const saved = parseTelemetry(frame, now)
    expect(assessSensor(saved.sensors[3], now).quality).toBe('stale')
    expect(assessSensor(saved.sensors[0], now).quality).toBe('ok')
    expect(assessSensor(saved.sensors[0], now + 16000).quality).toBe('stale')
  })
  it.each(['suspect_jump', 'suspect_stuck'] as const)('labels %s as a warning requiring verification', quality => {
    const sensor = { ...frameFixture().sensors[0], status: quality }
    expect(assessSensor(sensor, now).usable).toBe(false)
    expect(assessSensor(sensor, now).message).not.toMatch(/замен|сломан|исправен/)
  })
  it('accepts unknown wall time, but forbids using those readings', () => {
    const frame = frameFixture()
    frame.controller.clock_synced = false; frame.sampled_at = null
    frame.sensors.forEach(sensor => { sensor.last_good_at = null })
    const saved = parseTelemetry(frame, now)
    expect(assessSensor(saved.sensors[0], now, saved.controller.clock_synced).quality).toBe('unknown')
  })
  it('rejects future frames and readings, including a poisoned heartbeat', () => {
    const frame = frameFixture()
    frame.sampled_at = new Date(now + 5001).toISOString()
    expect(() => parseTelemetry(frame, now)).toThrow()
    frame.sampled_at = new Date(now).toISOString(); frame.sensors[0].last_good_at = new Date(now + 6000).toISOString()
    expect(() => parseTelemetry(frame, now)).toThrow()
  })
  it('rejects duplicate sensor ids, unknown sources, invalid values and unsafe sequence integers', () => {
    const frame = frameFixture()
    frame.sensors[3] = { ...frame.sensors[2] }
    expect(() => parseTelemetry(frame, now)).toThrow()
    expect(() => parseTelemetry({ ...frameFixture(), data_source: 'unknown' }, now)).toThrow()
    expect(() => parseTelemetry({ ...frameFixture(), sequence: Number.MAX_SAFE_INTEGER + 1 }, now)).toThrow()
    const invalid = frameFixture(); invalid.sensors[0].values.co2 = Number.NaN
    expect(() => parseTelemetry(invalid, now)).toThrow()
  })
  it('rejects refreshing the timestamp of a retained old value', () => {
    const frame = frameFixture()
    frame.sensors[0].last_good_at = new Date(now - 60000).toISOString()
    expect(() => parseTelemetry(frame, now)).toThrow()
  })
  it('requires explicit unknown/estimated/measured semantics for window and fan feedback', () => {
    const frame = frameFixture()
    frame.actuators.window.position_percent = null
    expect(() => parseTelemetry(frame, now)).toThrow()
    frame.actuators.window.position_quality = 'unknown'
    frame.actuators.exhaust.status = 'unknown'; frame.actuators.exhaust.rpm = null
    expect(parseTelemetry(frame, now).actuators.window.position_percent).toBeNull()
  })
  it('explains watchdog, brownout, low memory, contradictory limits and unknown feedback', () => {
    const frame = frameFixture()
    frame.controller.reset_reason = 6; frame.controller.minimum_free_heap = 16000
    frame.actuators.window.open_limit = true
    frame.actuators.intake.requested_on = true; frame.actuators.intake.status = 'unknown'; frame.actuators.intake.rpm = null
    expect(controllerWarnings(frame).join(' ')).toMatch(/watchdog.*памяти.*концевики.*не подтверждено/)
    frame.controller.reset_reason = 9
    expect(controllerWarnings(frame).join(' ')).toContain('brownout')
  })
})
