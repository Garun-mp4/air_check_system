// @vitest-environment jsdom
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OutdoorPolicyPanel from './OutdoorPolicyPanel'
import { defaultOutdoorPolicy } from '../server/outdoor-policy'
import type { ClientNodeSettings } from '../lib/client-api'
afterEach(cleanup)
const settings = {
  outdoor_policy: defaultOutdoorPolicy,
  updated_at: new Date().toISOString(),
} as ClientNodeSettings
describe('outdoor settings', () => {
  it('saves confirmed capabilities and validates recovery thresholds before sending', () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(
      React.createElement(OutdoorPolicyPanel, {
        settings,
        canEdit: true,
        saving: false,
        onSave: save,
      }),
    )
    fireEvent.change(
      screen.getByLabelText('Возобновить при PM2.5 ниже, µg/m³'),
      { target: { value: '40' } },
    )
    expect(screen.getByRole('alert').textContent).toContain(
      'Порог восстановления',
    )
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.change(
      screen.getByLabelText('Возобновить при PM2.5 ниже, µg/m³'),
      { target: { value: '28' } },
    )
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button'))
    expect(save).toHaveBeenCalledWith({
      outdoor_policy: {
        ...defaultOutdoorPolicy,
        pm25Recovery: 28,
        filteredIntake: true,
      },
    })
  })
  it('disables modifications for viewers', () => {
    render(
      React.createElement(OutdoorPolicyPanel, {
        settings,
        canEdit: false,
        saving: false,
        onSave: vi.fn(),
      }),
    )
    expect(screen.getByRole('group').hasAttribute('disabled')).toBe(true)
  })
})
