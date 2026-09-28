import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(),
  poolQuery: vi.fn(),
  poolCreated: vi.fn(),
}))

vi.mock('better-auth', () => ({ betterAuth: mocks.betterAuth }))
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      mocks.poolCreated(options)
      return { query: mocks.poolQuery }
    }
  },
}))

const originalEnvironment = {
  secret: process.env.BETTER_AUTH_SECRET,
  url: process.env.BETTER_AUTH_URL,
  origins: process.env.BETTER_AUTH_TRUSTED_ORIGINS,
  nodeEnv: process.env.NODE_ENV,
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.BETTER_AUTH_SECRET = 's'.repeat(48)
  process.env.BETTER_AUTH_URL = 'https://aircheck.example/'
  process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://aircheck.example,http://localhost:3000'
  Reflect.set(process.env, 'NODE_ENV', 'test')
  mocks.betterAuth.mockReturnValue({ handler: vi.fn() })
  mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 1 })
})

afterEach(() => {
  if (originalEnvironment.secret === undefined) delete process.env.BETTER_AUTH_SECRET
  else process.env.BETTER_AUTH_SECRET = originalEnvironment.secret
  if (originalEnvironment.url === undefined) delete process.env.BETTER_AUTH_URL
  else process.env.BETTER_AUTH_URL = originalEnvironment.url
  if (originalEnvironment.origins === undefined) delete process.env.BETTER_AUTH_TRUSTED_ORIGINS
  else process.env.BETTER_AUTH_TRUSTED_ORIGINS = originalEnvironment.origins
  if (originalEnvironment.nodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV')
  else Reflect.set(process.env, 'NODE_ENV', originalEnvironment.nodeEnv)
})

describe('Better Auth policy wired by the server', () => {
  it('refuses to initialize without a 32-character server secret', async () => {
    const { getAuth } = await import('./auth')
    delete process.env.BETTER_AUTH_SECRET
    expect(() => getAuth()).toThrow('BETTER_AUTH_SECRET must contain at least 32 characters')
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(31)
    expect(() => getAuth()).toThrow('BETTER_AUTH_SECRET must contain at least 32 characters')
    expect(mocks.betterAuth).not.toHaveBeenCalled()
  })

  it('enables email registration with the configured password policy and session support', async () => {
    const { getAuth } = await import('./auth')
    getAuth()

    const options = mocks.betterAuth.mock.calls[0]?.[0]
    expect(options).toMatchObject({
      appName: 'AirCheck',
      baseURL: 'https://aircheck.example',
      trustedOrigins: ['https://aircheck.example', 'http://localhost:3000'],
      emailAndPassword: {
        enabled: true,
        disableSignUp: false,
        requireEmailVerification: false,
        minPasswordLength: 15,
        maxPasswordLength: 128,
      },
    })
    expect(options.session).toBeDefined()
  })

  it('assigns new registrations the least-privileged user role', async () => {
    const { getAuth } = await import('./auth')
    getAuth()
    const options = mocks.betterAuth.mock.calls[0]?.[0] as {
      databaseHooks: {
        user: {
          create: { after: (user: { id: string }) => Promise<void> }
        }
      }
    }

    await options.databaseHooks.user.create.after({ id: 'new-account' })

    expect(mocks.poolQuery).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, 'user') ON CONFLICT (user_id) DO NOTHING"),
      ['new-account'],
    )
  })

  it('marks auth cookies secure only in production and keeps them HTTP-only with same-site lax', async () => {
    const { getAuth } = await import('./auth')
    getAuth()
    expect(mocks.betterAuth.mock.calls[0]?.[0]).toMatchObject({
      advanced: {
        useSecureCookies: false,
        defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: false },
      },
    })

    vi.resetModules()
    mocks.betterAuth.mockClear()
    Reflect.set(process.env, 'NODE_ENV', 'production')
    const productionAuth = await import('./auth')
    productionAuth.getAuth()
    expect(mocks.betterAuth.mock.calls[0]?.[0]).toMatchObject({
      advanced: {
        useSecureCookies: true,
        defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: true },
      },
    })
  })
})
