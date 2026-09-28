import { NextResponse } from 'next/server'

import { accessErrorResponse, assertSameOrigin, requireOwner } from '../../../../../server/access'
import { removeUserAvatars } from '../../../../../server/avatar-storage'
import { ApiError, errorResponse } from '../../../../../server/api'
import { getAuthPool } from '../../../../../server/auth'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ userId: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
  const client = await getAuthPool().connect()
  try {
    assertSameOrigin(request)
    const actor = await requireOwner(request)
    const { userId } = await context.params
    const payload: unknown = await request.json()
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new ApiError('invalid_role', 'Некорректные данные роли', 400)
    }
    const input = payload as Record<string, unknown>
    const role = input.role
    if (role !== 'user' && role !== 'operator') {
      throw new ApiError('invalid_role', 'Разрешено назначить только пользователя или оператора', 400)
    }
    let expiresAt: Date | null = null
    if (role === 'operator' && input.expires_at !== null && input.expires_at !== undefined) {
      if (typeof input.expires_at !== 'string') {
        throw new ApiError('invalid_expiry', 'Срок полномочий указан неверно', 400)
      }
      expiresAt = new Date(input.expires_at)
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        throw new ApiError('invalid_expiry', 'Срок полномочий должен быть в будущем', 400)
      }
    }

    await client.query('BEGIN')
    const owner = await client.query(`SELECT user_id FROM aircheck_access_roles WHERE role = 'owner' FOR UPDATE`)
    if (owner.rows[0]?.user_id !== actor.userId) {
      throw new ApiError('owner_changed', 'Права владельца изменились; обновите страницу', 403)
    }
    const subject = await client.query<{ role: string }>(
      `SELECT COALESCE(r.role, 'user') AS role FROM "user" u
       LEFT JOIN aircheck_access_roles r ON r.user_id = u.id WHERE u.id = $1 FOR UPDATE OF u`,
      [userId],
    )
    if (!subject.rowCount) throw new ApiError('not_found', 'Учётная запись не найдена', 404)
    if (subject.rows[0].role === 'owner') {
      throw new ApiError('owner_protected', 'Учётную запись владельца нельзя менять из панели', 403)
    }
    await client.query(
      `INSERT INTO aircheck_access_roles (user_id, role, operator_expires_at, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role,
         operator_expires_at = EXCLUDED.operator_expires_at, updated_at = NOW()`,
      [userId, role, role === 'operator' ? expiresAt : null],
    )
    await client.query(
      `INSERT INTO aircheck_access_audit
       (actor_user_id, subject_user_id, action, previous_role, new_role, expires_at)
       VALUES ($1, $2, 'role.updated', $3, $4, $5)`,
      [actor.userId, userId, subject.rows[0].role, role, role === 'operator' ? expiresAt : null],
    )
    await client.query('COMMIT')
    return NextResponse.json({ data: { user_id: userId, role, operator_expires_at: role === 'operator' ? expiresAt?.toISOString() ?? null : null } })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    const accessResponse = accessErrorResponse(error)
    return accessResponse ?? errorResponse(error)
  } finally {
    client.release()
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const client = await getAuthPool().connect()
  try {
    assertSameOrigin(request)
    const actor = await requireOwner(request)
    const { userId } = await context.params
    if (userId === actor.userId) {
      throw new ApiError('owner_protected', 'Владелец не может удалить собственную учётную запись', 403)
    }
    await client.query('BEGIN')
    const owner = await client.query(`SELECT user_id FROM aircheck_access_roles WHERE role = 'owner' FOR UPDATE`)
    if (owner.rows[0]?.user_id !== actor.userId) {
      throw new ApiError('owner_changed', 'Права владельца изменились; обновите страницу', 403)
    }
    const subject = await client.query<{ role: string }>(
      `SELECT COALESCE(r.role, 'user') AS role FROM "user" u
       LEFT JOIN aircheck_access_roles r ON r.user_id = u.id WHERE u.id = $1 FOR UPDATE OF u`,
      [userId],
    )
    if (!subject.rowCount) throw new ApiError('not_found', 'Учётная запись не найдена', 404)
    if (subject.rows[0].role === 'owner') {
      throw new ApiError('owner_protected', 'Единственного владельца нельзя удалить', 403)
    }
    await client.query(
      `INSERT INTO aircheck_access_audit (actor_user_id, subject_user_id, action, previous_role)
       VALUES ($1, $2, 'user.deleted', $3)`,
      [actor.userId, userId, subject.rows[0].role],
    )
    await client.query(`DELETE FROM "user" WHERE id = $1`, [userId])
    await client.query('COMMIT')
    await removeUserAvatars(userId).catch((error) => console.error('deleted account avatar cleanup failed', error))
    return NextResponse.json({ data: { deleted: true } })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    const accessResponse = accessErrorResponse(error)
    return accessResponse ?? errorResponse(error)
  } finally {
    client.release()
  }
}
