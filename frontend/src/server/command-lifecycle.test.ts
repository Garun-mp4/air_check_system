import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlService } from './control-service'
import { getConfig } from './config'
import { MemoryRepository } from './repository'
import { parseDeviceStateReport } from './validation'

const input = (
  target: 'window' | 'exhaust' | 'intake' = 'exhaust',
  desiredState = true,
  source: 'manual' | 'automatic' = 'manual',
  batchId = 'batch',
) => ({
  deviceId: 'room-01',
  target,
  desiredState,
  source,
  batchId,
  reason: 'test',
})
const report = (ids: number[], on = true) => ({
  deviceId: 'room-01',
  timestamp: new Date(),
  reported: { exhaustOn: on, intakeOn: false, windowOpen: false },
  appliedCommandIds: ids,
})
afterEach(() => vi.useRealTimers())
describe('command lifecycle', () => {
  it('expires commands before polling and ignores a late ACK, while tracking actual state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
    const r = new MemoryRepository()
    const [command] = await r.queueControlCommands([input()])
    vi.advanceTimersByTime(300_000)
    expect(await r.listPendingControlCommands('room-01', 20)).toEqual([])
    const state = await r.reportControlState(report([command.id]))
    expect(state.lastCommand?.status).toBe('expired')
    expect(state.lastCommand?.completedAt).toBeInstanceOf(Date)
    expect(state.reported.exhaustOn).toBe(true)
    expect(state.desired.exhaustOn).toBe(true)
  })
  it('supersedes the pending opposite action and deduplicates concurrent identical requests', async () => {
    const r = new MemoryRepository()
    const [old] = await r.queueControlCommands([input()])
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        r.queueControlCommands([input('exhaust', false, 'manual', 'off')]),
      ),
    )
    expect(results.flat()).toHaveLength(1)
    expect((await r.getControlBatch('room-01', old.id))[0].status).toBe(
      'cancelled',
    )
    await r.reportControlState(report([old.id]))
    expect((await r.getControlState('room-01')).pendingCommands).toBe(1)
  })
  it('cancels only the pending part of a partially applied batch', async () => {
    const r = new MemoryRepository()
    const commands = await r.queueControlCommands([input(), input('intake')])
    await r.reportControlState(report([commands[0].id]))
    const s = await r.cancelControlBatch('room-01', commands[0].id)
    expect(s.recentCommands?.map((c) => c.status)).toEqual([
      'cancelled',
      'applied',
    ])
    expect(s.desired.intakeOn).toBe(false)
    expect(s.desired.exhaustOn).toBe(true)
  })
  it('accepts device errors and does not retry the same failed automatic command forever', async () => {
    const r = new MemoryRepository()
    const [command] = await r.queueControlCommands([
      input('exhaust', true, 'automatic'),
    ])
    await r.reportControlState({
      ...report([], false),
      failedCommands: [{ id: command.id, reason: 'motor blocked' }],
    })
    expect(
      (await r.getControlState('room-01')).lastCommand?.failureReason,
    ).toBe('motor blocked')
    expect(
      await r.queueControlCommands([input('exhaust', true, 'automatic')]),
    ).toEqual([])
    expect(
      await r.queueControlCommands([input('exhaust', true, 'manual', 'retry')]),
    ).toHaveLength(1)
  })
  it('retries only unresolved batch targets with fresh ids and refuses pending/all-applied batches', async () => {
    const r = new MemoryRepository()
    const service = new ControlService(r, getConfig())
    const commands = await r.queueControlCommands([input(), input('intake')])
    await expect(
      service.commandAction('room-01', commands[0].id, 'retry'),
    ).rejects.toThrow()
    await r.reportControlState({
      ...report([commands[0].id]),
      failedCommands: [{ id: commands[1].id, reason: 'blocked' }],
    })
    const retry = await service.commandAction(
      'room-01',
      commands[0].id,
      'retry',
    )
    expect(retry.commands.map((c) => c.target)).toEqual(['intake'])
    expect(retry.commands[0].id).not.toBe(commands[1].id)
    expect(retry.commands[0].source).toBe('manual')
    expect(
      (await r.getControlBatch('room-01', commands[0].id)).map((c) => c.status),
    ).toEqual(['applied', 'failed'])
  })
  it('validates failure payloads and disallows conflicting ACKs', () => {
    const body = {
      device_id: 'room-01',
      timestamp: new Date().toISOString(),
      exhaust_on: false,
      intake_on: false,
      window_open: false,
      failed_commands: [{ id: 1, reason: 'blocked' }],
    }
    expect(parseDeviceStateReport(body, 'room-01').failedCommands).toEqual([
      { id: 1, reason: 'blocked' },
    ])
    expect(() =>
      parseDeviceStateReport({ ...body, applied_command_ids: [1] }, 'room-01'),
    ).toThrow()
    expect(() =>
      parseDeviceStateReport(
        { ...body, failed_commands: [{ id: -1, reason: '' }] },
        'room-01',
      ),
    ).toThrow()
  })
})
