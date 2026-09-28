// @vitest-environment jsdom

import { createElement } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AirDashboard, { DASHBOARD_LIVE_REFRESH_INTERVAL_MS, DashboardNavigation } from './AirDashboard'
import type {
  ClientControlStatus,
  ClientMeasurement,
  ClientNodeSettings,
  DashboardData,
} from '../lib/client-api'

const mocks = vi.hoisted(() => ({
  useAccessSession: vi.fn(),
  getLatestDashboard: vi.fn(),
  getHistory: vi.fn(),
  getNodeSettings: vi.fn(),
  getControlStatus: vi.fn(),
  sendControlCommand: vi.fn(),
  sendVentilationCommand: vi.fn(),
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  Object.assign(globalThis, { React: actual })
  return actual
})

vi.mock('../lib/client-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/client-api')>()
  return {
    ...actual,
    getLatestDashboard: mocks.getLatestDashboard,
    getHistory: mocks.getHistory,
    getNodeSettings: mocks.getNodeSettings,
    getControlStatus: mocks.getControlStatus,
    sendControlCommand: mocks.sendControlCommand,
    sendVentilationCommand: mocks.sendVentilationCommand,
  }
})

vi.mock('./auth/AccessSessionProvider', () => ({
  useAccessSession: mocks.useAccessSession,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}))

vi.mock('./Charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./Charts')>()
  return { ...actual, LineChart: () => null }
})

const measurement: ClientMeasurement = {
  id: 1,
  created_at: '2026-09-09T10:00:00Z',
  timestamp: '2026-09-09T10:00:00Z',
  indoor: { co2: 650, temperature: 23.1, humidity: 45, pm25: 5.3 },
  outdoor: { temperature: 17.8, humidity: 59, pm25: 9.0 },
  window_open: false,
}

const dashboardData: DashboardData = {
  measurement,
  prediction: null,
  recommendation: null,
}

const nodeSettings: ClientNodeSettings = {
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

const controlStatus: ClientControlStatus = {
  device_id: 'room-01',
  connection: { status: 'online', last_seen_at: '2026-09-09T10:00:00Z' },
  reported: { exhaust_on: false, intake_on: false, window_open: false },
  desired: { exhaust_on: false, intake_on: false, window_open: false },
  window: { mode: 'auto', override_until: null, open_since: null },
  automation: { enabled: true, status: 'ready', message: 'Ready' },
  pending_commands: 0,
  last_command: null,
  updated_at: '2026-09-09T10:00:00Z',
}

function setSession(role: 'user' | 'operator' | 'owner' | null = 'user') {
  mocks.useAccessSession.mockReturnValue({
    access: role
      ? {
          userId: `account-${role}`,
          email: `${role}@example.test`,
          name: role,
          image: null,
          role,
          operatorExpiresAt: null,
        }
      : null,
    status: 'ready',
    refresh: vi.fn(),
    signOut: vi.fn(),
  })
}

function setSuccessfulReads() {
  mocks.getLatestDashboard.mockResolvedValue(dashboardData)
  mocks.getHistory.mockResolvedValue({ data: [measurement], meta: {} })
  mocks.getNodeSettings.mockResolvedValue(nodeSettings)
  mocks.getControlStatus.mockResolvedValue(controlStatus)
  mocks.sendControlCommand.mockResolvedValue({ commands: [], controls: controlStatus })
  mocks.sendVentilationCommand.mockResolvedValue({ commands: [], controls: controlStatus })
}

function setHash(hash: string) {
  window.history.replaceState(null, '', `/${hash}`)
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

beforeEach(() => {
  vi.clearAllMocks()
  setSession()
  setSuccessfulReads()
  window.scrollTo = vi.fn()
})

describe('dashboard states and control actions', () => {
  it('opens the mobile secondary navigation and closes it after a section is chosen', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(createElement(DashboardNavigation, {
      label: 'Основная мобильная навигация',
      linkClassName: 'mobile-bottom-nav-link',
      activeSection: 'overview',
      onNavigate,
      mobile: true,
    }))

    const disclosure = screen.getByText('Ещё').closest('details') as HTMLDetailsElement
    await user.click(screen.getByText('Ещё'))
    expect(disclosure.open).toBe(true)

    await user.click(screen.getByRole('link', { name: 'История' }))
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onNavigate.mock.calls[0][0]).toBe('history')
    expect(disclosure.open).toBe(false)
    expect(document.activeElement).toBe(screen.getByText('Ещё').closest('summary'))
  })

  it('closes the mobile secondary navigation with Escape and restores focus', async () => {
    const user = userEvent.setup()
    render(createElement(DashboardNavigation, {
      label: 'Основная мобильная навигация',
      linkClassName: 'mobile-bottom-nav-link',
      activeSection: 'overview',
      onNavigate: () => undefined,
      mobile: true,
    }))

    const label = screen.getByText('Ещё')
    const summary = label.closest('summary') as HTMLElement
    const disclosure = summary.closest('details') as HTMLDetailsElement
    await user.click(summary)
    await user.keyboard('{Escape}')

    expect(disclosure.open).toBe(false)
    expect(document.activeElement).toBe(summary)
  })

  it('announces initial synchronization and keeps the skip link first in keyboard order', async () => {
    const user = userEvent.setup()
    mocks.getLatestDashboard.mockReturnValue(new Promise(() => undefined))
    render(createElement(AirDashboard))

    const main = screen.getByRole('main')
    const status = within(main).getAllByRole('status').find((item) => item.textContent?.includes('Синхронизация'))
    const refresh = screen.getByRole('button', { name: 'Обновление показаний' })

    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(refresh).toHaveProperty('disabled', true)
    expect(refresh.getAttribute('aria-busy')).toBe('true')

    const skipLink = screen.getByRole('link', { name: 'К содержимому' })
    await user.tab()
    expect(document.activeElement).toBe(skipLink)
    expect(skipLink.getAttribute('href')).toBe('#main-content')
  })

  it('shows the documented no-measurement state after successful empty API responses', async () => {
    mocks.getLatestDashboard.mockResolvedValue({ measurement: null, prediction: null, recommendation: null })
    mocks.getHistory.mockResolvedValue({ data: [], meta: {} })
    render(createElement(AirDashboard))

    expect(await screen.findByText('Данных пока нет')).not.toBeNull()
  })

  it('refreshes current readings and actual device state without reloading history', async () => {
    vi.useFakeTimers()
    try {
      const timestamp = new Date().toISOString()
      const liveMeasurement: ClientMeasurement = {
        ...measurement,
        id: 2,
        created_at: timestamp,
        timestamp,
        indoor: { ...measurement.indoor, co2: 712 },
      }
      const liveDashboard: DashboardData = {
        ...dashboardData,
        measurement: liveMeasurement,
      }
      const liveControlStatus: ClientControlStatus = {
        ...controlStatus,
        reported: { ...controlStatus.reported, window_open: true },
        desired: { ...controlStatus.desired, window_open: true },
      }
      mocks.getLatestDashboard
        .mockResolvedValueOnce(dashboardData)
        .mockResolvedValue(liveDashboard)
      mocks.getControlStatus
        .mockResolvedValueOnce(controlStatus)
        .mockResolvedValue(liveControlStatus)

      setHash('#controls')
      render(createElement(AirDashboard))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mocks.getLatestDashboard).toHaveBeenCalledTimes(1)
      expect(mocks.getHistory).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(DASHBOARD_LIVE_REFRESH_INTERVAL_MS)
      })

      expect(mocks.getLatestDashboard).toHaveBeenCalledTimes(2)
      expect(mocks.getControlStatus).toHaveBeenCalledTimes(2)
      expect(mocks.getHistory).toHaveBeenCalledTimes(1)
      expect(screen.getAllByText('Открыто').length).toBeGreaterThan(0)
      setHash('#overview')
      await act(async () => {
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      })
      expect(screen.getAllByText(/712/).length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('announces a dashboard error and recovers when the user retries', async () => {
    const user = userEvent.setup()
    mocks.getLatestDashboard
      .mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValue(dashboardData)
    render(createElement(AirDashboard))

    const main = screen.getByRole('main')
    const alert = await within(main).findByRole('alert')
    expect(alert.textContent).not.toBe('')

    await user.click(within(alert).getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(within(main).queryByRole('alert')).toBeNull())
  })

  it.each([
    { role: 'user', canOperate: false },
    { role: 'operator', canOperate: true },
    { role: 'owner', canOperate: true },
  ] as const)('reflects $role permissions on the ventilation action', async ({ role, canOperate }) => {
    const user = userEvent.setup()
    setSession(role)
    setHash('#controls')
    render(createElement(AirDashboard))

    const action = await screen.findByRole('button', { name: 'Запустить проветривание' })
    expect(action).toHaveProperty('disabled', !canOperate)

    await user.click(action)
    if (canOperate) {
      await waitFor(() => expect(mocks.sendVentilationCommand).toHaveBeenCalledWith('on', 'room-01'))
    } else {
      expect(mocks.sendVentilationCommand).not.toHaveBeenCalled()
    }
  })
})
