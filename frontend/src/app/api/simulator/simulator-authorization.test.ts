import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getAuthPool: vi.fn(),
  fetchSimulator: vi.fn(),
}))

vi.mock('../../../server/auth', () => ({
  getAuth: mocks.getAuth,
  getAuthPool: mocks.getAuthPool,
}))

vi.mock('../../../server/simulator', () => ({
  fetchSimulator: mocks.fetchSimulator,
}))

import { POST as postAction } from './actions/route'

function requestAction(origin = 'http://localhost', action = 'debug_set'): Request {
  return new Request('http://localhost/api/simulator/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, host: 'localhost' },
    body: JSON.stringify({ action, payload: { key: 'occupancy', value: 6 } }),
  })
}

function configureAccess(role: 'user' | 'operator' | 'owner', expiresAt: Date | null = null): void {
  mocks.getAuth.mockReturnValue({
    api: { getSession: vi.fn().mockResolvedValue({ user: { id: 'user-1', email: 'user@example.test', name: 'Test' } }) },
  })
  mocks.getAuthPool.mockReturnValue({
    query: vi.fn().mockResolvedValue({ rows: [{ role, operator_expires_at: expiresAt }] }),
  })
}

describe('simulator action role boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAuth.mockReturnValue({ api: { getSession: vi.fn().mockResolvedValue(null) } })
    mocks.fetchSimulator.mockResolvedValue(Response.json({ data: { key: 'occupancy', value: 6 } }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows guest reads elsewhere but rejects guest simulator mutations', async () => {
    const response = await postAction(requestAction())

    expect(response.status).toBe(401)
    expect(mocks.getAuthPool).not.toHaveBeenCalled()
    expect(mocks.fetchSimulator).not.toHaveBeenCalled()
  })

  it.each([
    ['user cannot use scenario', 'user', null, 'scenario'],
    ['user cannot use debug', 'user', null, 'debug_set'],
    ['expired operator cannot use scenario', 'operator', new Date('2000-01-01T00:00:00.000Z'), 'scenario'],
    ['expired operator cannot use debug', 'operator', new Date('2000-01-01T00:00:00.000Z'), 'debug_set'],
  ] as const)('denies %s', async (_label, role, expiresAt, action) => {
    configureAccess(role, expiresAt)

    const response = await postAction(requestAction('http://localhost', action))

    expect(response.status).toBe(403)
    expect(mocks.fetchSimulator).not.toHaveBeenCalled()
  })

  it.each(['operator', 'owner'] as const)('permits %s to dispatch authorized debug actions', async (role) => {
    configureAccess(role)

    const response = await postAction(requestAction())

    expect(response.status).toBe(202)
    expect(mocks.fetchSimulator).toHaveBeenCalledWith('/v1/actions', expect.objectContaining({
      method: 'POST',
    }))
  })

  it('rejects a forged origin before resolving the caller session', async () => {
    configureAccess('operator')

    const response = await postAction(requestAction('https://attacker.example'))

    expect(response.status).toBe(403)
    expect(mocks.getAuth).not.toHaveBeenCalled()
    expect(mocks.fetchSimulator).not.toHaveBeenCalled()
  })
})
