import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  AirComparison,
  AirContextCards,
  AirContextMap,
  DashboardNavigation,
  SettingsPanel,
  getConnectionStatusLabel,
  getSectionIdFromHash,
  getViewIdFromHash,
  getWindowHistorySummary,
  rangeLabels,
  rangeMinutes,
} from './AirDashboard'
import type { ClientMeasurement } from '../lib/client-api'

describe('dashboard navigation', () => {
  it('offers only the supported rolling history periods', () => {
    expect(Object.keys(rangeLabels)).toEqual(['30m', '1h', '6h', '24h'])
    expect(rangeMinutes).toEqual({ '30m': 30, '1h': 60, '6h': 360, '24h': 1440 })
  })

  it('renders photo context cards and an explainable comparison', () => {
    const measurement: ClientMeasurement = {
      id: 1,
      created_at: '2026-09-09T10:00:00Z',
      timestamp: '2026-09-09T10:00:00Z',
      indoor: { co2: 650, temperature: 23.1, humidity: 45, pm25: 5.3 },
      outdoor: { temperature: 17.8, humidity: 59, pm25: 9.0 },
      window_open: false,
    }
    const cards = renderToStaticMarkup(createElement(AirContextCards, {
      measurement,
      onNavigate: () => undefined,
    }))
    const comparison = renderToStaticMarkup(createElement(AirComparison, { measurement }))

    expect(cards).toContain('/air-context-indoor.png')
    expect(cards).toContain('/air-context-outdoor.png')
    expect(cards).toContain('width="1672" height="941"')
    expect(cards).toContain('Температура')
    expect(cards).toContain('Влажность')
    expect(cards).toContain('23,1')
    expect(cards).toContain('45<small>%</small>')
    expect(cards).toContain('Закрыто')
    expect(cards.match(/air-context-card-metric-pm25/g)).toHaveLength(2)
    expect(cards.match(/air-context-card-metric-window/g)).toHaveLength(1)
    expect(comparison).toContain('CO₂ не сравнивается')
    expect(comparison).toContain('внутри чище')
  })

  it('explains indoor and outdoor readings with navigable zones', () => {
    const markup = renderToStaticMarkup(createElement(AirContextMap, { onNavigate: () => undefined }))

    expect(markup).toContain('Снаружи')
    expect(markup).toContain('Внутри комнаты')
    expect(markup).toContain('aria-controls="outdoor-sensors"')
    expect(markup).toContain('aria-controls="indoor-sensors"')
  })

  it('resolves only known section hashes', () => {
    expect(getSectionIdFromHash('#controls')).toBe('controls')
    expect(getSectionIdFromHash('history')).toBe('history')
    expect(getSectionIdFromHash('#unknown')).toBe('overview')
    expect(getSectionIdFromHash('')).toBe('overview')
  })

  it('keeps settings as a separate view from dashboard sections', () => {
    expect(getViewIdFromHash('#settings')).toBe('settings')
    expect(getViewIdFromHash('#history')).toBe('history')
    expect(getViewIdFromHash('#unknown')).toBe('overview')
  })

  it('places technical details inside the settings panel', () => {
    const markup = renderToStaticMarkup(createElement(SettingsPanel, {
      controls: null,
      deviceId: 'room-01',
      measurement: null,
      prediction: null,
      systemStatus: 'ожидание',
      systemTone: 'neutral',
      tab: 'technical',
      onTabChange: () => undefined,
      onClose: () => undefined,
      closeButtonRef: createRef<HTMLButtonElement>(),
    }))

    expect(markup).toContain('id="settings-dialog"')
    expect(markup).toContain('Технические сведения')
    expect(markup).toContain('PostgreSQL')
    expect(markup).not.toContain('Связь и модель')
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
