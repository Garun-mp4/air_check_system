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

export function getAirQualityService(): AirQualityService {
  if (!service) {
    const config = getConfig()
    service = new AirQualityService(
      getRepository(config.databaseUrl),
      new MlClient(config.mlServiceUrl, config.mlRequestTimeoutMs),
      config,
    )
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
