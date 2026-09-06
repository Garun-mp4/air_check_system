import { describe, expect, it } from 'vitest'

import {
  PM25_ELEVATED_LIMIT,
  PM25_GOOD_LIMIT,
  getPm25Level,
  getPm25MarkerPosition,
} from './air-quality'

describe('PM2.5 quality scale', () => {
  it('maps the configured limits to readable quality levels', () => {
    expect(getPm25Level(PM25_GOOD_LIMIT)).toBe('good')
    expect(getPm25Level(PM25_GOOD_LIMIT + 0.1)).toBe('elevated')
    expect(getPm25Level(PM25_ELEVATED_LIMIT)).toBe('elevated')
    expect(getPm25Level(PM25_ELEVATED_LIMIT + 0.1)).toBe('high')
  })

  it('keeps the marker inside the scale and hides it without a reading', () => {
    expect(getPm25MarkerPosition(null)).toBeNull()
    expect(getPm25MarkerPosition(0)).toBe(3)
    expect(getPm25MarkerPosition(25)).toBe(50)
    expect(getPm25MarkerPosition(100)).toBe(97)
  })
})
