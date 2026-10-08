import { NextResponse } from 'next/server'
import { errorResponse } from '../../../../server/api'
import {
  accessErrorResponse,
  assertSameOrigin,
  requireOwner,
} from '../../../../server/access'
import {
  notificationSettings,
  publicNotificationSettings,
  saveNotificationSettings,
  queueChannelTest,
} from '../../../../server/notifications'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  try {
    await requireOwner(request)
    return NextResponse.json(
      { data: publicNotificationSettings(await notificationSettings()) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return accessErrorResponse(error) ?? errorResponse(error)
  }
}
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request)
    await requireOwner(request)
    return NextResponse.json({
      data: await saveNotificationSettings(
        await request.json().catch(() => null),
      ),
    })
  } catch (error) {
    return accessErrorResponse(error) ?? errorResponse(error)
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    await requireOwner(request)
    const body = await request.json().catch(() => null)
    await queueChannelTest(body?.chat_id)
    return NextResponse.json({ data: { queued: true } }, { status: 202 })
  } catch (error) {
    return accessErrorResponse(error) ?? errorResponse(error)
  }
}
