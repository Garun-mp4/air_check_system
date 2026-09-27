import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
}))

vi.mock('../../../../server/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../server/api')>()
  return {
    ...actual,
    getAirQualityService: () => ({ ingest: mocks.ingest }),
  }
})

vi.mock('../../../../server/access', () => ({
  accessErrorResponse: vi.fn(() => null),
  requireDeviceToken: vi.fn(),
}))

import { POST } from './route'

function validPayload() {
  return {
    timestamp: '2026-09-06T13:00:00+03:00',
    indoor: { co2: 720, temperature: 23.4, humidity: 45, pm25: 5.2 },
    outdoor: { temperature: 18, humidity: 60, pm25: 8 },
    window_open: false,
  }
}

function jsonRequest(body: string): Request {
  return new Request('http://aircheck.local/api/v1/measurements', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

describe('POST /api/v1/measurements', () => {
  beforeEach(() => mocks.ingest.mockReset())
  afterEach(() => vi.restoreAllMocks())

  it('returns 201 with the stable serialized ingest contract', async () => {
    mocks.ingest.mockResolvedValue({
      measurement: {
        id: 41,
        createdAt: new Date('2026-09-06T10:00:01Z'),
        timestamp: new Date('2026-09-06T10:00:00Z'),
        indoor: { co2: 720, temperature: 23.4, humidity: 45, pm25: 5.2 },
        outdoor: { temperature: 18, humidity: 60, pm25: 8 },
        windowOpen: false,
      },
      prediction: null,
      recommendation: null,
      predictionStatus: 'insufficient_history',
      predictionError: null,
    })

    const response = await POST(jsonRequest(JSON.stringify(validPayload())))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toEqual({
      data: {
        id: 41,
        measurement: {
          id: 41,
          created_at: '2026-09-06T10:00:01.000Z',
          timestamp: '2026-09-06T10:00:00.000Z',
          indoor: { co2: 720, temperature: 23.4, humidity: 45, pm25: 5.2 },
          outdoor: { temperature: 18, humidity: 60, pm25: 8 },
          window_open: false,
        },
        prediction: null,
        recommendation: null,
        prediction_status: 'insufficient_history',
        prediction_error: null,
      },
    })
    expect(mocks.ingest).toHaveBeenCalledWith(expect.objectContaining({
      timestamp: new Date('2026-09-06T10:00:00Z'),
      windowOpen: false,
      indoor: { co2: 720, temperature: 23.4, humidity: 45, pm25: 5.2 },
    }))
  })

  it('returns a structured 400 for malformed JSON without calling ingest', async () => {
    const response = await POST(jsonRequest('{bad json'))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_json',
        message: 'Тело запроса должно быть корректным JSON',
      },
    })
    expect(mocks.ingest).not.toHaveBeenCalled()
  })

  it('rejects invalid sensor payloads before any service write can occur', async () => {
    const invalid = { ...validPayload(), indoor: { ...validPayload().indoor, co2: 10_001 } }
    const response = await POST(jsonRequest(JSON.stringify(invalid)))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'validation_error',
        fields: expect.arrayContaining([
          expect.objectContaining({ field: 'indoor.co2' }),
        ]),
      },
    })
    expect(mocks.ingest).not.toHaveBeenCalled()
  })

  it('hides unexpected service details behind the stable internal error response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.ingest.mockImplementation(async () => {
      throw new Error('database credentials should not leak')
    })

    const response = await POST(jsonRequest(JSON.stringify(validPayload())))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: 'internal_error', message: 'Внутренняя ошибка сервера' },
    })
  })
})
