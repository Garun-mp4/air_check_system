'use client'

import { useEffect, useState } from 'react'

import type { AccessInfo, SimulatorSnapshot } from './types'

export function useSimulatorState() {
  const [snapshot, setSnapshot] = useState<SimulatorSnapshot | null>(null)
  const [access, setAccess] = useState<AccessInfo>({
    userId: null,
    email: null,
    name: null,
    role: 'guest',
    operatorExpiresAt: null,
  })
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const loadAccess = async () => {
      try {
        const response = await fetch('/api/auth/access', { cache: 'no-store' })
        const result = await response.json() as { data?: AccessInfo }
        if (active && response.ok && result.data) setAccess(result.data)
      } catch {
        if (active) setAccess((current) => ({ ...current, role: 'guest' }))
      }
    }
    const loadSnapshot = async () => {
      try {
        const response = await fetch('/api/simulator/state', { cache: 'no-store' })
        const result = await response.json() as { data?: SimulatorSnapshot }
        if (!response.ok || !result.data) throw new Error('Веб-симулятор пока не запущен')
        if (active) {
          setSnapshot(result.data)
          setConnected(true)
          setError(null)
        }
      } catch (loadError) {
        if (active) {
          setConnected(false)
          setError(loadError instanceof Error ? loadError.message : 'Нет связи с симулятором')
        }
      }
    }
    void loadAccess()
    void loadSnapshot()
    const stream = new EventSource('/api/simulator/events')
    stream.addEventListener('snapshot', (event) => {
      try {
        const next = JSON.parse((event as MessageEvent<string>).data) as SimulatorSnapshot
        if (!active) return
        setSnapshot(next)
        setConnected(true)
        setError(null)
      } catch {
        if (active) setError('Получен некорректный снимок симуляции')
      }
    })
    stream.onerror = () => {
      if (active) setConnected(false)
    }
    return () => {
      active = false
      stream.close()
    }
  }, [])

  return { snapshot, access, connected, error }
}
