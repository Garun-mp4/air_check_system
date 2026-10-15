import { NextResponse } from 'next/server'
import { errorResponse, getAirQualityService, getTelemetryStore } from '../../../../server/api'
import { getConfig } from '../../../../server/config'
import { activeDataSource } from '../../../../server/runtime-mode'
import { parseHistoryQuery, ValidationError } from '../../../../server/validation'
import { serializeMeasurement } from '../../../../server/serializers'
import { liveMeasurement } from '../../../../lib/telemetry-view'

export const runtime = 'nodejs'
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    // The public ML history remains complete-only. UI observations include gaps per channel.
    const limit = Number(params.get('limit') ?? 20000)
    const checked = new URLSearchParams(params); checked.set('limit', String(Math.min(limit, 5000)))
    const query = parseHistoryQuery(checked, 5000)
    if (!Number.isInteger(limit) || limit < 1 || limit > 20000) throw new ValidationError([{ field: 'limit', message: 'должно быть целым числом от 1 до 20000' }])
    const config = getConfig(), service = getAirQualityService()
    await service.readyForRuntime()
    const from = query.from ?? new Date(Date.now() - config.dataRetentionHours * 3600000)
    const to = new Date(Math.min(query.to?.getTime() ?? Date.now(), Date.now()))
    const [raw, complete] = await Promise.all([
      getTelemetryStore().history(config.deviceId, activeDataSource(), from, to, limit),
      service.history({ ...query, from, to, limit }),
    ])
    const data = [
      ...raw.flatMap(record => { const value = liveMeasurement(record, null, Date.parse(record.frame.sampled_at ?? '')); return value ? [value] : [] }),
      ...complete.filter(value => !value.ingestKey?.startsWith('v2:')).map(value => ({ ...serializeMeasurement(value), observation_key: 'legacy:' + value.id })),
    ].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id - b.id).slice(-limit)
    return NextResponse.json({ data, meta: { count: data.length, from: from.toISOString(), to: to.toISOString(), limit } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
