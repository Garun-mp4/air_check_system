// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DataStatus from './DataStatus'
afterEach(cleanup)
describe('data diagnostics', () => {
  it('distinguishes connection loss, old measurements and an untrained model', () => {
    render(
      React.createElement(DataStatus, {
        diagnostics: {
          measurement: 'stale',
          device: 'offline',
          prediction: 'model_untrained',
          predictionMessage: 'Модель отсутствует',
          measuredAt: '2026-10-08T00:00:00Z',
          assessedAt: new Date().toISOString(),
        },
      }),
    )
    expect(screen.getByText('Измерения устарели')).toBeTruthy()
    expect(screen.getByText('Устройство: не на связи')).toBeTruthy()
    expect(screen.getByText('Модель не обучена')).toBeTruthy()
  })
  it('labels a legacy prediction without displaying it as a current forecast', () => {
    render(
      React.createElement(DataStatus, {
        diagnostics: {
          measurement: 'fresh',
          device: 'online',
          prediction: 'legacy',
          predictionMessage: null,
          measuredAt: new Date().toISOString(),
          assessedAt: new Date().toISOString(),
        },
      }),
    )
    expect(
      screen.getByText('Старый прогноз без связи с измерением'),
    ).toBeTruthy()
    expect(screen.queryByText('Прогноз готов')).toBeNull()
  })
})
