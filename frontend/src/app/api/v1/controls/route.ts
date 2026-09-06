import { NextResponse } from 'next/server'

import { getConfig } from '../../../../server/config'
import { errorResponse, getAirQualityService } from '../../../../server/api'
import { serializeControlStatus } from '../../../../server/serializers'
import { parseDeviceId } from '../../../../server/validation'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams
    const deviceId = parseDeviceId(
      searchParams.get('device_id'),
      getConfig().deviceId,
    )
    const status = await getAirQualityService().controlsStatus(deviceId)
    return NextResponse.json({ data: serializeControlStatus(status) })
  } catch (error) {
    return errorResponse(error)
  }
}
