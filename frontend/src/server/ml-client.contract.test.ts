import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  InvalidMlResponseError,
  MlClient,
  MlServiceError,
} from './ml-client'
import type { MlPredictionPayload } from './features'

const payload: MlPredictionPayload = {
  co2: 720,
  temperature: 23.4,
  humidity: 45,
  indoor_pm25: 5.2,
  outdoor_temperature: 18,
  outdoor_humidity: 60,
  outdoor_pm25: 8,
  window_open: false,
  co2_change_5min: 10,
  co2_change_10min: 20,
  hour: 10,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ML HTTP client contract', () => {
  it('maps an HTTP error response to a status-bearing service error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: 'model_unavailable', message: 'model is not ready' },
          }),
          { status: 503 },
        ),
      ),
    )

    await expect(new MlClient('http://ml.test', 1000).predict(payload)).rejects.toMatchObject({
      name: 'MlServiceError',
      status: 503,
      message: 'model is not ready',
    })
  })

  it('maps a request timeout to a service error after the abort signal fires', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            },
            { once: true },
          )
        }),
      ),
    )

    const result = new MlClient('http://ml.test', 25).predict(payload)
    const resultAssertion = expect(result).rejects.toMatchObject({
      name: 'MlServiceError',
      status: null,
      message: 'ML-сервис не ответил за отведённое время',
    })
    await vi.advanceTimersByTimeAsync(25)

    await resultAssertion
  })

  it('rejects malformed JSON instead of manufacturing a prediction', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"predicted_co2_15min":', { status: 200 })))

    await expect(new MlClient('http://ml.test', 1000).predict(payload)).rejects.toBeInstanceOf(
      InvalidMlResponseError,
    )
  })

  it.each([
    [
      'negative forecast',
      '{"predicted_co2_15min":-1,"model":"linear_regression","model_version":"1.0"}',
    ],
    [
      'non-finite forecast',
      '{"predicted_co2_15min":1e999,"model":"linear_regression","model_version":"1.0"}',
    ],
    ['missing model version', '{"predicted_co2_15min":700,"model":"linear_regression"}'],
  ])('rejects a successful response with an invalid %s', async (_caseName, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))

    await expect(new MlClient('http://ml.test', 1000).predict(payload)).rejects.toBeInstanceOf(
      InvalidMlResponseError,
    )
  })
})
