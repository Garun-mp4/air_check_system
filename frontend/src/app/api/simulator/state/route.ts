import { NextResponse } from 'next/server'

import { ApiError, errorResponse, getRealSystemSnapshot } from '../../../../server/api'
import { fetchSimulator } from '../../../../server/simulator'
import { runtimeMode } from '../../../../server/runtime-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    if (runtimeMode() === 'real') return NextResponse.json({ data: await getRealSystemSnapshot() }, { headers: { 'Cache-Control': 'no-store' } })
    const upstream = await fetchSimulator('/v1/state')
    if (!upstream.ok) throw new ApiError('simulator_error', 'Headless simulator вернул ошибку', 503)
    return new Response(upstream.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
