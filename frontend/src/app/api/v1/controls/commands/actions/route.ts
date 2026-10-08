import { NextResponse } from 'next/server'
import {
  accessErrorResponse,
  assertSameOrigin,
  requireOperator,
} from '../../../../../../server/access'
import {
  ApiError,
  errorResponse,
  getAirQualityService,
} from '../../../../../../server/api'
import { getConfig } from '../../../../../../server/config'
import {
  serializeControlStatus,
  serializeControlCommand,
} from '../../../../../../server/serializers'
import { parseDeviceId } from '../../../../../../server/validation'

export const runtime = 'nodejs'
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    await requireOperator(request)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new ApiError('invalid_json', 'Требуется JSON', 400)
    }
    if (!body || typeof body !== 'object')
      throw new ApiError('validation_error', 'Требуется объект', 400)
    const input = body as Record<string, unknown>
    if (
      !Number.isSafeInteger(input.id) ||
      (input.id as number) < 1 ||
      (input.action !== 'cancel' && input.action !== 'retry')
    )
      throw new ApiError(
        'validation_error',
        'Укажите id команды и действие cancel/retry',
        400,
      )
    if (input.device_id !== undefined && typeof input.device_id !== 'string')
      throw new ApiError(
        'validation_error',
        'device_id должен быть строкой',
        400,
      )
    const deviceId = parseDeviceId(
      input.device_id as string | undefined,
      getConfig().deviceId,
    )
    const result = await getAirQualityService().commandAction(
      deviceId,
      input.id as number,
      input.action,
    )
    return NextResponse.json({
      data: {
        commands: result.commands.map(serializeControlCommand),
        controls: serializeControlStatus(result.status),
      },
    })
  } catch (error) {
    return accessErrorResponse(error) ?? errorResponse(error)
  }
}
