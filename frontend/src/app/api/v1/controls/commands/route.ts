import { NextResponse } from 'next/server'

import { getConfig } from '../../../../../server/config'
import { ApiError, errorResponse, getAirQualityService } from '../../../../../server/api'
import {
  serializeControlCommand,
  serializeControlStatus,
} from '../../../../../server/serializers'
import {
  parseControlCommand,
  parseControlLimit,
  parseDeviceId,
} from '../../../../../server/validation'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams
    const config = getConfig()
    const deviceId = parseDeviceId(searchParams.get('device_id'), config.deviceId)
    const limit = parseControlLimit(searchParams)
    const commands = await getAirQualityService().pendingControlCommands(
      deviceId,
      limit,
    )
    return NextResponse.json({
      data: commands.map(serializeControlCommand),
      meta: { count: commands.length, device_id: deviceId, limit },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

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
    const command = parseControlCommand(payload, getConfig().deviceId)
    const result = await getAirQualityService().issueControl(command)
    return NextResponse.json(
      {
        data: {
          commands: result.commands.map(serializeControlCommand),
          controls: serializeControlStatus(result.status),
        },
      },
      { status: result.commands.length > 0 ? 202 : 200 },
    )
  } catch (error) {
    return errorResponse(error)
  }
}
