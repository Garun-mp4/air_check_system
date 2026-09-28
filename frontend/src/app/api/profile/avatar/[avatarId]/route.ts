import { NextResponse } from 'next/server'

import { AccessDeniedError, accessErrorResponse } from '../../../../../server/access'
import { avatarIdFromImageUrl, readAvatar } from '../../../../../server/avatar-storage'
import { getAuth } from '../../../../../server/auth'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ avatarId: string }>
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await getAuth().api.getSession({ headers: request.headers })
    if (!session?.user) throw new AccessDeniedError(401, 'Войдите в аккаунт, чтобы просмотреть фото профиля')

    const { avatarId } = await context.params
    if (avatarIdFromImageUrl(session.user.image) !== avatarId) {
      return NextResponse.json({ error: { code: 'not_found', message: 'Фото профиля не найдено' } }, { status: 404 })
    }

    const image = await readAvatar(session.user.id, avatarId)
    const body = new Uint8Array(image.byteLength)
    body.set(image)
    return new Response(body, {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(image.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  } catch (error) {
    const accessResponse = accessErrorResponse(error)
    if (accessResponse) return accessResponse
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: { code: 'not_found', message: 'Фото профиля не найдено' } }, { status: 404 })
    }
    console.error('profile avatar read failed', error)
    return NextResponse.json({ error: { code: 'avatar_storage_unavailable', message: 'Фото профиля временно недоступно' } }, { status: 503 })
  }
}
