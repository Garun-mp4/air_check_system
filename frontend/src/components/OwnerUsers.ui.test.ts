// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OwnerUsers from './OwnerUsers'

const fetchMock = vi.fn()

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  Object.assign(globalThis, { React: actual })
  return actual
})

function response(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('owner account list states', () => {
  it('shows a loading state while the user list request is pending', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined))
    render(createElement(OwnerUsers))

    expect(screen.getByText('Загружаем список…')).not.toBeNull()
  })

  it('shows the empty state only after the server returns an empty list', async () => {
    fetchMock.mockResolvedValue(response(true, { data: [] }))
    render(createElement(OwnerUsers))

    expect(await screen.findByText('Список пуст.')).not.toBeNull()
  })

  it('does not present a failed list request as an empty account list', async () => {
    fetchMock.mockResolvedValue(response(false, { error: { message: 'Account list unavailable.' } }))
    render(createElement(OwnerUsers))

    expect(await screen.findByText('Account list unavailable.')).not.toBeNull()
    expect(screen.queryByText('Список пуст.')).toBeNull()
  })
})
