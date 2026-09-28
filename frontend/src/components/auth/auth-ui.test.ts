// @vitest-environment jsdom

import { createElement, useState } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AuthPanel from '../AuthPanel'
import AccountPage from './AccountPage'
import PasswordInput from './PasswordInput'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  Object.assign(globalThis, { React: actual })
  return actual
})

const mocks = vi.hoisted(() => ({
  useAccessSession: vi.fn(),
  usePathname: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  routerRefresh: vi.fn(),
  routerReplace: vi.fn(),
}))

vi.mock('./AccessSessionProvider', () => ({
  useAccessSession: mocks.useAccessSession,
}))

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
  useRouter: () => ({
    refresh: mocks.routerRefresh,
    replace: mocks.routerReplace,
    push: vi.fn(),
  }),
}))

vi.mock('next/image', () => ({
  default: ({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) =>
    createElement('img', { src, alt, width, height }),
}))

function PasswordHarness() {
  const [password, setPassword] = useState('sensitive value')

  return createElement(PasswordInput, {
    id: 'password-harness',
    'aria-label': 'Пароль',
    value: password,
    onChange: (event) => setPassword(event.currentTarget.value),
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  window.history.replaceState(null, '', '/account')
  mocks.refresh.mockReset().mockResolvedValue(true)
  mocks.signOut.mockReset().mockResolvedValue(undefined)
  mocks.routerRefresh.mockReset()
  mocks.routerReplace.mockReset()
  mocks.usePathname.mockReturnValue('/login')
  mocks.useAccessSession.mockReturnValue({
    access: null,
    status: 'ready',
    refresh: mocks.refresh,
    signOut: mocks.signOut,
  })
})

describe('password input', () => {
  it('reveals and hides a password by pointer and keyboard while keeping its value', async () => {
    const user = userEvent.setup()
    render(createElement(PasswordHarness))

    const input = screen.getByLabelText('Пароль') as HTMLInputElement
    const toggle = screen.getByRole('button', { name: 'Показать пароль' })

    expect(input.type).toBe('password')
    expect(toggle.getAttribute('aria-controls')).toBe(input.id)

    await user.tab()
    expect(document.activeElement).toBe(input)
    await user.tab()
    expect(document.activeElement).toBe(toggle)
    await user.keyboard(' ')

    expect(input.type).toBe('text')
    expect(screen.getByRole('button', { name: 'Скрыть пароль' })).toBe(toggle)
    expect(input.value).toBe('sensitive value')

    await user.keyboard('{Enter}')
    expect(input.type).toBe('password')
  })

  it('hides the revealed value when that value is cleared', async () => {
    const user = userEvent.setup()
    render(createElement(PasswordHarness))

    const input = screen.getByLabelText('Пароль') as HTMLInputElement
    await user.click(screen.getByRole('button', { name: 'Показать пароль' }))
    await user.clear(input)

    await waitFor(() => expect(input.type).toBe('password'))
    expect(screen.getByRole('button', { name: 'Показать пароль' })).not.toBeNull()
  })
})

describe('sign-in and account page UI', () => {
  it('allows legacy passwords at sign-in and applies the configured minimum to new accounts', async () => {
    const user = userEvent.setup()
    render(createElement(AuthPanel))

    expect(screen.getByRole('heading', { level: 1, name: 'Вход в панель' })).not.toBeNull()
    const email = screen.getByRole('textbox', { name: 'Электронная почта' }) as HTMLInputElement
    const password = screen.getByLabelText('Пароль') as HTMLInputElement
    expect(email.type).toBe('email')
    expect(email.required).toBe(true)
    expect(password.type).toBe('password')
    expect(password.minLength).toBe(-1)

    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Создать аккаунт' })).not.toBeNull()
    expect(screen.getByRole('textbox', { name: 'Имя' })).not.toBeNull()
    const signupPassword = screen.getByLabelText('Пароль') as HTMLInputElement
    const descriptionId = signupPassword.getAttribute('aria-describedby')
    expect(descriptionId).not.toBeNull()
    expect(signupPassword.minLength).toBe(15)
    expect(document.getElementById(descriptionId ?? '')?.textContent).toContain('15')
  })

  it('announces account loading and provides a retry action after an access error', async () => {
    const user = userEvent.setup()
    mocks.useAccessSession.mockReturnValue({
      access: null,
      status: 'loading',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    const { rerender } = render(createElement(AccountPage))

    const main = screen.getByRole('main')
    expect(within(main).getByRole('status')).not.toBeNull()

    mocks.useAccessSession.mockReturnValue({
      access: null,
      status: 'unavailable',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    rerender(createElement(AccountPage))

    const alert = within(main).getByRole('alert')
    await user.click(within(alert).getByRole('button', { name: 'Повторить' }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('shows one supported account section at a time and preserves profile edits while switching', async () => {
    const user = userEvent.setup()
    mocks.useAccessSession.mockReturnValue({
      access: {
        userId: 'user-1',
        email: 'reader@example.test',
        name: 'Reader',
        image: null,
        role: 'user',
        operatorExpiresAt: null,
      },
      status: 'ready',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    render(createElement(AccountPage))

    const profileSection = screen.getByRole('tabpanel', { name: 'Профиль' })
    expect(within(profileSection).getByText('reader@example.test')).not.toBeNull()
    expect(within(profileSection).queryByRole('textbox', { name: /Электронная почта/ })).toBeNull()
    expect(screen.queryByRole('tabpanel', { name: 'Доступ' })).toBeNull()
    expect(screen.queryByRole('tabpanel', { name: 'Безопасность' })).toBeNull()
    expect(screen.getByRole('tablist', { name: 'Разделы настроек аккаунта' }).querySelectorAll('[role="tab"]')).toHaveLength(3)

    const name = within(profileSection).getByRole('textbox', { name: 'Имя' }) as HTMLInputElement
    await user.clear(name)
    await user.type(name, 'Reader Draft')
    await user.click(screen.getByRole('tab', { name: 'Доступ' }))

    expect(screen.getByRole('tabpanel', { name: 'Доступ' })).not.toBeNull()
    expect(profileSection.hidden).toBe(true)
    expect(new URL(window.location.href).searchParams.get('section')).toBe('access')
    expect(document.querySelector<HTMLInputElement>('input[autocomplete="name"]')?.value).toBe('Reader Draft')

    await user.click(screen.getByRole('tab', { name: 'Безопасность' }))
    expect(screen.getByRole('tabpanel', { name: 'Безопасность' })).not.toBeNull()
    expect(screen.getByText(/Сброс пароля по электронной почте пока недоступен/)).not.toBeNull()

    const newPassword = screen.getByLabelText('Новый пароль') as HTMLInputElement
    expect(newPassword.minLength).toBe(15)
    expect(newPassword.maxLength).toBe(128)
  })

  it('opens a section from the URL and follows browser back and forward navigation', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/account?section=security')
    mocks.useAccessSession.mockReturnValue({
      access: {
        userId: 'user-1',
        email: 'reader@example.test',
        name: 'Reader',
        image: null,
        role: 'user',
        operatorExpiresAt: null,
      },
      status: 'ready',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    render(createElement(AccountPage))

    expect(await screen.findByRole('tabpanel', { name: 'Безопасность' })).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'Безопасность' }).getAttribute('aria-selected')).toBe('true')

    await user.click(screen.getByRole('tab', { name: 'Профиль' }))
    await user.click(screen.getByRole('tab', { name: 'Доступ' }))
    window.history.back()

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Профиль' }).getAttribute('aria-selected')).toBe('true'))
    window.history.forward()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Доступ' }).getAttribute('aria-selected')).toBe('true'))
  })

  it('translates an existing account hash link without scrolling to an anchor', async () => {
    window.history.replaceState(null, '', '/account#account-access')
    mocks.useAccessSession.mockReturnValue({
      access: {
        userId: 'user-1',
        email: 'reader@example.test',
        name: 'Reader',
        image: null,
        role: 'user',
        operatorExpiresAt: null,
      },
      status: 'ready',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    render(createElement(AccountPage))

    expect(await screen.findByRole('tabpanel', { name: 'Доступ' })).not.toBeNull()
    expect(window.location.hash).toBe('')
    expect(new URL(window.location.href).searchParams.get('section')).toBe('access')
  })

  it('supports arrow-key tab switching with automatic activation', async () => {
    const user = userEvent.setup()
    mocks.useAccessSession.mockReturnValue({
      access: {
        userId: 'user-1',
        email: 'reader@example.test',
        name: 'Reader',
        image: null,
        role: 'user',
        operatorExpiresAt: null,
      },
      status: 'ready',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    render(createElement(AccountPage))

    const profileTab = screen.getByRole('tab', { name: 'Профиль' })
    profileTab.focus()
    await user.keyboard('{ArrowDown}')

    const accessTab = screen.getByRole('tab', { name: 'Доступ' })
    expect(document.activeElement).toBe(accessTab)
    expect(accessTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel', { name: 'Доступ' })).not.toBeNull()
  })

  it('saves a changed display name and reports success inside the profile section', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)
    mocks.useAccessSession.mockReturnValue({
      access: {
        userId: 'user-1',
        email: 'reader@example.test',
        name: 'Reader',
        image: null,
        role: 'user',
        operatorExpiresAt: null,
      },
      status: 'ready',
      refresh: mocks.refresh,
      signOut: mocks.signOut,
    })
    render(createElement(AccountPage))

    const name = screen.getByRole('textbox', { name: 'Имя' })
    await user.clear(name)
    await user.type(name, 'Reader AirCheck')
    await user.click(screen.getByRole('button', { name: 'Сохранить имя' }))

    expect((await screen.findByRole('status')).textContent).toContain('Имя профиля сохранено.')
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/update-user', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Reader AirCheck' }),
    }))
  })
})
