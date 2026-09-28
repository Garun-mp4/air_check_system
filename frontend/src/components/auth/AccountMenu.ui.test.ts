// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccountMenu from './AccountMenu'

const mocks = vi.hoisted(() => ({
  useAccessSession: vi.fn(),
  usePathname: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  routerRefresh: vi.fn(),
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  Object.assign(globalThis, { React: actual })
  return actual
})

vi.mock('./AccessSessionProvider', () => ({
  useAccessSession: mocks.useAccessSession,
}))

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
  useRouter: () => ({
    refresh: mocks.routerRefresh,
    replace: vi.fn(),
    push: vi.fn(),
  }),
}))

afterEach(() => cleanup())

beforeEach(() => {
  mocks.refresh.mockReset().mockResolvedValue(true)
  mocks.signOut.mockReset().mockResolvedValue(undefined)
  mocks.routerRefresh.mockReset()
  mocks.usePathname.mockReturnValue('/dashboard')
})

describe('account menu', () => {
  it.each([
    { role: 'owner', canManageAccounts: true },
    { role: 'operator', canManageAccounts: false },
    { role: 'user', canManageAccounts: false },
  ] as const)('shows role-appropriate navigation for $role', async ({ role, canManageAccounts }) => {
    const user = userEvent.setup()
    mocks.useAccessSession.mockReturnValue({
      access: {
        userId: 'account-1',
        email: `${role}@example.test`,
        name: role,
        image: null,
        role,
        operatorExpiresAt: null,
      },
      status: 'ready',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    render(createElement(AccountMenu))

    const trigger = screen.getByLabelText(/Открыть меню аккаунта/)
    await user.click(trigger)

    expect(screen.getByRole('link', { name: 'Личный кабинет' })).not.toBeNull()
    if (canManageAccounts) {
      expect(screen.getByRole('link', { name: 'Управление аккаунтами' }).getAttribute('href')).toBe('/admin')
    } else {
      expect(screen.queryByRole('link', { name: 'Управление аккаунтами' })).toBeNull()
    }

    await user.click(screen.getByRole('button', { name: 'Выйти' }))
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1))
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1)
  })

  it('announces an unavailable session and invokes the retry action', async () => {
    const user = userEvent.setup()
    mocks.useAccessSession.mockReturnValue({
      access: null,
      status: 'unavailable',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    render(createElement(AccountMenu))

    expect(screen.getByRole('status')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('renders the saved profile image in the shared account menu', () => {
    mocks.useAccessSession.mockReturnValue({
      access: {
        userId: 'account-1',
        email: 'owner@example.test',
        name: 'Owner',
        image: '/api/profile/avatar/8f477503-d23c-47e3-85c3-11f9e9543bc7',
        role: 'owner',
        operatorExpiresAt: null,
      },
      status: 'ready',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    render(createElement(AccountMenu))

    expect(document.querySelector('img[src="/api/profile/avatar/8f477503-d23c-47e3-85c3-11f9e9543bc7"]')).not.toBeNull()
  })
})
