'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { getLoginHref } from '../../lib/auth-navigation'
import { getAccessRoleLabel } from '../../lib/access-types'
import { useAccessSession } from './AccessSessionProvider'
import AccountSignOutDialog from './AccountSignOutDialog'
import UserAvatar from './UserAvatar'

function currentReturnPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export default function AccountMenu({ variant = 'dashboard' }: { variant?: 'dashboard' | 'simulator' | 'utility' }) {
  const { access, status, refresh, signOut } = useAccessSession()
  const pathname = usePathname()
  const router = useRouter()
  const [returnTo, setReturnTo] = useState(pathname || '/')
  const [signingOut, setSigningOut] = useState(false)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setReturnTo(currentReturnPath())
  }, [pathname])

  async function handleSignOut() {
    setError(null)
    setSigningOut(true)
    try {
      await signOut()
      setConfirmingSignOut(false)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось завершить сеанс')
    } finally {
      setSigningOut(false)
    }
  }

  if (status === 'loading') {
    return <span className={`account-menu-loading account-menu-${variant}`} role="status">Проверяем доступ…</span>
  }

  if (status === 'unavailable') {
    return (
      <div className={`account-menu-unavailable account-menu-${variant}`}>
        <span role="status">Доступ не проверен</span>
        <button type="button" onClick={() => void refresh()}>Повторить</button>
      </div>
    )
  }

  if (!access?.userId) {
    if (pathname === '/login') {
      return <a className={`account-menu-login account-menu-${variant}`} href="/account">Личный кабинет</a>
    }
    return <a className={`account-menu-login account-menu-${variant}`} href={getLoginHref(returnTo)}>Войти</a>
  }

  const displayName = access.name?.trim() || access.email || 'Пользователь AirCheck'

  return (
    <>
      <details className={`account-menu account-menu-${variant}`}>
        <summary aria-label={`Открыть меню аккаунта: ${displayName}`}>
          <UserAvatar image={access.image} name={displayName} size={30} className="account-menu-avatar" />
          <span className="account-menu-trigger-copy">
            <strong>{displayName}</strong>
            <small>{getAccessRoleLabel(access.role)}</small>
          </span>
          <span className="account-menu-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div className="account-menu-popover">
          <div className="account-menu-identity">
            <strong>{displayName}</strong>
            <span>{access.email}</span>
            <small>{getAccessRoleLabel(access.role)}</small>
          </div>
          <a href="/account">Личный кабинет</a>
          {access.role === 'owner' ? <a href="/admin">Управление аккаунтами</a> : null}
          <button type="button" onClick={() => { setError(null); setConfirmingSignOut(true) }}>
            Выйти
          </button>
        </div>
      </details>
      <AccountSignOutDialog
        open={confirmingSignOut}
        busy={signingOut}
        error={error}
        onCancel={() => {
          if (!signingOut) setConfirmingSignOut(false)
        }}
        onConfirm={() => void handleSignOut()}
      />
    </>
  )
}
