import { NextResponse } from 'next/server'
import { accessErrorResponse, requireDeviceToken } from '../../../../server/access'
import { ApiError, errorResponse, getTelemetryService } from '../../../../server/api'
import { getConfig } from '../../../../server/config'
import { activeDataSource } from '../../../../server/runtime-mode'
import { parseTelemetry } from '../../../../server/telemetry-validation'
import { serializePrediction } from '../../../../server/serializers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function readPayload(request: Request): Promise<unknown> {
  if (!request.body) throw new ApiError('invalid_json', 'Требуется JSON', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > 32768) { await reader.cancel(); throw new ApiError('payload_too_large', 'Пакет больше 32 КБ', 413) }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new ApiError('invalid_json', 'Требуется корректный JSON в UTF-8', 400) }
}

export async function POST(request: Request) {
  try {
    requireDeviceToken(request)
    const delivery = request.headers.get('x-aircheck-delivery') ?? 'live'
    if (delivery !== 'live' && delivery !== 'archive') throw new ApiError('invalid_delivery', 'Ожидается live или archive', 400)
    const frame = parseTelemetry(await readPayload(request))
    if (frame.data_source !== activeDataSource()) throw new ApiError('inactive_source', 'Источник не соответствует режиму установки', 409)
    const result = await getTelemetryService().ingest(frame, delivery)
    return NextResponse.json({ data: { id: result.record.id, received_at: result.record.received_at, duplicate: result.duplicate, current: result.current, measurement_id: result.measurementId, prediction: serializePrediction(result.prediction) } }, { status: result.duplicate ? 200 : 201 })
  } catch (error) { return accessErrorResponse(error) ?? errorResponse(error) }
}

export async function GET() {
  try {
    const source = activeDataSource()
    return NextResponse.json({ data: await getTelemetryService().latest(source), meta: { data_source: source, device_id: getConfig().deviceId, assessed_at: new Date().toISOString() } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
