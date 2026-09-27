import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchSimulator } from './simulator'

describe('headless simulator service proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('uses the configured internal bearer token and streams events without buffering', async () => {
    const token = 'internal-test-token-with-at-least-32-characters'
    const controller = new AbortController()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('event: snapshot\n\n'))
    vi.stubEnv('SIMULATOR_INTERNAL_URL', ' http://headless:8000/// ')
    vi.stubEnv('SIMULATOR_INTERNAL_TOKEN', ' ' + token + ' ')
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchSimulator('/v1/events', { signal: controller.signal })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://headless:8000/v1/events')
    expect(init?.cache).toBe('no-store')
    expect(init?.signal).toBe(controller.signal)
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer ' + token)
    expect(headers.get('Accept')).toBe('text/event-stream')
  })

  it.each([
    ['', 'valid-internal-token-that-is-long-enough-for-testing'],
    ['http://headless:8000', 'short'],
    ['ftp://headless:8000', 'valid-internal-token-that-is-long-enough-for-testing'],
  ])('does not call the simulator when its URL or token is invalid', async (url, token) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('unexpected'))
    vi.stubEnv('SIMULATOR_INTERNAL_URL', url)
    vi.stubEnv('SIMULATOR_INTERNAL_TOKEN', token)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchSimulator('/v1/state')).rejects.toMatchObject({
      code: 'simulator_unavailable',
      status: 503,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps an unreachable headless service to a service unavailable API error', async () => {
    vi.stubEnv('SIMULATOR_INTERNAL_URL', 'http://headless:8000')
    vi.stubEnv('SIMULATOR_INTERNAL_TOKEN', 'internal-test-token-with-at-least-32-characters')
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      throw new TypeError('connection refused')
    }))

    await expect(fetchSimulator('/v1/state')).rejects.toMatchObject({
      code: 'simulator_offline',
      status: 503,
    })
  })
})
