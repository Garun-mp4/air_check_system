import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  sessionUser: null as null | { id: string; email: string; name: string; image?: string | null },
  role: 'user' as 'user' | 'operator' | 'owner',
  operatorExpiresAt: null as Date | null,
  getSession: vi.fn(),
  roleQuery: vi.fn(),
}))

vi.mock('./auth', () => ({
  getAuth: () => ({ api: { getSession: state.getSession } }),
  getAuthPool: () => ({ query: state.roleQuery }),
}))

import {
  AccessDeniedError,
  AccessUnavailableError,
  readAccess,
  requireOperator,
  requireOwner,
  requireDeviceToken,
} from './access'

function request(headers?: HeadersInit): Request {
  return new Request('https://aircheck.example/api/auth/access', { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.sessionUser = null
  state.role = 'user'
  state.operatorExpiresAt = null
  state.getSession.mockImplementation(async () => state.sessionUser ? { user: state.sessionUser } : null)
  state.roleQuery.mockImplementation(async () => ({
    rows: [{ role: state.role, operator_expires_at: state.operatorExpiresAt }],
    rowCount: 1,
  }))
})

const previousDeviceToken = process.env.DEVICE_API_TOKEN

afterEach(() => {
  if (previousDeviceToken === undefined) delete process.env.DEVICE_API_TOKEN
  else process.env.DEVICE_API_TOKEN = previousDeviceToken
})

describe('session-derived access context', () => {
  it('represents an absent session as a guest without querying account roles', async () => {
    await expect(readAccess(request())).resolves.toEqual({
      userId: null,
      email: null,
      name: null,
      image: null,
      role: 'guest',
      operatorExpiresAt: null,
    })
    expect(state.roleQuery).not.toHaveBeenCalled()
  })

  it.each([
    ['user', 'user'],
    ['operator', 'operator'],
    ['owner', 'owner'],
  ] as const)('returns the stored %s identity and role', async (role, effectiveRole) => {
    state.sessionUser = { id: 'account-1', email: 'person@example.org', name: 'Person', image: null }
    state.role = role

    await expect(readAccess(request())).resolves.toEqual({
      userId: 'account-1',
      email: 'person@example.org',
      name: 'Person',
      image: null,
      role: effectiveRole,
      operatorExpiresAt: null,
    })
    expect(state.roleQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT role, operator_expires_at'),
      ['account-1'],
    )
  })

  it('drops an operator grant exactly at its expiry while retaining its recorded expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'))
    state.sessionUser = { id: 'operator-1', email: 'operator@example.org', name: 'Operator', image: null }
    state.role = 'operator'
    state.operatorExpiresAt = new Date('2026-09-28T12:00:00.000Z')

    try {
      await expect(readAccess(request())).resolves.toMatchObject({
        userId: 'operator-1',
        image: null,
        role: 'user',
        operatorExpiresAt: '2026-09-28T12:00:00.000Z',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an operator grant active when its expiry is null', async () => {
    state.sessionUser = { id: 'operator-1', email: 'operator@example.org', name: 'Operator', image: null }
    state.role = 'operator'
    state.operatorExpiresAt = null

    await expect(readAccess(request())).resolves.toMatchObject({ role: 'operator', operatorExpiresAt: null })
  })

  it('fails closed when the role store cannot be read', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    state.sessionUser = { id: 'account-1', email: 'person@example.org', name: 'Person', image: null }
    state.roleQuery.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(readAccess(request())).rejects.toBeInstanceOf(AccessUnavailableError)

    errorSpy.mockRestore()
  })
})

describe('role gates', () => {
  const identity = { id: 'account-1', email: 'person@example.org', name: 'Person' }

  it.each([
    ['guest', null, 401],
    ['user', 'user', 403],
    ['operator', 'operator', null],
    ['owner', 'owner', null],
  ] as const)('applies operator access for %s', async (_description, role, status) => {
    if (role) {
      state.sessionUser = identity
      state.role = role
    }

    if (status === null) {
      await expect(requireOperator(request())).resolves.toMatchObject({ role })
    } else {
      await expect(requireOperator(request())).rejects.toMatchObject({ status })
    }
  })

  it.each([
    ['guest', null, 401],
    ['user', 'user', 403],
    ['operator', 'operator', 403],
    ['owner', 'owner', null],
  ] as const)('applies owner access for %s', async (_description, role, status) => {
    if (role) {
      state.sessionUser = identity
      state.role = role
    }

    if (status === null) {
      await expect(requireOwner(request())).resolves.toMatchObject({ role })
    } else {
      await expect(requireOwner(request())).rejects.toMatchObject({ status })
    }
  })
})

describe('device authentication boundary', () => {
  it('does not treat an authenticated browser cookie as a device bearer token', () => {
    process.env.DEVICE_API_TOKEN = 'd'.repeat(48)
    state.sessionUser = { id: 'account-1', email: 'person@example.org', name: 'Person' }

    expect(() => requireDeviceToken(request({ cookie: 'better-auth.session_token=browser-session' })))
      .toThrow(AccessDeniedError)
  })

  it('accepts a valid device bearer token without a browser session', () => {
    const token = 'd'.repeat(48)
    process.env.DEVICE_API_TOKEN = token

    expect(() => requireDeviceToken(request({ authorization: `Bearer ${token}` }))).not.toThrow()
    expect(state.getSession).not.toHaveBeenCalled()
  })
})
