import { NextResponse } from 'next/server'

import { ApiError, errorResponse, getAirQualityService } from '../../../../server/api'
import { serializeNodeSettings } from '../../../../server/serializers'
import {
  parseDeviceId,
  parseNodeSettingsPatch,
} from '../../../../server/validation'
import { getConfig } from '../../../../server/config'
import { accessErrorResponse, assertSameOrigin, requireOperator } from '../../../../server/access'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams
    const config = getConfig()
    const deviceId = parseDeviceId(searchParams.get('device_id'), config.deviceId)
    const settings = await getAirQualityService().nodeSettings(deviceId)
    return NextResponse.json({ data: serializeNodeSettings(settings) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request)
    await requireOperator(request)
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
    const config = getConfig()
    const parsed = parseNodeSettingsPatch(payload, config.deviceId)
    const settings = await getAirQualityService().updateNodeSettings(
      parsed.deviceId,
      parsed.patch,
    )
    return NextResponse.json({ data: serializeNodeSettings(settings) })
  } catch (error) {
    return errorResponse(error)
  }
}
