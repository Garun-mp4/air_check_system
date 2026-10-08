import { describe, it, expect } from 'vitest'
import {
  parseLongHistory,
  summary,
  historyCsv,
  type HourStats,
} from './long-history'
const row = (bucket: string): HourStats => ({
  bucket,
  data_source: 'real',
  samples: 2,
  metric_sums: { co2: 1800 },
  metric_minima: { co2: 800 },
  metric_maxima: { co2: 1000 },
  covered_seconds: 60,
  co2_known_seconds: 0,
  pm25_known_seconds: 0,
  co2_exceed_seconds: 0,
  pm25_exceed_seconds: 0,
  window_seconds: 0,
  ventilation_seconds: 0,
  ventilation_known_seconds: 0,
})
describe('archive/export contracts', () => {
  it('does not invent averages or extrema for absent data', () =>
    expect(summary([])).toMatchObject({
      samples: 0,
      metrics: { co2: { average: null, min: null, max: null } },
      totals: { covered_seconds: 0 },
    }))
  it('weights averages by sample count and retains unknown coverage', () =>
    expect(summary([row('2026-10-08T12:00Z')])).toMatchObject({
      metrics: { co2: { average: 900, min: 800, max: 1000 } },
      totals: { co2_known_seconds: 0, covered_seconds: 60 },
    }))
  it.each(['days=31', 'days=0', 'source=untrusted', 'timezone=invalid'])(
    'rejects unsupported query %s',
    (query) =>
      expect(() => parseLongHistory(new URLSearchParams(query))).toThrow(),
  )
  it('CSV keeps UTC identifiers across a daylight-saving overlap and includes units', () => {
    const csv = historyCsv({
      days: 7,
      source: 'real',
      timezone: 'Europe/Berlin',
      bucket_timezone: 'UTC',
      from: '',
      to: '',
      summary: summary([]),
      previous_summary: summary([]),
      rows: [row('2026-10-25T00:00:00Z'), row('2026-10-25T01:00:00Z')],
    })
    expect(csv).toContain('2026-10-25T00:00:00.000Z')
    expect(csv).toContain('2026-10-25T01:00:00.000Z')
    expect(csv.match(/2026-10-25 02:00:00/g)).toHaveLength(2)
    expect(csv).toContain('"ppm"')
    expect(csv).toContain('"ug/m3"')
  })
})
