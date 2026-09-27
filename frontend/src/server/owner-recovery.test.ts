import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; parameters: unknown[] }>,
  poolOptions: [] as unknown[],
  recoveryRole: 'owner',
  release: vi.fn(),
  poolEnd: vi.fn(),
}))

vi.mock('better-auth/crypto', () => ({
  hashPassword: vi.fn(async (password: string) => `hashed:${password}`),
}))

vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      state.poolOptions.push(options)
      return {
        connect: async () => ({
          query: async (sql: string, parameters: unknown[] = []) => {
            state.queries.push({ sql, parameters })
            if (sql.includes('SELECT id FROM "user" WHERE lower(email)')) {
              return { rows: [{ id: 'owner-1' }], rowCount: 1 }
            }
            if (sql.includes("SELECT role FROM aircheck_access_roles WHERE user_id")) {
              return { rows: [{ role: state.recoveryRole }], rowCount: 1 }
            }
            return { rows: [], rowCount: 1 }
          },
          release: state.release,
        }),
        end: state.poolEnd,
      }
    }
  },
}))

const savedArgv = process.argv
const savedDatabaseUrl = process.env.DATABASE_URL
const savedExitCode = process.exitCode
const password = 'Recovery-pass-123'

beforeEach(() => {
  vi.resetModules()
  state.queries.length = 0
  state.poolOptions.length = 0
  state.recoveryRole = 'owner'
  process.argv = ['node', 'manage-owner.mjs', 'recover', ' Owner@Example.org ', '--password-stdin']
  process.env.DATABASE_URL = 'postgres://test'
  const stdin = (async function* () {
    yield `${password}\n${password}\n`
  })()
  vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(() => stdin)
})

afterEach(() => {
  process.argv = savedArgv
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = savedDatabaseUrl
  process.exitCode = savedExitCode
  vi.restoreAllMocks()
})

describe('owner password recovery tool', () => {
  it('updates only the existing owner credential, revokes sessions, and preserves the role', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    // @ts-expect-error The executable CLI intentionally has no TypeScript declaration.
    await import('../../scripts/manage-owner.mjs')

    expect(state.poolOptions).toEqual([{ connectionString: 'postgres://test', max: 1 }])
    expect(state.queries.map(({ sql }) => sql)).toContain('DELETE FROM "session" WHERE "userId" = $1')
    expect(state.queries.map(({ sql }) => sql)).toContain('COMMIT')
    expect(state.queries.find(({ sql }) => sql.includes('SELECT role FROM aircheck_access_roles'))?.parameters)
      .toEqual(['owner-1'])
    expect(state.queries.some(({ sql }) => sql.includes('INSERT INTO aircheck_access_roles'))).toBe(false)
    expect(state.queries.find(({ sql }) => sql.includes('INSERT INTO "account"'))?.parameters).toEqual([
      expect.any(String), 'owner-1', `hashed:${password}`,
    ])
    expect(state.queries.find(({ sql }) => sql.includes('INSERT INTO aircheck_access_audit'))?.parameters).toEqual([
      'owner-1', 'owner.password_recovered', 'owner', 'owner',
    ])
    expect(log).toHaveBeenCalledWith('Owner password recovered for owner@example.org.')
    expect(error).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join(' ')).not.toContain(password)
    expect(state.release).toHaveBeenCalledOnce()
    expect(state.poolEnd).toHaveBeenCalledOnce()
    expect(process.exitCode).toBe(savedExitCode)
  })

  it('refuses recovery for an account without the owner role before changing credentials', async () => {
    state.recoveryRole = 'user'
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    // @ts-expect-error The executable CLI intentionally has no TypeScript declaration.
    await import('../../scripts/manage-owner.mjs')

    expect(process.exitCode).toBe(1)
    expect(error).toHaveBeenCalledWith('The requested account is not the configured owner.')
    expect(state.queries.map(({ sql }) => sql)).toContain('ROLLBACK')
    expect(state.queries.some(({ sql }) => sql.includes('INSERT INTO "account"'))).toBe(false)
    expect(state.queries.some(({ sql }) => sql.includes('DELETE FROM "session"'))).toBe(false)
    expect(state.queries.map(({ sql }) => sql)).not.toContain('COMMIT')
    expect(log).not.toHaveBeenCalled()
    expect(error.mock.calls.flat().join(' ')).not.toContain(password)
  })
})
