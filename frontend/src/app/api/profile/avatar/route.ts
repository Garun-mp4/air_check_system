import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import { parseWebpDimensions, AVATAR_MAX_UPLOAD_BYTES, AVATAR_OUTPUT_SIZE } from '../../../../lib/avatar-image'
import { accessErrorResponse, AccessDeniedError, assertSameOrigin } from '../../../../server/access'
import { avatarIdFromImageUrl, avatarImageUrl, removeAvatar, storeAvatar } from '../../../../server/avatar-storage'
import { getAuth } from '../../../../server/auth'

export const runtime = 'nodejs'

class AvatarUploadError extends Error {
  constructor(readonly status: 400 | 413, readonly code: string, message: string) {
    super(message)
  }
}

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })
}

function carryAuthCookies(response: NextResponse, authResponse: Response): void {
  for (const cookie of authResponse.headers.getSetCookie()) response.headers.append('set-cookie', cookie)
}

async function readBoundedBody(request: Request): Promise<Buffer> {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > AVATAR_MAX_UPLOAD_BYTES) {
    throw new AvatarUploadError(413, 'avatar_too_large', 'Размер подготовленного аватара превышает 512 КБ')
  }

  const reader = request.body?.getReader()
  if (!reader) throw new AvatarUploadError(400, 'missing_avatar', 'Изображение не было передано')
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > AVATAR_MAX_UPLOAD_BYTES) {
        await reader.cancel()
        throw new AvatarUploadError(413, 'avatar_too_large', 'Размер подготовленного аватара превышает 512 КБ')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

async function updateUserImage(request: Request, image: string | null): Promise<Response> {
  return getAuth().api.updateUser({ headers: request.headers, body: { image }, asResponse: true })
}

async function readSessionUser(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session?.user) throw new AccessDeniedError(401, 'Войдите в аккаунт, чтобы изменить фото профиля')
  return session.user
}

export async function POST(request: Request): Promise<Response> {
  let userId: string | null = null
  let newAvatarId: string | null = null
  try {
    assertSameOrigin(request)
    const user = await readSessionUser(request)
    userId = user.id

    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'image/webp') {
      return errorResponse(415, 'unsupported_avatar_format', 'Редактор должен передать подготовленное изображение WebP.')
    }

    const contents = await readBoundedBody(request)
    const dimensions = parseWebpDimensions(contents)
    if (!dimensions || dimensions.width !== AVATAR_OUTPUT_SIZE || dimensions.height !== AVATAR_OUTPUT_SIZE) {
      return errorResponse(400, 'invalid_avatar_image', 'Изображение должно быть корректным квадратным WebP размером 512 × 512.')
    }

    const oldAvatarId = avatarIdFromImageUrl(user.image)
    newAvatarId = randomUUID()
    await storeAvatar(user.id, newAvatarId, contents)

    const avatarUrl = avatarImageUrl(newAvatarId)
    const authResponse = await updateUserImage(request, avatarUrl)
    if (!authResponse.ok) {
      await removeAvatar(user.id, newAvatarId)
      newAvatarId = null
      return authResponse
    }

    const authResult: unknown = await authResponse.clone().json().catch(() => null)
    if (typeof authResult !== 'object' || authResult === null || !('status' in authResult) || authResult.status !== true) {
      await removeAvatar(user.id, newAvatarId)
      newAvatarId = null
      return errorResponse(502, 'avatar_profile_update_failed', 'Фото не удалось сохранить в профиле. Попробуйте ещё раз.')
    }

    if (oldAvatarId && oldAvatarId !== newAvatarId) {
      await removeAvatar(user.id, oldAvatarId).catch((error) => console.error('previous profile avatar cleanup failed', error))
    }

    const response = NextResponse.json({ data: { image: avatarUrl } }, { headers: { 'Cache-Control': 'no-store' } })
    carryAuthCookies(response, authResponse)
    return response
  } catch (error) {
    if (userId && newAvatarId) await removeAvatar(userId, newAvatarId).catch(() => undefined)
    if (error instanceof AvatarUploadError) return errorResponse(error.status, error.code, error.message)
    const accessResponse = accessErrorResponse(error)
    if (accessResponse) return accessResponse
    console.error('profile avatar update failed', error)
    return errorResponse(503, 'avatar_storage_unavailable', 'Не удалось сохранить фото профиля. Повторите попытку позже.')
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request)
    const user = await readSessionUser(request)
    const oldAvatarId = avatarIdFromImageUrl(user.image)
    if (!oldAvatarId) return NextResponse.json({ data: { image: null } }, { headers: { 'Cache-Control': 'no-store' } })

    const authResponse = await updateUserImage(request, null)
    if (!authResponse.ok) return authResponse
    const authResult: unknown = await authResponse.clone().json().catch(() => null)
    if (typeof authResult !== 'object' || authResult === null || !('status' in authResult) || authResult.status !== true) {
      return errorResponse(502, 'avatar_profile_update_failed', 'Фото не удалось удалить из профиля. Попробуйте ещё раз.')
    }

    await removeAvatar(user.id, oldAvatarId).catch((error) => console.error('profile avatar cleanup failed', error))
    const response = NextResponse.json({ data: { image: null } }, { headers: { 'Cache-Control': 'no-store' } })
    carryAuthCookies(response, authResponse)
    return response
  } catch (error) {
    const accessResponse = accessErrorResponse(error)
    if (accessResponse) return accessResponse
    console.error('profile avatar removal failed', error)
    return errorResponse(503, 'avatar_storage_unavailable', 'Не удалось удалить фото профиля. Повторите попытку позже.')
  }
}
