import { describe, expect, it } from 'vitest'

import { getSimulatorBootStage } from './boot-state'

describe('simulator boot stages', () => {
  it('waits for a validated system snapshot first', () => {
    expect(getSimulatorBootStage(false, false, false)).toBe('snapshot')
  })

  it('waits for the renderer after the system snapshot arrives', () => {
    expect(getSimulatorBootStage(true, false, false)).toBe('scene')
  })

  it('waits for the first frame after the renderer is created', () => {
    expect(getSimulatorBootStage(true, true, false)).toBe('frame')
  })

  it('shows the stand only after the first frame is ready', () => {
    expect(getSimulatorBootStage(true, true, true)).toBeNull()
  })
})
