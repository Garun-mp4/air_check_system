import { NextResponse } from 'next/server'
import { errorResponse, getAirQualityService } from '../../../../server/api'
import {
  accessErrorResponse,
  assertSameOrigin,
  requireSignedIn,
} from '../../../../server/access'
import {
  refreshEvents,
  listEvents,
  markEventRead,
} from '../../../../server/notifications'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  try {
    const access = await requireSignedIn(request)
    await getAirQualityService().controlsStatus()
    await refreshEvents()
    return NextResponse.json(
      { data: await listEvents(access.userId!) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return accessErrorResponse(error) ?? errorResponse(error)
  }
}
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request)
    const access = await requireSignedIn(request)
    const body = await request.json().catch(() => null)
    await markEventRead(body?.id, access.userId!)
    return NextResponse.json({ data: { read: true } })
  } catch (error) {
    return accessErrorResponse(error) ?? errorResponse(error)
  }
}
