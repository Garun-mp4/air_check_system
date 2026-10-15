import { NextResponse } from 'next/server'
import {
  ApiError,
  errorResponse,
  getAirQualityService,
} from '../../../../server/api'
import {
  accessErrorResponse,
  assertSameOrigin,
  requireOwner,
} from '../../../../server/access'
import {
  modelRequest,
  operationalQuality,
} from '../../../../server/model-management'
import { serializeMeasurement } from '../../../../server/serializers'
import { getConfig } from '../../../../server/config'
import { getRepository } from '../../../../server/repository'
export const runtime = 'nodejs'
export async function GET() {
  try {
    return NextResponse.json(
      {
        data: {
          ...(await modelRequest('status')),
          quality: await operationalQuality(),
          configured_horizon_minutes: getConfig().mlForecastHorizonMinutes ?? 15,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return errorResponse(error)
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    await requireOwner(request)
    const body = await request.json().catch(() => null)
    if (body?.action === 'rollback')
      return NextResponse.json({ data: await modelRequest('rollback', {}) })
    if (
      !['train', 'readiness'].includes(body?.action) ||
      !['real', 'simulator', 'unknown'].includes(body.source)
    )
      throw new ApiError(
        'invalid_request',
        'Выберите обучение и источник данных',
        400,
      )
    const config = getConfig()
    await getAirQualityService().nodeSettings()
    const records = await getRepository(config.databaseUrl).listMeasurements({
      to: new Date(),
      from: new Date(Date.now() - config.dataRetentionHours * 3600_000),
      dataSource: body.source,
      limit: 20000,
    })
    return NextResponse.json(
      {
        data: await modelRequest(body.action, {
          source: body.source,
          horizon_minutes: config.mlForecastHorizonMinutes ?? 15,
          measurements: records.map(serializeMeasurement),
        }),
      },
      { status: body.action === 'train' ? 202 : 200 },
    )
  } catch (error) {
    return accessErrorResponse(error) ?? errorResponse(error)
  }
}
