// @vitest-environment jsdom
import React from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CommandHistory from './CommandHistory'
import { commandAction, type ClientControlStatus } from '../lib/client-api'
vi.mock('../lib/client-api', () => ({ commandAction: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const controls = {
  device_id: 'room-01',
  recent_commands: [
    {
      id: 1,
      batch_id: 'batch',
      target: 'exhaust',
      desired_state: true,
      source: 'manual',
      created_at: '2026-10-08T00:00:00Z',
      status: 'applied',
    },
    {
      id: 2,
      batch_id: 'batch',
      target: 'intake',
      desired_state: true,
      source: 'manual',
      created_at: '2026-10-08T00:00:00Z',
      status: 'failed',
      failure_reason: 'Мотор заблокирован',
    },
  ],
} as ClientControlStatus
describe('command history', () => {
  it('shows partial execution and explicitly retries unresolved commands', async () => {
    const update = vi.fn()
    vi.mocked(commandAction).mockResolvedValue({ data: { controls } })
    render(
      React.createElement(CommandHistory, {
        controls,
        canOperate: true,
        onUpdated: update,
      }),
    )
    expect(screen.getByText(/Частичное выполнение/)).toBeTruthy()
    expect(screen.getByText('Мотор заблокирован')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Повторить неисполненные' }),
    )
    await waitFor(() => expect(update).toHaveBeenCalledWith(controls))
    expect(commandAction).toHaveBeenCalledWith(1, 'retry', 'room-01')
  })
  it('reports errors without pretending the command changed', async () => {
    const update = vi.fn()
    vi.mocked(commandAction).mockRejectedValue(new Error('Нет связи'))
    render(
      React.createElement(CommandHistory, {
        controls,
        canOperate: true,
        onUpdated: update,
      }),
    )
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Нет связи'),
    )
    expect(update).not.toHaveBeenCalled()
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
  it('keeps actions unavailable to a viewer', () => {
    render(
      React.createElement(CommandHistory, {
        controls,
        canOperate: false,
        onUpdated: vi.fn(),
      }),
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})
