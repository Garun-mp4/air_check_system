import { describe, expect, it } from 'vitest'

import { getLoginHref, getSafeReturnPath } from './auth-navigation'

describe('authentication navigation', () => {
  it('preserves a local dashboard section after sign-in', () => {
    expect(getSafeReturnPath('/#controls')).toBe('/#controls')
    expect(getSafeReturnPath('/simulator?mode=airflow')).toBe('/simulator?mode=airflow')
    expect(getLoginHref('/account')).toBe('/login?returnTo=%2Faccount')
  })

  it('rejects external, protocol-relative, and backslash redirects', () => {
    expect(getSafeReturnPath('https://example.com')).toBe('/')
    expect(getSafeReturnPath('//example.com/path')).toBe('/')
    expect(getSafeReturnPath('/\\example.com')).toBe('/')
    expect(getSafeReturnPath(null)).toBe('/')
  })
})
