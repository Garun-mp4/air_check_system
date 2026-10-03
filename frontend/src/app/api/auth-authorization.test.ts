import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  role: 'user' as 'user' | 'operator' | 'owner',
  sessionUserId: null as string | null,
  operatorExpiresAt: null as Date | null,
  ownerId: 'actor-1',
  subjectRole: 'user',
  subjectExists: true,
  users: [] as Array<Record<string, unknown>>,
  authHandler: vi.fn(),
  signUpEmail: vi.fn(),
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}))

vi.mock('../../server/auth', () => ({
  getAuth: () => ({
    handler: state.authHandler,
    api: {
      getSession: async () => state.sessionUserId
        ? { user: { id: state.sessionUserId, email: 'person@example.org', name: 'Person', image: null } }
        : null,
      signUpEmail: state.signUpEmail,
    },
  }),
  getAuthPool: () => ({
    query: state.poolQuery,
    connect: async () => ({ query: state.clientQuery, release: state.release }),
  }),
}))

import { GET as authGet, POST as authPost } from './auth/[...all]/route'
import { GET as accessGet } from './auth/access/route'
import { GET as listUsers, POST as createUser } from './admin/users/route'
import { DELETE as deleteUser, PATCH as updateUser } from './admin/users/[userId]/route'
import { POST as issueControl } from './v1/controls/commands/route'
import { GET as readPendingCommands } from './v1/controls/commands/route'
import { POST as issueVentilation } from './v1/controls/ventilation/route'
import { PATCH as updateSettings } from './v1/settings/route'
import { POST as simulatorAction } from './simulator/actions/route'

const originHeaders = {
  origin: 'https://aircheck.example',
  host: 'aircheck.example',
  'x-forwarded-host': 'aircheck.example',
  'x-forwarded-proto': 'https',
  'content-type': 'application/json',
}

const previousDeviceToken = process.env.DEVICE_API_TOKEN

afterEach(() => {
  if (previousDeviceToken === undefined) delete process.env.DEVICE_API_TOKEN
  else process.env.DEVICE_API_TOKEN = previousDeviceToken
})

function jsonRequest(path: string, method: string, payload: unknown = {}): Request {
  return new Request(`https://aircheck.example${path}`, {
    method,
    headers: originHeaders,
    body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(payload),
  })
}

function setIdentity(role: 'guest' | 'user' | 'operator' | 'owner') {
  state.role = role === 'guest' ? 'user' : role
  state.sessionUserId = role === 'guest' ? null : role === 'owner' ? state.ownerId : 'actor-1'
}

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'user'
  state.sessionUserId = null
  state.operatorExpiresAt = null
  state.ownerId = 'actor-1'
  state.subjectRole = 'user'
  state.subjectExists = true
  state.users = []
  state.authHandler.mockImplementation(async (request: Request) => new Response(request.method))
  state.signUpEmail.mockResolvedValue({ user: { id: 'new-1', email: 'new@example.org', name: 'New User' } })
  state.poolQuery.mockImplementation(async (query: string) => {
    if (query.includes('SELECT role, operator_expires_at')) {
      return state.sessionUserId
        ? { rows: [{ role: state.role, operator_expires_at: state.operatorExpiresAt }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    if (query.includes('SELECT u.id, u.email, u.name')) return { rows: state.users, rowCount: state.users.length }
    throw new Error(`Unexpected auth pool query: ${query}`)
  })
  state.clientQuery.mockImplementation(async (query: string) => {
    if (query.includes("SELECT user_id FROM aircheck_access_roles WHERE role = 'owner'")) {
      return { rows: [{ user_id: state.ownerId }], rowCount: 1 }
    }
    if (query.includes('SELECT COALESCE(r.role, \'user\') AS role')) {
      return { rows: state.subjectExists ? [{ role: state.subjectRole }] : [], rowCount: state.subjectExists ? 1 : 0 }
    }
    return { rows: [], rowCount: 1 }
  })
})

describe('Better Auth API routing and access projection', () => {
  it('forwards sign-in, sign-up, session, and sign-out requests to Better Auth', async () => {
    const signIn = jsonRequest('/api/auth/sign-in/email', 'POST', { email: 'person@example.org', password: 'private-password' })
    const signUp = jsonRequest('/api/auth/sign-up/email', 'POST', { email: 'new@example.org', name: 'New', password: 'private-password' })
    const session = new Request('https://aircheck.example/api/auth/get-session')
    const signOut = jsonRequest('/api/auth/sign-out', 'POST')
    const getResponse = await authGet(session)
    const signInResponse = await authPost(signIn)
    const signUpResponse = await authPost(signUp)
    const signOutResponse = await authPost(signOut)

    expect(await getResponse.text()).toBe('GET')
    expect(await signInResponse.text()).toBe('POST')
    expect(await signUpResponse.text()).toBe('POST')
    expect(await signOutResponse.text()).toBe('POST')
    expect(state.authHandler.mock.calls.map(([request]) => request)).toEqual([session, signIn, signUp, signOut])
  })

  it('returns only the current access projection with no-store caching', async () => {
    const operatorExpiresAt = new Date(Date.now() + 60 * 60 * 1000)
    state.sessionUserId = 'person-1'
    state.role = 'operator'
    state.operatorExpiresAt = operatorExpiresAt
    const response = await accessGet(new Request('https://aircheck.example/api/auth/access', {
      headers: { cookie: 'better-auth.session_token=browser-secret' },
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      data: {
        userId: 'person-1',
        email: 'person@example.org',
        name: 'Person',
        image: null,
        role: 'operator',
        operatorExpiresAt: operatorExpiresAt.toISOString(),
      },
    })
    expect(response.headers.has('set-cookie')).toBe(false)
  })
})

type ProtectedRoute = 'admin list' | 'account creation' | 'role update' | 'account deletion'

async function invokeAdminRoute(route: ProtectedRoute): Promise<Response> {
  switch (route) {
    case 'admin list': return listUsers(jsonRequest('/api/admin/users', 'GET'))
    case 'account creation': return createUser(jsonRequest('/api/admin/users', 'POST', {
      name: 'Attempt', email: 'attempt@example.org', password: 'long-enough-password',
    }))
    case 'role update': return updateUser(jsonRequest('/api/admin/users/actor-1', 'PATCH', { role: 'operator' }), {
      params: Promise.resolve({ userId: 'actor-1' }),
    })
    case 'account deletion': return deleteUser(jsonRequest('/api/admin/users/actor-1', 'DELETE'), {
      params: Promise.resolve({ userId: 'actor-1' }),
    })
  }
}

describe('account administration routes', () => {
  it.each([
    ['guest', 401],
    ['user', 403],
    ['operator', 403],
  ] as const)('%s cannot access the owner-only admin list', async (role, status) => {
    setIdentity(role)
    const response = await listUsers(jsonRequest('/api/admin/users', 'GET'))
    expect(response.status).toBe(status)
    expect(state.poolQuery).toHaveBeenCalledTimes(role === 'guest' ? 0 : 1)
  })

  it.each([
    ['guest', 401],
    ['user', 403],
    ['operator', 403],
  ] as const)('%s cannot use any account-management mutation', async (role, status) => {
    setIdentity(role)
    for (const route of ['account creation', 'role update', 'account deletion'] as const) {
      const response = await invokeAdminRoute(route)
      expect(response.status, `${role} on ${route}`).toBe(status)
    }
    expect(state.signUpEmail).not.toHaveBeenCalled()
    expect(state.clientQuery).not.toHaveBeenCalledWith('BEGIN')
  })

  it('lets the owner list accounts without exposing credential or session fields', async () => {
    setIdentity('owner')
    state.users = [{
      id: 'user-1', email: 'user@example.org', name: 'User', role: 'operator',
      operator_expires_at: new Date('2026-09-27T00:00:00.000Z'),
      created_at: new Date('2026-09-01T00:00:00.000Z'), password: 'private-hash', session_token: 'private-session',
    }]

    const response = await listUsers(jsonRequest('/api/admin/users', 'GET'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.data[0]).toEqual({
      id: 'user-1',
      email: 'user@example.org',
      name: 'User',
      role: 'user',
      operator_expires_at: null,
      created_at: '2026-09-01T00:00:00.000Z',
    })
    expect(JSON.stringify(body)).not.toContain('private-hash')
    expect(JSON.stringify(body)).not.toContain('private-session')
  })

  it('creates a least-privileged account and excludes its password from the response', async () => {
    setIdentity('owner')
    const password = 'private-password-for-new-user'
    const response = await createUser(jsonRequest('/api/admin/users', 'POST', {
      name: ' New User ', email: ' NEW@example.org ', password,
    }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(state.signUpEmail).toHaveBeenCalledWith({ body: { email: 'new@example.org', name: 'New User', password } })
    expect(body).toEqual({ data: { id: 'new-1', email: 'new@example.org', name: 'New User' } })
    expect(JSON.stringify(body)).not.toContain(password)
    expect(response.headers.has('set-cookie')).toBe(false)
  })

  it('rejects self-escalation and owner-role assignment', async () => {
    setIdentity('user')
    const selfEscalation = await updateUser(jsonRequest('/api/admin/users/actor-1', 'PATCH', {
      role: 'operator', expires_at: null,
    }), { params: Promise.resolve({ userId: 'actor-1' }) })
    expect(selfEscalation.status).toBe(403)

    setIdentity('owner')
    const ownerPromotion = await updateUser(jsonRequest('/api/admin/users/user-1', 'PATCH', { role: 'owner' }), {
      params: Promise.resolve({ userId: 'user-1' }),
    })
    expect(ownerPromotion.status).toBe(400)
    expect(state.clientQuery).not.toHaveBeenCalledWith('BEGIN')
  })

  it('sets a future operator grant and audits the expiry', async () => {
    setIdentity('owner')
    const expiry = new Date(Date.now() + 60_000).toISOString()
    const response = await updateUser(jsonRequest('/api/admin/users/user-1', 'PATCH', {
      role: 'operator', expires_at: expiry,
    }), { params: Promise.resolve({ userId: 'user-1' }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { user_id: 'user-1', role: 'operator', operator_expires_at: expiry },
    })
    expect(state.clientQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO aircheck_access_roles'), [
      'user-1', 'operator', new Date(expiry),
    ])
    expect(state.clientQuery).toHaveBeenCalledWith(expect.stringContaining("'role.updated'"), [
      'actor-1', 'user-1', 'user', 'operator', new Date(expiry),
    ])
  })

  it('rejects an expired operator grant before starting a role transaction', async () => {
    setIdentity('owner')
    const response = await updateUser(jsonRequest('/api/admin/users/user-1', 'PATCH', {
      role: 'operator', expires_at: '2020-01-01T00:00:00.000Z',
    }), { params: Promise.resolve({ userId: 'user-1' }) })

    expect(response.status).toBe(400)
    expect(state.clientQuery).not.toHaveBeenCalledWith('BEGIN')
  })

  it('protects the sole owner from role changes and deletion', async () => {
    setIdentity('owner')
    state.subjectRole = 'owner'
    const changeOwner = await updateUser(jsonRequest('/api/admin/users/actor-1', 'PATCH', { role: 'user' }), {
      params: Promise.resolve({ userId: 'actor-1' }),
    })
    const deleteOwner = await deleteUser(jsonRequest('/api/admin/users/actor-1', 'DELETE'), {
      params: Promise.resolve({ userId: 'actor-1' }),
    })
    const deleteOtherOwner = await deleteUser(jsonRequest('/api/admin/users/other-owner', 'DELETE'), {
      params: Promise.resolve({ userId: 'other-owner' }),
    })

    expect(changeOwner.status).toBe(403)
    expect(deleteOwner.status).toBe(403)
    expect(deleteOtherOwner.status).toBe(403)
    expect(state.clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM "user"'))
  })
})

const operatorRoutes = [
  ['control command', issueControl, '/api/v1/controls/commands', 'POST'],
  ['ventilation command', issueVentilation, '/api/v1/controls/ventilation', 'POST'],
  ['settings update', updateSettings, '/api/v1/settings', 'PATCH'],
  ['simulator action', simulatorAction, '/api/simulator/actions', 'POST'],
] as const

describe('operator command and team routes', () => {
  it.each(operatorRoutes)('%s rejects guests and view-only users before processing the body', async (_name, handler, path, method) => {
    for (const [role, status] of [['guest', 401], ['user', 403]] as const) {
      setIdentity(role)
      const response = await handler(jsonRequest(path, method, { action: 'invalid' }))
      expect(response.status, `${role} on ${path}`).toBe(status)
    }
  })

  it.each(operatorRoutes)('%s lets operators and owners reach input validation', async (_name, handler, path, method) => {
    for (const role of ['operator', 'owner'] as const) {
      setIdentity(role)
      const response = await handler(jsonRequest(path, method, {}))
      expect(response.status, `${role} on ${path}`).not.toBe(401)
      expect(response.status, `${role} on ${path}`).not.toBe(403)
    }
  })

  it('does not accept the browser session cookie on a machine-only command route', async () => {
    setIdentity('owner')
    process.env.DEVICE_API_TOKEN = 'device-token-' + 'd'.repeat(48)
    const request = new Request('https://aircheck.example/api/v1/controls/commands?device_id=room-01', {
      headers: { cookie: 'better-auth.session_token=browser-secret' },
    })

    const response = await readPendingCommands(request)

    expect(response.status).toBe(401)
    expect(state.poolQuery).not.toHaveBeenCalled()
  })
})
