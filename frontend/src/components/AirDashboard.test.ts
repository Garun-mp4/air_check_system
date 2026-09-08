import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  DashboardNavigation,
  getConnectionStatusLabel,
  getSectionIdFromHash,
  getWindowHistorySummary,
} from './AirDashboard'
import type { ClientMeasurement } from '../lib/client-api'

describe('dashboard navigation', () => {
  it('resolves only known section hashes', () => {
    expect(getSectionIdFromHash('#controls')).toBe('controls')
    expect(getSectionIdFromHash('history')).toBe('history')
    expect(getSectionIdFromHash('#unknown')).toBe('overview')
    expect(getSectionIdFromHash('')).toBe('overview')
  })

  it('renders the hash section as active in both navigation variants', () => {
    const desktopMarkup = renderToStaticMarkup(createElement(DashboardNavigation, {
      label: 'Desktop navigation',
      linkClassName: 'app-nav-link',
      activeSection: 'signals',
      onNavigate: () => undefined,
    }))
    const mobileMarkup = renderToStaticMarkup(createElement(DashboardNavigation, {
      label: 'Mobile navigation',
      linkClassName: 'mobile-nav-link',
      activeSection: 'signals',
      onNavigate: () => undefined,
    }))

    expect(desktopMarkup.match(/class="app-nav-link is-active"/g)).toHaveLength(1)
    expect(mobileMarkup.match(/class="mobile-nav-link is-active"/g)).toHaveLength(1)
    expect(desktopMarkup.match(/aria-current="location"/g)).toHaveLength(1)
    expect(mobileMarkup.match(/aria-current="location"/g)).toHaveLength(1)
  })

  it('uses human-readable connection labels', () => {
    expect(getConnectionStatusLabel('online')).toBe('в сети')
    expect(getConnectionStatusLabel('stale')).toBe('связь нестабильна')
    expect(getConnectionStatusLabel('offline')).toBe('нет связи')
    expect(getConnectionStatusLabel(undefined)).toBe('нет данных')
  })

  it('summarizes window transitions even when API points arrive out of order', () => {
    const point = (timestamp: string, window_open: boolean) => ({
      timestamp,
      window_open,
    }) as ClientMeasurement

    expect(getWindowHistorySummary([
      point('2026-09-07T10:20:00Z', true),
      point('2026-09-07T10:10:00Z', false),
      point('2026-09-07T10:30:00Z', true),
      point('2026-09-07T10:40:00Z', false),
    ])).toEqual({
      transitionCount: 2,
      lastChange: {
        from: true,
        to: false,
        timestamp: '2026-09-07T10:40:00Z',
      },
    })
  })
})
