import { NextResponse } from 'next/server'

import { getConfig } from '../../../../../server/config'
import { ApiError, errorResponse, getAirQualityService } from '../../../../../server/api'
import {
  serializeControlCommand,
  serializeControlStatus,
} from '../../../../../server/serializers'
import { parseVentilationCommand } from '../../../../../server/validation'

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
    const command = parseVentilationCommand(payload, getConfig().deviceId)
    const result = await getAirQualityService().issueVentilation(command)
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
