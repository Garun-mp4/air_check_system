import { describe, it, expect } from 'vitest'
import { emptyCondition, stepCondition } from './notification-policy'
describe('persistent notification episodes', () => {
  it('requires dwell, emits once during a continuing violation, then recovery', () => {
    let result = stepCondition(emptyCondition, true, 0, 5000, 30000, 10000)
    expect(result.event).toBeNull()
    result = stepCondition(result.state, true, 4999, 5000, 30000, 10000)
    expect(result.event).toBeNull()
    result = stepCondition(result.state, true, 5000, 5000, 30000, 10000)
    expect(result.event).toBe('problem')
    result = stepCondition(result.state, true, 9000, 5000, 30000, 10000)
    expect(result.event).toBeNull()
    result = stepCondition(result.state, false, 10000, 5000, 30000, 10000)
    expect(result.event).toBe('recovery')
    expect(
      stepCondition(result.state, false, 11000, 5000, 30000, 10000).event,
    ).toBeNull()
    result = stepCondition(result.state, true, 12000, 5000, 30000, 10000)
    expect(
      stepCondition(result.state, true, 18000, 5000, 30000, 10000).event,
    ).toBeNull() // suppression
  })
  it('unknown air never announces recovery and restarts unannounced dwell', () => {
    const initial = stepCondition(emptyCondition, true, 0, 5000, 0, 10000).state
    const missing = stepCondition(initial, null, 4000, 5000, 0, 10000)
    expect(missing.state.since).toBeNull()
    expect(
      stepCondition(missing.state, true, 5000, 5000, 0, 10000).event,
    ).toBeNull()
    const active = stepCondition(emptyCondition, true, 0, 0, 0, 10000).state
    expect(stepCondition(active, null, 20000, 0, 0, 10000)).toMatchObject({
      event: null,
      state: { active: true },
    })
  })
  it('does not bridge a worker outage into the required dwell', () => {
    const previous = stepCondition(
      emptyCondition,
      true,
      0,
      5000,
      0,
      10000,
    ).state
    const result = stepCondition(previous, true, 20000, 5000, 0, 10000)
    expect(result.event).toBeNull()
    expect(result.state.since).toBe(20000)
  })
})
