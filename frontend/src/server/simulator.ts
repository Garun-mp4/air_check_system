import { ApiError } from './api'

function getSimulatorConfig(): { url: string; token: string } {
  const url = process.env.SIMULATOR_INTERNAL_URL?.trim().replace(/\/+$/, '')
  const token = process.env.SIMULATOR_INTERNAL_TOKEN?.trim()
  if (!url || !/^https?:\/\//.test(url) || !token || token.length < 32) {
    throw new ApiError('simulator_unavailable', 'Веб-симулятор не настроен', 503)
  }
  return { url, token }
}

export async function fetchSimulator(path: '/v1/state' | '/v1/events' | '/v1/actions', init?: RequestInit): Promise<Response> {
  const { url, token } = getSimulatorConfig()
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept', path === '/v1/events' ? 'text/event-stream' : 'application/json')
  try {
    return await fetch(url + path, {
      ...init,
      headers,
      cache: 'no-store',
      signal: init?.signal ?? AbortSignal.timeout(5_000),
    })
  } catch {
    throw new ApiError('simulator_offline', 'Headless simulator сейчас недоступен', 503)
  }
}
