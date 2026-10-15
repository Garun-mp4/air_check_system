import { NextResponse } from 'next/server'

import { startNotificationWorker } from './notifications'
import { getConfig } from './config'
import { MlClient } from './ml-client'
import { NotFoundError, getRepository } from './repository'
import { AirQualityService } from './service'
import { ValidationError } from './validation'
import { getAuthPool } from './auth'
import { PostgresTelemetryStore } from './telemetry-store'
import { TelemetryService } from './telemetry-service'
import { realSystemSnapshot } from './system-snapshot'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fields?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let service: AirQualityService | null = null
let automationTimer: ReturnType<typeof setInterval> | null = null
let retentionTimer: ReturnType<typeof setInterval> | null = null
let telemetryStore: PostgresTelemetryStore | null = null
let telemetryService: TelemetryService | null = null

export function getTelemetryStore(): PostgresTelemetryStore {
  return telemetryStore ??= new PostgresTelemetryStore(getAuthPool())
}
export function getTelemetryService(): TelemetryService {
  if (!telemetryService) {
    const config = getConfig()
    telemetryService = new TelemetryService(getTelemetryStore(), getRepository(config.databaseUrl), getAirQualityService(), config.deviceId)
  }
  return telemetryService
}

export async function getRealSystemSnapshot() {
  const air = getAirQualityService()
  await air.readyForRuntime()
  const [record, controls, settings, dashboard] = await Promise.all([
    getTelemetryStore().latest(getConfig().deviceId, 'real'), air.controlsStatus(), air.nodeSettings(), air.latest(),
  ])
  return realSystemSnapshot(record, controls, settings, dashboard)
}

const RETENTION_CLEANUP_INTERVAL_MS = 15 * 60 * 1000

function startRetentionCleanup(nextService: AirQualityService): void {
  if (retentionTimer !== null) {
    return
  }

  const runCleanup = async () => {
    try {
      const result = await nextService.cleanupExpiredData()
      if (telemetryStore) await telemetryStore.prune(new Date(Date.now() - getConfig().dataRetentionHours * 3600000))
      const deleted =
        result.measurements +
        result.predictions +
        result.recommendations +
        result.commands
      if (deleted > 0) {
        console.info('data retention cleanup completed', result)
      }
    } catch (error) {
      // A transient database failure must not stop future cleanup attempts.
      console.error('data retention cleanup failed', error)
    }
  }

  if (automationTimer === null) {
    automationTimer = setInterval(() => {
      void nextService.readyForRuntime().then(() => { startNotificationWorker(); return nextService.controlsStatus() }).catch(error => console.error('automatic safety refresh failed', error))
    }, 10_000)
    automationTimer.unref?.()
  }
  void runCleanup()
  retentionTimer = setInterval(() => void runCleanup(), RETENTION_CLEANUP_INTERVAL_MS)
  retentionTimer.unref?.()
}

export function getAirQualityService(): AirQualityService {
  if (!service) {
    const config = getConfig()
    const nextService = new AirQualityService(
      getRepository(config.databaseUrl),
      new MlClient(config.mlServiceUrl, config.mlRequestTimeoutMs),
      config,
      undefined,
      config.dataSource ? getTelemetryStore() : undefined,
    )
    service = nextService
    startRetentionCleanup(nextService)
    void nextService.readyForRuntime().then(() => startNotificationWorker()).catch(error => console.error('runtime initialization failed; will retry', error))
  }
  return service
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof Error && 'code' in error && error.code === 'invalid_device_time') return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 400 })
  if (error instanceof Error && 'code' in error && error.code === 'ingest_conflict') return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 409 })
  if (error instanceof Error && 'code' in error && error.code === 'telemetry_conflict') return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 409 })
  if (error instanceof Error && 'code' in error && error.code === '22023') return NextResponse.json({error:{code:'history_finalized',message:'Измерение старше сохранённой границы истории; архив уже сформирован'}},{status:422})
  if (error instanceof ValidationError) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: error.message,
          fields: error.issues,
        },
      },
      { status: 400 },
    )
  }
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      },
      { status: error.status },
    )
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json(
      { error: { code: 'not_found', message: error.message } },
      { status: 404 },
    )
  }
  console.error('api request failed', error instanceof Error ? error.name : 'unknown')
  return NextResponse.json(
    {
      error: {
        code: 'internal_error',
        message: 'Внутренняя ошибка сервера',
      },
    },
    { status: 500 },
  )
}
