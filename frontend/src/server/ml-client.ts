import type { MlPredictionPayload } from './features'

export interface MlPredictionResult {
  predictedCo2_15min: number
  model: string
  modelVersion: string
}

export interface Predictor {
  predict(payload: MlPredictionPayload): Promise<MlPredictionResult>
}

export class MlServiceError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'MlServiceError'
    this.status = status
  }
}

export class InvalidMlResponseError extends Error {
  constructor(message = 'ML-сервис вернул некорректный ответ') {
    super(message)
    this.name = 'InvalidMlResponseError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(text: string): unknown {
  if (text.trim() === '') {
    return null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new InvalidMlResponseError('ML-сервис вернул невалидный JSON')
  }
}

function apiErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return fallback
  }
  return typeof payload.error.message === 'string' ? payload.error.message : fallback
}

export class MlClient implements Predictor {
  constructor(
    private readonly serviceUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async predict(payload: MlPredictionPayload): Promise<MlPredictionResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    let response: Response
    try {
      response = await fetch(this.serviceUrl + '/predict', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MlServiceError('ML-сервис не ответил за отведённое время')
      }
      throw new MlServiceError('ML-сервис недоступен')
    } finally {
      clearTimeout(timeout)
    }

    const parsed = parseJson(await response.text())
    if (!response.ok) {
      throw new MlServiceError(
        apiErrorMessage(parsed, 'ML-сервис не смог построить прогноз'),
        response.status,
      )
    }
    if (!isRecord(parsed)) {
      throw new InvalidMlResponseError()
    }

    const predicted = parsed.predicted_co2_15min
    const model = parsed.model
    const modelVersion = parsed.model_version
    if (
      typeof predicted !== 'number' ||
      !Number.isFinite(predicted) ||
      predicted < 0 ||
      typeof model !== 'string' ||
      model.trim() === '' ||
      typeof modelVersion !== 'string' ||
      modelVersion.trim() === ''
    ) {
      throw new InvalidMlResponseError(
        'ML-сервис вернул прогноз без обязательных полей',
      )
    }
    return {
      predictedCo2_15min: predicted,
      model,
      modelVersion,
    }
  }
}
