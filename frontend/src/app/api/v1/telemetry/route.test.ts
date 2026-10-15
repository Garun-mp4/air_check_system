// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ ingest: vi.fn(), latest: vi.fn() }))
vi.mock('../../../../server/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../server/api')>()
  return { ...actual, getTelemetryService: () => ({ ingest: mocks.ingest, latest: mocks.latest }) }
})
import { POST, GET } from './route'
import { frameFixture } from '../../../../server/test-fixtures/telemetry'
import { TelemetryConflictError } from '../../../../server/telemetry-store'

const token = 'test-only-device-token-32-characters'
const now = Date.parse('2026-10-15T12:00:01Z')
function request(body: string, authorization = 'Bearer ' + token) {
  return new Request('http://aircheck.test/api/v1/telemetry', { method: 'POST', headers: { authorization }, body })
}
beforeEach(() => {
  mocks.ingest.mockReset(); mocks.latest.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
  vi.stubEnv('DEVICE_API_TOKEN', token); vi.stubEnv('AIRCHECK_MODE', 'real')
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('HTTP device telemetry', () => {
  it('rejects unauthenticated packets before parsing or storing them', async () => {
    expect((await POST(request('invalid', 'Bearer invalid'))).status).toBe(401)
    expect(mocks.ingest).not.toHaveBeenCalled()
  })
  it('returns stable receipt metadata for new and repeated packets', async () => {
    mocks.ingest.mockResolvedValue({ record: { id: 7, received_at: new Date(now).toISOString() }, duplicate: false, current: true, measurementId: 9 })
    const first = await POST(request(JSON.stringify(frameFixture())))
    expect(first.status).toBe(201)
    expect((await first.json()).data).toEqual({ id: 7, received_at: new Date(now).toISOString(), duplicate: false, current: true, measurement_id: 9 })
    mocks.ingest.mockResolvedValue({ record: { id: 7, received_at: new Date(now).toISOString() }, duplicate: true, current: true, measurementId: 9 })
    expect((await POST(request(JSON.stringify(frameFixture())))).status).toBe(200)
  })
  it('rejects malformed JSON, oversized bodies, and future clock values', async () => {
    expect((await POST(request('invalid'))).status).toBe(400)
    expect((await POST(request(' '.repeat(32769)))).status).toBe(413)
    const frame = frameFixture(); frame.sampled_at = new Date(now + 6000).toISOString()
    expect((await POST(request(JSON.stringify(frame)))).status).toBe(400)
    expect(mocks.ingest).not.toHaveBeenCalled()
  })
  it('rejects simulator packets in real mode and conflicting reuse of packet identity', async () => {
    const frame = frameFixture(); frame.data_source = 'simulator'
    expect((await POST(request(JSON.stringify(frame)))).status).toBe(409)
    mocks.ingest.mockRejectedValue(new TelemetryConflictError())
    expect((await POST(request(JSON.stringify(frameFixture())))).status).toBe(409)
  })
  it('exposes only the active source and prevents caching the current snapshot', async () => {
    mocks.latest.mockResolvedValue(null)
    const response = await GET()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.latest).toHaveBeenCalledWith('real')
    expect((await response.json()).data).toBeNull()
  })
})
