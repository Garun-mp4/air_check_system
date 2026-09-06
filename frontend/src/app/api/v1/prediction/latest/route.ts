import { NextResponse } from 'next/server'

import { errorResponse, getAirQualityService } from '../../../../../server/api'
import { serializePrediction } from '../../../../../server/serializers'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const prediction = await getAirQualityService().latestPrediction()
    return NextResponse.json({ data: serializePrediction(prediction) })
  } catch (error) {
    return errorResponse(error)
  }
}
