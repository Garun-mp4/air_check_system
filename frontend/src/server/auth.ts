import { betterAuth } from 'better-auth'
import { Pool } from 'pg'

import { getConfig } from './config'
import { parseTrustedOrigins } from './trusted-origins'

let pool: Pool | null = null

export function getAuthPool(): Pool {
  if (pool) return pool
  pool = new Pool({
    connectionString: getConfig().databaseUrl,
    max: 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
  return pool
}

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim()
  if (!secret || secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters')
  }
  const publicUrl = process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, '')
  const trustedOrigins = parseTrustedOrigins(process.env.BETTER_AUTH_TRUSTED_ORIGINS)

  return betterAuth({
    appName: 'AirCheck',
    ...(publicUrl ? { baseURL: publicUrl } : {}),
    secret,
    database: getAuthPool(),
    ...(trustedOrigins ? { trustedOrigins } : {}),
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 10,
      customRules: {
        '/sign-in/email': { window: 60, max: 8 },
        '/sign-up/email': { window: 60 * 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await getAuthPool().query(
              `INSERT INTO aircheck_access_roles (user_id, role)
               VALUES ($1, 'user') ON CONFLICT (user_id) DO NOTHING`,
              [user.id],
            )
          },
        },
      },
    },
  })
}

type AuthInstance = ReturnType<typeof createAuth>
let authInstance: AuthInstance | null = null

export function getAuth(): AuthInstance {
  if (authInstance) return authInstance
  const instance = createAuth()
  authInstance = instance
  return instance
}
