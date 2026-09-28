import { NextResponse } from 'next/server'

import passwordPolicy from '../../../../../password-policy.json'
import { accessErrorResponse, assertSameOrigin, requireOwner } from '../../../../server/access'
import { errorResponse, ApiError } from '../../../../server/api'
import { getAuthPool } from '../../../../server/auth'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    await requireOwner(request)
    const result = await getAuthPool().query<{
      id: string
      email: string
      name: string
      role: 'user' | 'operator' | 'owner'
      operator_expires_at: Date | null
      created_at: Date
    }>(
      `SELECT u.id, u.email, u.name, COALESCE(r.role, 'user') AS role,
              r.operator_expires_at, u."createdAt" AS created_at
       FROM "user" u LEFT JOIN aircheck_access_roles r ON r.user_id = u.id
       ORDER BY CASE WHEN r.role = 'owner' THEN 0 ELSE 1 END, u."createdAt" ASC`,
    )
    const now = Date.now()
    return NextResponse.json({
      data: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role === 'operator' && row.operator_expires_at && row.operator_expires_at.getTime() <= now ? 'user' : row.role,
        operator_expires_at: row.role === 'operator' && (!row.operator_expires_at || row.operator_expires_at.getTime() > now)
          ? row.operator_expires_at?.toISOString() ?? null
          : null,
        created_at: row.created_at.toISOString(),
      })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const accessResponse = accessErrorResponse(error)
    return accessResponse ?? errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    await requireOwner(request)
    const payload: unknown = await request.json()
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new ApiError('invalid_user', 'Некорректные данные учётной записи', 400)
    }
    const input = payload as Record<string, unknown>
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const password = typeof input.password === 'string' ? input.password : ''
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !name || name.length > 80 || password.length < passwordPolicy.minimumLength || password.length > passwordPolicy.maximumLength) {
      throw new ApiError('invalid_user', `Укажите email, имя и пароль от ${passwordPolicy.minimumLength} до ${passwordPolicy.maximumLength} символов`, 400)
    }
    const auth = await import('../../../../server/auth').then((module) => module.getAuth())
    const created = await auth.api.signUpEmail({
      body: { email, name, password },
    })
    return NextResponse.json({ data: { id: created.user.id, email: created.user.email, name: created.user.name } }, { status: 201 })
  } catch (error) {
    const accessResponse = accessErrorResponse(error)
    return accessResponse ?? errorResponse(error)
  }
}
