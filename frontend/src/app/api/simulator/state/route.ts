import { NextResponse } from 'next/server'

import { ApiError, errorResponse } from '../../../../server/api'
import { fetchSimulator } from '../../../../server/simulator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
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
