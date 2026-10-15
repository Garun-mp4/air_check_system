import { NextResponse } from 'next/server'

import { ApiError, errorResponse, getRealSystemSnapshot } from '../../../../server/api'
import { fetchSimulator } from '../../../../server/simulator'
import { runtimeMode } from '../../../../server/runtime-mode'
import { createStateStream } from '../../../../server/state-stream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  try {
    if (runtimeMode() === 'real') return new Response(createStateStream(request.signal, getRealSystemSnapshot), {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' },
    })
    const upstream = await fetchSimulator('/v1/events', { signal: request.signal })
    if (!upstream.ok || !upstream.body) {
      throw new ApiError('simulator_error', 'Поток состояния симулятора недоступен', 503)
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
