import { NextResponse } from 'next/server'

import { errorResponse, getAirQualityService } from '../../../../../server/api'
import { serializeDashboard } from '../../../../../server/serializers'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const result = await getAirQualityService().latest()
    return NextResponse.json({ data: serializeDashboard(result) })
  } catch (error) {
    return errorResponse(error)
  }
}
