import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  requireOperator: vi.fn(),
  accessErrorResponse: vi.fn(),
  fetchSimulator: vi.fn(),
}))

vi.mock('../../../server/access', () => ({
  assertSameOrigin: mocks.assertSameOrigin,
  requireOperator: mocks.requireOperator,
  accessErrorResponse: mocks.accessErrorResponse,
}))

vi.mock('../../../server/simulator', () => ({
  fetchSimulator: mocks.fetchSimulator,
}))

import { POST as postAction } from './actions/route'
import { GET as getEvents } from './events/route'

function authorizedRequest(body: unknown): Request {
  return new Request('http://localhost/api/simulator/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  })
}

function allowOperator(): void {
  mocks.assertSameOrigin.mockImplementation(() => undefined)
  mocks.requireOperator.mockImplementation(async () => undefined)
  mocks.accessErrorResponse.mockImplementation(() => null)
  mocks.fetchSimulator.mockReset()
}

describe('internal simulator Next routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    allowOperator()
  })

  it('requires same-origin operator access and forwards the supported action body', async () => {
    const payload = { action: 'debug_set', payload: { key: 'occupancy', value: 6 } }
    mocks.fetchSimulator.mockResolvedValue(Response.json({ data: { key: 'occupancy', value: 6 } }))

    const response = await postAction(authorizedRequest(payload))

    expect(mocks.assertSameOrigin).toHaveBeenCalledTimes(1)
    expect(mocks.requireOperator).toHaveBeenCalledTimes(1)
    expect(mocks.fetchSimulator).toHaveBeenCalledWith('/v1/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ data: { key: 'occupancy', value: 6 } })
  })

  it.each([
    ['unknown action', { action: 'unlisted' }],
    ['missing action', { payload: { speed: 1 } }],
    ['non-object request', []],
    ['array payload', { action: 'speed', payload: [2] }],
  ])('rejects %s before calling the headless service', async (_caseName, body) => {
    const response = await postAction(authorizedRequest(body))

    expect(response.status).toBe(400)
    expect(mocks.fetchSimulator).not.toHaveBeenCalled()
  })

  it('does not dispatch a mutation when the origin or operator check rejects it', async () => {
    mocks.assertSameOrigin.mockImplementation(() => { throw new Error('origin denied') })
    mocks.accessErrorResponse.mockImplementation((error: unknown) => {
      if ((error as Error).message === 'origin denied') {
        return Response.json({ error: { code: 'forbidden' } }, { status: 403 })
      }
      return null
    })

    const originResponse = await postAction(authorizedRequest({ action: 'pause' }))
    expect(originResponse.status).toBe(403)
    expect(mocks.requireOperator).not.toHaveBeenCalled()
    expect(mocks.fetchSimulator).not.toHaveBeenCalled()

    allowOperator()
    mocks.requireOperator.mockImplementation(async () => { throw new Error('operator denied') })
    mocks.accessErrorResponse.mockImplementation((error: unknown) => {
      if ((error as Error).message === 'operator denied') {
        return Response.json({ error: { code: 'forbidden' } }, { status: 403 })
      }
      return null
    })

    const accessResponse = await postAction(authorizedRequest({ action: 'pause' }))
    expect(accessResponse.status).toBe(403)
    expect(mocks.fetchSimulator).not.toHaveBeenCalled()
  })

  it('maps headless validation failures to a client error', async () => {
    mocks.fetchSimulator.mockResolvedValue(Response.json({ detail: 'speed is outside the supported range' }, { status: 422 }))

    const response = await postAction(authorizedRequest({ action: 'speed', payload: { speed: 999 } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'simulator_action_failed', message: 'speed is outside the supported range' },
    })
  })

  it('streams simulator SSE bytes and passes browser cancellation through', async () => {
    const event = 'id: 4\nevent: snapshot\ndata: {"schema_version":1}\n\n'
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(event))
        controller.close()
      },
    })
    mocks.fetchSimulator.mockResolvedValue(new Response(stream, { status: 200 }))
    const controller = new AbortController()
    const request = new Request('http://localhost/api/simulator/events', { signal: controller.signal })

    const response = await getEvents(request)

    expect(mocks.fetchSimulator).toHaveBeenCalledWith('/v1/events', { signal: request.signal })
    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform')
    expect(response.headers.get('X-Accel-Buffering')).toBe('no')
    expect(await response.text()).toBe(event)
  })

  it('returns service unavailable when the upstream SSE stream is missing or fails', async () => {
    mocks.fetchSimulator.mockResolvedValue(new Response(null, { status: 502 }))

    const response = await getEvents(new Request('http://localhost/api/simulator/events'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'simulator_error' },
    })
  })
})
