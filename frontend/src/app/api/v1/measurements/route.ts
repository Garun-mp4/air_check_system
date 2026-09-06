import { NextResponse } from 'next/server'

import { ApiError, errorResponse, getAirQualityService } from '../../../../server/api'
import { serializeIngest } from '../../../../server/serializers'
import { parseMeasurementInput } from '../../../../server/validation'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return errorResponse(
      new ApiError(
        'invalid_json',
        'Тело запроса должно быть корректным JSON',
        400,
      ),
    )
  }

  try {
    const result = await getAirQualityService().ingest(parseMeasurementInput(payload))
    return NextResponse.json({ data: serializeIngest(result) }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
