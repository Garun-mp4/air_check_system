import { timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'

import type { AccessInfo, AccessRole } from '../lib/access-types'
import { getAuth, getAuthPool } from './auth'

export type { AccessRole } from '../lib/access-types'

export type AccessContext = AccessInfo

export class AccessDeniedError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message)
  }
}

export class AccessUnavailableError extends Error {
  constructor() {
    super('Проверка доступа временно недоступна')
    this.name = 'AccessUnavailableError'
  }
}

export function effectiveRole(
  role: Exclude<AccessRole, 'guest'>,
  expiresAt: Date | null,
  now = Date.now(),
): AccessRole {
  return role === 'operator' && expiresAt !== null && expiresAt.getTime() <= now
    ? 'user'
    : role
}

export async function readAccess(request: Request): Promise<AccessContext> {
  try {
    const session = await getAuth().api.getSession({ headers: request.headers })
    if (!session?.user) {
      return { userId: null, email: null, name: null, role: 'guest', operatorExpiresAt: null }
    }

    const result = await getAuthPool().query<{
      role: Exclude<AccessRole, 'guest'>
      operator_expires_at: Date | null
    }>(
      `SELECT role, operator_expires_at FROM aircheck_access_roles WHERE user_id = $1`,
      [session.user.id],
    )
    const row = result.rows[0]
    const storedRole = row?.role ?? 'user'
    const role = effectiveRole(storedRole, row?.operator_expires_at ?? null)
    const operatorExpiresAt = storedRole === 'operator' ? row?.operator_expires_at?.toISOString() ?? null : null
    return {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role,
      operatorExpiresAt,
    }
  } catch (error) {
    console.error('authorization check failed', error)
    throw new AccessUnavailableError()
  }
}

export async function requireOperator(request: Request): Promise<AccessContext> {
  const access = await readAccess(request)
  if (access.role === 'guest') {
    throw new AccessDeniedError(401, 'Войдите в аккаунт с правами оператора')
  }
  if (access.role !== 'operator' && access.role !== 'owner') {
    throw new AccessDeniedError(403, 'Для этого действия нужны права оператора')
  }
  return access
}

export async function requireOwner(request: Request): Promise<AccessContext> {
  const access = await readAccess(request)
  if (access.role === 'guest') {
    throw new AccessDeniedError(401, 'Войдите в аккаунт владельца установки')
  }
  if (access.role !== 'owner') {
    throw new AccessDeniedError(403, 'Управлять учётными записями может только владелец')
  }
  return access
}

export function accessErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AccessUnavailableError) {
    return NextResponse.json(
      { error: { code: 'auth_unavailable', message: error.message } },
      { status: 503 },
    )
  }
  if (error instanceof AccessDeniedError) {
    return NextResponse.json(
      { error: { code: error.status === 401 ? 'unauthorized' : 'forbidden', message: error.message } },
      { status: error.status },
    )
  }
  return null
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    ?? new URL(request.url).protocol.replace(':', '')
  if (!origin || !host || origin !== `${proto}://${host}`) {
    throw new AccessDeniedError(403, 'Источник запроса не прошёл проверку')
  }
}

export function requireDeviceToken(request: Request): void {
  const expected = process.env.DEVICE_API_TOKEN?.trim() ?? ''
  if (expected.length < 32) {
    throw new AccessDeniedError(403, 'Device API token is not configured')
  }
  const authorization = request.headers.get('authorization') ?? ''
  const [scheme, token, extra] = authorization.split(' ')
  const actualBuffer = Buffer.from(token ?? '')
  const expectedBuffer = Buffer.from(expected)
  const valid = scheme?.toLowerCase() === 'bearer'
    && !extra
    && actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer)
  if (!valid) {
    throw new AccessDeniedError(401, 'Valid device credentials are required')
  }
}
