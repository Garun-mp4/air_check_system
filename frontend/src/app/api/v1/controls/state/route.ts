import { NextResponse } from 'next/server'

import { getConfig } from '../../../../../server/config'
import {
  ApiError,
  errorResponse,
  getAirQualityService,
} from '../../../../../server/api'
import { serializeControlStatus } from '../../../../../server/serializers'
import { parseDeviceStateReport } from '../../../../../server/validation'
import { accessErrorResponse, requireDeviceToken } from '../../../../../server/access'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    requireDeviceToken(request)
  } catch (error) {
    const response = accessErrorResponse(error)
    if (response) return response
    throw error
  }
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
    const report = parseDeviceStateReport(payload, getConfig().deviceId)
    const status = await getAirQualityService().reportControlState(report)
    return NextResponse.json({ data: serializeControlStatus(status) })
  } catch (error) {
    return errorResponse(error)
  }
}
