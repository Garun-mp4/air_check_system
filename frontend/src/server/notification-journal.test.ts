import { it, expect, vi } from 'vitest'
const pool = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('./auth', () => ({ getAuthPool: () => pool }))
import { listEvents, markEventRead } from './notifications'
it('serializes bigint event IDs as numbers and scopes read marks to the caller', async () => {
  pool.query.mockResolvedValueOnce({
    rows: [{ id: '42', kind: 'recovery', read: false }],
  })
  expect(await listEvents('current-user')).toEqual([
    { id: 42, kind: 'recovery', read: false },
  ])
  expect(pool.query.mock.calls[0][1]).toEqual(['current-user'])
  pool.query.mockResolvedValueOnce({ rowCount: 1 })
  await markEventRead(42, 'current-user')
  expect(pool.query.mock.calls[1][1]).toEqual([42, 'current-user'])
  await expect(
    markEventRead('42' as unknown as number, 'current-user'),
  ).rejects.toThrow()
})
