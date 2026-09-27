// @vitest-environment jsdom

import { createElement, createRef } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsPanel } from './AirDashboard'
import type { ClientNodeSettings } from '../lib/client-api'

const settings: ClientNodeSettings = {
  device_id: 'room-01',
  automation_enabled: true,
  auto_window_enabled: true,
  manual_override_minutes: 30,
  auto_ventilation_minimum_minutes: 5,
  co2_normal_threshold: 800,
  co2_critical_threshold: 1000,
  pm25_good_limit: 15,
  pm25_elevated_limit: 35,
  alerts_enabled: true,
  retention_hours: 24,
  updated_at: '2026-09-09T10:00:00Z',
}

function renderSettings(overrides: Partial<Parameters<typeof SettingsPanel>[0]> = {}) {
  return render(createElement(SettingsPanel, {
    presentation: 'page',
    controls: null,
    deviceId: 'room-01',
    measurement: null,
    prediction: null,
    systemStatus: 'в сети',
    systemTone: 'success',
    tab: 'thresholds',
    onTabChange: vi.fn(),
    onClose: vi.fn(),
    closeButtonRef: createRef<HTMLButtonElement>(),
    settings,
    settingsError: null,
    settingsSaving: false,
    settingsNotice: null,
    canEdit: false,
    onSave: vi.fn(async () => undefined),
    ...overrides,
  }))
}

afterEach(() => cleanup())

describe('settings panel accessibility and role presentation', () => {
  it('connects the selected tab to its panel with matching accessible relationships', () => {
    renderSettings()

    const tablist = screen.getByRole('tablist', { name: 'Разделы настроек' })
    const selectedTab = within(tablist).getByRole('tab', { selected: true })
    const panelId = selectedTab.getAttribute('aria-controls')
    const panel = panelId ? document.getElementById(panelId) : null

    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('role')).toBe('tabpanel')
    expect(panel?.getAttribute('aria-labelledby')).toBe(selectedTab.id)
  })

  it('keeps settings inputs read-only when the session cannot edit settings', () => {
    renderSettings()

    const panel = screen.getByRole('tabpanel')
    const thresholdInputs = within(panel).getAllByRole('spinbutton')

    expect(thresholdInputs.length).toBeGreaterThan(0)
    expect(thresholdInputs.every((input) => (input as HTMLInputElement).matches(':disabled'))).toBe(true)
    expect(within(panel).getByRole('link').getAttribute('href')).toMatch(/^\/login/)
  })

  it('announces a settings load or validation error as an alert', () => {
    renderSettings({ settingsError: 'Settings could not be saved.' })

    expect(screen.getByRole('alert').textContent).toContain('Settings could not be saved.')
  })
})
