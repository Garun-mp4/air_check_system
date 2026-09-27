import { describe, expect, it } from 'vitest'

import { getSafeReturnPath } from './auth-navigation'
import { AccessDeniedError, assertSameOrigin } from '../server/access'

describe('authentication redirect and origin boundaries', () => {
  it.each([
    ['https://outside.example/path', '/'],
    ['//outside.example/path', '/'],
    ['///outside.example/path', '/'],
    ['/\\\\outside.example/path', '/'],
    ['javascript:alert(1)', '/'],
  ])('falls back for non-local return target %s', (candidate, expected) => {
    expect(getSafeReturnPath(candidate)).toBe(expected)
  })

  it('keeps a normalized local path with its query and fragment', () => {
    expect(getSafeReturnPath('/simulator/./?mode=airflow#controls'))
      .toBe('/simulator/?mode=airflow#controls')
  })

  it('rejects a path that normalizes into a protocol-relative redirect', () => {
    expect(getSafeReturnPath('/..//outside.example/path')).toBe('/')
  })

  it('accepts the public origin forwarded by the HTTPS proxy', () => {
    const request = new Request('http://backend:3000/api/admin/users', {
      headers: {
        origin: 'https://aircheck.example',
        host: 'backend:3000',
        'x-forwarded-host': 'aircheck.example',
        'x-forwarded-proto': 'https, http',
      },
    })
    expect(() => assertSameOrigin(request)).not.toThrow()
  })

  it.each([
    ['missing origin', { host: 'aircheck.example' }],
    ['opaque origin', { origin: 'null', host: 'aircheck.example' }],
    ['origin with a different port', { origin: 'https://aircheck.example:444', host: 'aircheck.example' }],
    ['untrusted forwarded host', {
      origin: 'https://attacker.example',
      host: 'backend:3000',
      'x-forwarded-host': 'aircheck.example',
      'x-forwarded-proto': 'https',
    }],
    ['protocol mismatch', {
      origin: 'http://aircheck.example',
      host: 'backend:3000',
      'x-forwarded-host': 'aircheck.example',
      'x-forwarded-proto': 'https',
    }],
  ])('rejects %s on browser mutations', (_description, headers) => {
    const request = new Request('http://backend:3000/api/admin/users', { headers })
    expect(() => assertSameOrigin(request)).toThrow(AccessDeniedError)
  })
})
