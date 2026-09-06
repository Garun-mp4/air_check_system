import { NextResponse } from 'next/server'

import { errorResponse, getAirQualityService } from '../../../../server/api'
import { serializeRecommendation } from '../../../../server/serializers'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const recommendation = await getAirQualityService().latestRecommendation()
    return NextResponse.json({ data: serializeRecommendation(recommendation) })
  } catch (error) {
    return errorResponse(error)
  }
}
