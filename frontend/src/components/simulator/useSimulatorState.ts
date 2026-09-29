'use client'

import { useEffect, useState } from 'react'

import type { SimulatorSnapshot } from './types'

export function useSimulatorState() {
  const [snapshot, setSnapshot] = useState<SimulatorSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
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
          retryTimer = setTimeout(() => {
            void loadSnapshot()
          }, 3000)
        }
      }
    }
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
      if (retryTimer) clearTimeout(retryTimer)
      stream.close()
    }
  }, [])

  return { snapshot, connected, error }
}
