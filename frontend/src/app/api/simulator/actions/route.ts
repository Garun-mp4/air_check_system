import { NextResponse } from 'next/server'

import { accessErrorResponse, assertSameOrigin, requireOperator } from '../../../../server/access'
import { ApiError, errorResponse } from '../../../../server/api'
import { fetchSimulator } from '../../../../server/simulator'

export const runtime = 'nodejs'

const actionNames = new Set(['scenario', 'demo_start', 'demo_stop', 'pause', 'speed', 'debug_set'])

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    await requireOperator(request)
    const payload: unknown = await request.json()
    if (
      typeof payload !== 'object' || payload === null || Array.isArray(payload)
      || !('action' in payload) || typeof payload.action !== 'string'
      || !actionNames.has(payload.action)
      || ('payload' in payload && (typeof payload.payload !== 'object' || payload.payload === null || Array.isArray(payload.payload)))
    ) {
      throw new ApiError('invalid_simulator_action', 'Некорректное действие симулятора', 400)
    }
    const upstream = await fetchSimulator('/v1/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      const detail = typeof body?.detail === 'string' ? body.detail : 'Headless simulator не принял действие'
      throw new ApiError('simulator_action_failed', detail, upstream.status === 422 ? 400 : upstream.status)
    }
    return NextResponse.json(body, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const accessResponse = accessErrorResponse(error)
    return accessResponse ?? errorResponse(error)
  }
}
