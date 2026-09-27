import { afterEach, describe, expect, it } from 'vitest'

import { AccessDeniedError, assertSameOrigin, effectiveRole, requireDeviceToken } from './access'

describe('server-side access controls', () => {
  const previousToken = process.env.DEVICE_API_TOKEN

  afterEach(() => {
    if (previousToken === undefined) delete process.env.DEVICE_API_TOKEN
    else process.env.DEVICE_API_TOKEN = previousToken
  })

  it('expires operator privileges on the first request after expiry', () => {
    const expiredAt = new Date('2026-01-01T00:00:00.000Z')
    const current = Date.parse('2026-01-01T00:00:00.001Z')
    expect(effectiveRole('operator', expiredAt, current)).toBe('user')
    expect(effectiveRole('operator', null, current)).toBe('operator')
    expect(effectiveRole('owner', expiredAt, current)).toBe('owner')
  })

  it('rejects a missing, short or incorrect device token', () => {
    delete process.env.DEVICE_API_TOKEN
    expect(() => requireDeviceToken(new Request('http://localhost/api'))).toThrow(AccessDeniedError)
    process.env.DEVICE_API_TOKEN = 'short'
    expect(() => requireDeviceToken(new Request('http://localhost/api', { headers: { authorization: 'Bearer short' } }))).toThrow(AccessDeniedError)
    process.env.DEVICE_API_TOKEN = 'a'.repeat(48)
    expect(() => requireDeviceToken(new Request('http://localhost/api', { headers: { authorization: `Bearer ${'b'.repeat(48)}` } }))).toThrow(AccessDeniedError)
  })

  it('accepts only the configured bearer token for machine routes', () => {
    const token = '6b'.repeat(32)
    process.env.DEVICE_API_TOKEN = token
    const request = new Request('http://localhost:3000/api/v1/measurements', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(() => requireDeviceToken(request)).not.toThrow()
  })

  it('checks browser mutations against the public HTTPS origin behind the proxy', () => {
    const request = new Request('http://backend:3000/api/v1/controls/commands', {
      headers: {
        origin: 'https://aircheck.home.arpa',
        host: 'backend:3000',
        'x-forwarded-host': 'aircheck.home.arpa',
        'x-forwarded-proto': 'https',
      },
    })
    expect(() => assertSameOrigin(request)).not.toThrow()
    const forged = new Request('http://backend:3000/api/v1/controls/commands', {
      headers: {
        origin: 'https://attacker.example',
        host: 'backend:3000',
        'x-forwarded-host': 'aircheck.home.arpa',
        'x-forwarded-proto': 'https',
      },
    })
    expect(() => assertSameOrigin(forged)).toThrow(AccessDeniedError)
  })
})
