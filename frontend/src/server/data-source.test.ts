import { describe, it, expect } from 'vitest'
import { parseMeasurementInput } from './validation'
const payload = {
  timestamp: '2026-10-08T14:00:00Z',
  indoor: { co2: 900, temperature: 23, humidity: 45, pm25: 5 },
  outdoor: { temperature: 18, humidity: 60, pm25: 8 },
  window_open: false,
}
describe('declared telemetry source', () => {
  it('preserves old unlabelled payloads without claiming real', () =>
    expect(parseMeasurementInput(payload).dataSource).toBeUndefined())
  it.each(['real', 'simulator', 'unknown'])('retains %s source', (source) =>
    expect(
      parseMeasurementInput({ ...payload, data_source: source }).dataSource,
    ).toBe(source),
  )
  it.each([[['real']], [null], [42], ['invalid']])(
    'rejects malformed source %j',
    (source) =>
      expect(() =>
        parseMeasurementInput({ ...payload, data_source: source }),
      ).toThrow(),
  )
})
