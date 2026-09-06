import { NextResponse } from 'next/server'

import { getConfig } from '../../../../../server/config'
import { errorResponse, getAirQualityService } from '../../../../../server/api'
import { serializeMeasurement } from '../../../../../server/serializers'
import { parseHistoryQuery } from '../../../../../server/validation'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const query = parseHistoryQuery(
      new URL(request.url).searchParams,
      getConfig().historyLimit,
    )
    const measurements = await getAirQualityService().history(query)
    return NextResponse.json({
      data: measurements.map(serializeMeasurement),
      meta: {
        count: measurements.length,
        from: query.from?.toISOString() ?? null,
        to: query.to?.toISOString() ?? null,
        limit: query.limit,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
