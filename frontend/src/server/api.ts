import { NextResponse } from 'next/server'

import { getConfig } from './config'
import { MlClient } from './ml-client'
import { NotFoundError, getRepository } from './repository'
import { AirQualityService } from './service'
import { ValidationError } from './validation'

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
let retentionTimer: ReturnType<typeof setInterval> | null = null

const RETENTION_CLEANUP_INTERVAL_MS = 15 * 60 * 1000

function startRetentionCleanup(nextService: AirQualityService): void {
  if (retentionTimer !== null) {
    return
  }

  const runCleanup = async () => {
    try {
      const result = await nextService.cleanupExpiredData()
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
    )
    service = nextService
    startRetentionCleanup(nextService)
  }
  return service
}

export function errorResponse(error: unknown): NextResponse {
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
  console.error('api request failed', error)
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
