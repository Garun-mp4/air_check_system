'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import { isAccessInfo, type AccessInfo } from '../../lib/access-types'

export type AccessSessionStatus = 'loading' | 'ready' | 'unavailable'

interface AccessSessionValue {
  access: AccessInfo | null
  status: AccessSessionStatus
  refresh: () => Promise<boolean>
  signOut: () => Promise<void>
}

const AccessSessionContext = createContext<AccessSessionValue | null>(null)

async function readErrorMessage(response: Response): Promise<string> {
  const result: unknown = await response.json().catch(() => null)
  if (typeof result === 'object' && result !== null && 'error' in result) {
    const error = result.error
    if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
      return error.message
    }
  }
  return 'Не удалось завершить запрос авторизации'
}

export function AccessSessionProvider({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<AccessInfo | null>(null)
  const [status, setStatus] = useState<AccessSessionStatus>('loading')
  const mounted = useRef(false)
  const pendingRefresh = useRef<Promise<boolean> | null>(null)

  const refresh = useCallback((): Promise<boolean> => {
    if (pendingRefresh.current) return pendingRefresh.current

    const request = (async () => {
      try {
        const response = await fetch('/api/auth/access', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
        const result: unknown = await response.json().catch(() => null)
        const data = typeof result === 'object' && result !== null && 'data' in result
          ? result.data
          : null

        if (!response.ok || !isAccessInfo(data)) {
          throw new Error('Проверка учётной записи временно недоступна')
        }
        if (mounted.current) {
          setAccess(data)
          setStatus('ready')
        }
        return true
      } catch {
        if (mounted.current) setStatus('unavailable')
        return false
      } finally {
        pendingRefresh.current = null
      }
    })()

    pendingRefresh.current = request
    return request
  }, [])

  const signOut = useCallback(async () => {
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!response.ok) throw new Error(await readErrorMessage(response))
    await refresh()
  }, [refresh])

  useEffect(() => {
    mounted.current = true
    void refresh()

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    const interval = window.setInterval(() => void refresh(), 60_000)

    return () => {
      mounted.current = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [refresh])

  return (
    <AccessSessionContext.Provider value={{ access, status, refresh, signOut }}>
      {children}
    </AccessSessionContext.Provider>
  )
}

export function useAccessSession(): AccessSessionValue {
  const value = useContext(AccessSessionContext)
  if (!value) throw new Error('useAccessSession must be used inside AccessSessionProvider')
  return value
}
