'use client'

import { useEffect, useState } from 'react'
import { getNodeSettings } from '../../lib/client-api'

import type { SimulatorSnapshot } from './types'

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
export function isSystemSnapshot(value: unknown): value is SimulatorSnapshot {
  if (!record(value) || !Number.isSafeInteger(value.revision) || !record(value.simulation) || !record(value.window) || !record(value.ventilation) || !record(value.backend) || !record(value.demo) || !Array.isArray(value.sensors)) return false
  const scene = value.simulation
  if (!record(scene.room_dimensions) || !record(scene.layout) || !record(scene.camera)) return false
  const dimensions = ['width_m', 'depth_m', 'height_m', 'wall_thickness_m', 'window_width_m', 'window_height_m', 'window_sill_height_m', 'window_open_angle_degrees', 'outdoor_depth_m']
  if (dimensions.some(key => typeof scene.room_dimensions !== 'object' || !record(scene.room_dimensions) || typeof scene.room_dimensions[key] !== 'number' || !Number.isFinite(scene.room_dimensions[key]))) return false
  for (const [object, keys] of [[scene.layout, ['indoor_sensor_center', 'outdoor_station_center', 'control_cabinet_center']], [scene.camera, ['start_position', 'start_target']]] as const) {
    for (const key of keys) { const point = object[key]; if (!Array.isArray(point) || point.length !== 3 || point.some(item => typeof item !== 'number' || !Number.isFinite(item))) return false }
  }
  for (const zone of ['indoor', 'outdoor']) {
    const air = value[zone]
    if (!record(air) || ['co2_ppm', 'temperature_c', 'humidity_percent', 'pm25_ug_m3'].some(key => air[key] !== null && (typeof air[key] !== 'number' || !Number.isFinite(air[key])))) return false
  }
  if (!['stopped', 'opening', 'closing', 'fault', 'unknown'].includes(String(value.window.motor_state))) return false
  if (!record(value.airflow) || !record(value.energy) || !Array.isArray(scene.scenarios) || !Array.isArray(scene.supported_speeds) || !record(scene.developer_values) || !record(scene.developer_parameters)) return false
  const finite = (number: unknown) => typeof number === 'number' && Number.isFinite(number)
  const nullable = (number: unknown) => number === null || finite(number)
  if (typeof value.device_id !== 'string' || typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp)) || typeof value.backend.online !== 'boolean' || typeof value.demo.active !== 'boolean') return false
  for (const key of ['actual_position_percent', 'target_position_percent']) if (!nullable(value.window[key]) || typeof value.window[key] === 'number' && (value.window[key] < 0 || value.window[key] > 100)) return false
  for (const key of ['reed_switch', 'open_limit_switch', 'close_limit_switch']) if (value.window[key] !== null && typeof value.window[key] !== 'boolean') return false
  for (const target of ['intake', 'exhaust']) {
    const fan = value.ventilation[target]
    if (!record(fan) || fan.enabled !== null && typeof fan.enabled !== 'boolean' || !['rpm', 'airflow_m3_h', 'nominal_rpm', 'nominal_airflow_m3_h', 'rated_power_w'].every(key => nullable(fan[key]))) return false
  }
  if (!record(scene.mount_dimensions) || Object.values(scene.mount_dimensions).some(number => !finite(number))) return false
  if (Object.values(scene.camera).some(number => !Array.isArray(number) && !finite(number))) return false
  if (scene.scenarios.some(item => !record(item) || typeof item.id !== 'string' || typeof item.title !== 'string') || scene.supported_speeds.some(number => !finite(number))) return false
  return value.sensors.every(sensor => record(sensor) && typeof sensor.id === 'string' && typeof sensor.online === 'boolean' && Array.isArray(sensor.measurements) && record(sensor.readings))
}

export function useSimulatorState() {
  const [snapshot, setSnapshot] = useState<SimulatorSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let latest: SimulatorSnapshot | null = null
    let thresholds: SimulatorSnapshot['settings']
    let lastPosition: number | undefined
    const receive = (value: unknown) => {
      if (!isSystemSnapshot(value)) throw new Error('Получен некорректный снимок системы')
      if (!active) return
      const mode = value.mode ?? 'simulation'
      if (latest && (latest.mode ?? 'simulation') !== mode) lastPosition = undefined
      if (latest && (latest.mode ?? 'simulation') === mode && value.revision < latest.revision) return
      if (value.settings && (!thresholds?.updated_at || !value.settings.updated_at || Date.parse(value.settings.updated_at) >= Date.parse(thresholds.updated_at))) thresholds = value.settings
      if (value.window.actual_position_percent !== null) lastPosition = value.window.actual_position_percent
      latest = { ...value, mode, data_source: mode === 'real' ? 'real' : 'simulator', settings: thresholds, window: { ...value.window, last_known_position_percent: lastPosition } }
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined }
      setSnapshot(latest); setConnected(true); setError(null)
    }
    const loadSnapshot = async () => {
      try {
        const response = await fetch('/api/simulator/state', { cache: 'no-store' })
        const result = await response.json() as { data?: unknown }
        if (!response.ok || !result.data) throw new Error('Не удалось получить состояние системы')
        receive(result.data)
      } catch (loadError) {
        if (active) {
          setConnected(false)
          setError(loadError instanceof Error ? loadError.message : 'Нет связи с сервером')
          retryTimer = setTimeout(() => {
            void loadSnapshot()
          }, 3000)
        }
      }
    }
    const loadThresholds = async () => {
      try {
        const next = await getNodeSettings()
        if (!active || thresholds?.updated_at && Date.parse(next.updated_at) < Date.parse(thresholds.updated_at)) return
        thresholds = next
        if (latest) { latest = { ...latest, settings: thresholds }; setSnapshot(latest) }
      } catch { /* Keep the last confirmed settings while the API reconnects. */ }
    }
    void loadSnapshot()
    void loadThresholds()
    const settingsTimer = setInterval(() => void loadThresholds(), 5000)
    const stream = new EventSource('/api/simulator/events')
    stream.addEventListener('snapshot', (event) => {
      try {
        receive(JSON.parse((event as MessageEvent<string>).data))
      } catch {
        if (active) { setConnected(false); setError('Получен некорректный снимок системы') }
      }
    })
    stream.onerror = () => {
      if (active) { setConnected(false); setError('Поток состояния прерван; показан последний снимок') }
    }
    stream.addEventListener('stream_error', () => { if (active) { setConnected(false); setError('Состояние временно недоступно; ждём восстановления связи') } })
    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
      clearInterval(settingsTimer)
      stream.close()
    }
  }, [])

  return { snapshot, connected, error }
}
