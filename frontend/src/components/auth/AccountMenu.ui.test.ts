// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', '') },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute('open') },
  })
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
    const dialog = await screen.findByRole('dialog', { name: 'Выйти из аккаунта?' })
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Отмена' }))

    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(mocks.routerRefresh).not.toHaveBeenCalled()
  })

  it('signs out and refreshes the route only after confirmation', async () => {
    const user = userEvent.setup()
    mocks.useAccessSession.mockReturnValue({
      access: {
        userId: 'account-1',
        email: 'owner@example.test',
        name: 'Owner',
        image: null,
        role: 'owner',
        operatorExpiresAt: null,
      },
      status: 'ready',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    render(createElement(AccountMenu))

    await user.click(screen.getByLabelText(/Открыть меню аккаунта/))
    await user.click(screen.getByRole('button', { name: 'Выйти' }))
    const dialog = await screen.findByRole('dialog', { name: 'Выйти из аккаунта?' })

    await user.click(within(dialog).getByRole('button', { name: 'Выйти' }))
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1))
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the confirmation open on sign-out failure and allows retry or cancellation', async () => {
    const user = userEvent.setup()
    mocks.signOut.mockRejectedValue(new Error('Сервер не ответил'))
    mocks.useAccessSession.mockReturnValue({
      access: {
        userId: 'account-1',
        email: 'owner@example.test',
        name: 'Owner',
        image: null,
        role: 'owner',
        operatorExpiresAt: null,
      },
      status: 'ready',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    render(createElement(AccountMenu))

    await user.click(screen.getByLabelText(/Открыть меню аккаунта/))
    await user.click(screen.getByRole('button', { name: 'Выйти' }))
    const dialog = await screen.findByRole('dialog', { name: 'Выйти из аккаунта?' })
    await user.click(within(dialog).getByRole('button', { name: 'Выйти' }))

    expect((await within(dialog).findByRole('alert')).textContent).toContain('Сервер не ответил')
    expect(mocks.routerRefresh).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes on Escape but prevents closing while the sign-out request is pending', async () => {
    const user = userEvent.setup()
    let finishSignOut: (() => void) | undefined
    mocks.signOut.mockImplementation(() => new Promise<void>((resolve) => { finishSignOut = resolve }))
    mocks.useAccessSession.mockReturnValue({
      access: {
        userId: 'account-1',
        email: 'owner@example.test',
        name: 'Owner',
        image: null,
        role: 'owner',
        operatorExpiresAt: null,
      },
      status: 'ready',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    render(createElement(AccountMenu))

    await user.click(screen.getByLabelText(/Открыть меню аккаунта/))
    await user.click(screen.getByRole('button', { name: 'Выйти' }))
    let dialog = await screen.findByRole('dialog', { name: 'Выйти из аккаунта?' }) as HTMLDialogElement
    const cancelEvent = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancelEvent)
    expect(cancelEvent.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Выйти' }))
    dialog = await screen.findByRole('dialog', { name: 'Выйти из аккаунта?' })
    await user.click(within(dialog).getByRole('button', { name: 'Выйти' }))
    expect((within(dialog).getByRole('button', { name: 'Выходим…' }) as HTMLButtonElement).disabled).toBe(true)

    const busyCancelEvent = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(busyCancelEvent)
    expect(busyCancelEvent.defaultPrevented).toBe(true)
    expect(dialog.open).toBe(true)

    finishSignOut?.()
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledTimes(1))
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
