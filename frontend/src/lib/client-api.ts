export interface ClientMeasurement {
  id: number
  created_at: string
  timestamp: string
  indoor: {
    co2: number
    temperature: number
    humidity: number
    pm25: number
  }
  outdoor: {
    temperature: number
    humidity: number
    pm25: number
  }
  window_open: boolean
}

export interface ClientPrediction {
  id: number
  created_at: string
  target_time: string
  predicted_co2_15min: number
  model_name: string
  model_version: string
}

export interface ClientRecommendation {
  id: number
  created_at: string
  type: 'normal' | 'monitor' | 'forecast_warning' | 'ventilate_now' | 'ventilating'
  message: string
  duration_minutes: number | null
  reason: string
}

export interface DashboardData {
  measurement: ClientMeasurement | null
  prediction: ClientPrediction | null
  recommendation: ClientRecommendation | null
}

export type ClientControlTarget = 'exhaust' | 'intake' | 'window'
export type ClientControlAction = 'on' | 'off' | 'open' | 'close' | 'auto'
export type ClientVentilationAction = 'on' | 'off'

export interface ClientControlCommand {
  id: number
  device_id: string
  target: ClientControlTarget
  state: 'on' | 'off' | 'open' | 'closed'
  desired_state: boolean
  source: 'manual' | 'automatic'
  reason: string
  batch_id: string
  status: 'pending' | 'applied'
  created_at: string
  applied_at: string | null
}

export interface ClientControlStatus {
  device_id: string
  connection: {
    status: 'online' | 'stale' | 'offline'
    last_seen_at: string | null
  }
  reported: {
    exhaust_on: boolean
    intake_on: boolean
    window_open: boolean
  }
  desired: {
    exhaust_on: boolean
    intake_on: boolean
    window_open: boolean
  }
  window: {
    mode: 'auto' | 'manual'
    override_until: string | null
    open_since: string | null
  }
  automation: {
    enabled: boolean
    status:
      | 'ready'
      | 'ventilating'
      | 'manual_override'
      | 'waiting_for_device'
      | 'disabled'
    message: string
  }
  pending_commands: number
  last_command: ClientControlCommand | null
  updated_at: string
}

export interface ClientNodeSettings {
  device_id: string
  automation_enabled: boolean
  auto_window_enabled: boolean
  manual_override_minutes: number
  auto_ventilation_minimum_minutes: number
  co2_normal_threshold: number
  co2_critical_threshold: number
  pm25_good_limit: number
  pm25_elevated_limit: number
  alerts_enabled: boolean
  retention_hours: number
  updated_at: string
}

export interface ClientNodeSettingsPatch {
  automation_enabled?: boolean
  auto_window_enabled?: boolean
  manual_override_minutes?: number
  auto_ventilation_minimum_minutes?: number
  co2_normal_threshold?: number
  co2_critical_threshold?: number
  pm25_good_limit?: number
  pm25_elevated_limit?: number
  alerts_enabled?: boolean
}

export interface HistoryMeta {
  count: number
  from: string | null
  to: string | null
  limit: number
}

export class ClientApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ClientApiError'
    this.status = status
  }
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '')

async function requestJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(apiBaseUrl + path, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    throw new ClientApiError('Не удалось подключиться к серверу', 0)
  }

  const text = await response.text()
  let payload: unknown = null
  if (text.trim() !== '') {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new ClientApiError('Сервер вернул невалидный ответ', response.status)
    }
  }
  if (!response.ok) {
    const message =
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : 'Сервер временно недоступен'
    throw new ClientApiError(message, response.status)
  }
  return payload as T
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(apiBaseUrl + path, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ClientApiError('Не удалось подключиться к серверу', 0)
  }
  const text = await response.text()
  let payload: unknown = null
  if (text.trim() !== '') {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new ClientApiError('Сервер вернул невалидный ответ', response.status)
    }
  }
  if (!response.ok) {
    const message =
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : 'Сервер временно недоступен'
    throw new ClientApiError(message, response.status)
  }
  return payload as T
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(apiBaseUrl + path, {
      method: 'PATCH',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ClientApiError('Не удалось подключиться к серверу', 0)
  }
  const text = await response.text()
  let payload: unknown = null
  if (text.trim() !== '') {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new ClientApiError('Сервер вернул невалидный ответ', response.status)
    }
  }
  if (!response.ok) {
    const message =
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : 'Сервер временно недоступен'
    throw new ClientApiError(message, response.status)
  }
  return payload as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function getLatestDashboard(
  signal?: AbortSignal,
): Promise<DashboardData> {
  const payload = await requestJson<{ data: DashboardData }>(
    '/api/v1/measurements/latest',
    signal,
  )
  return payload.data
}

export async function getHistory(
  from: Date,
  to: Date,
  limit = 5000,
  signal?: AbortSignal,
): Promise<{ data: ClientMeasurement[]; meta: HistoryMeta }> {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    limit: String(limit),
  })
  const payload = await requestJson<{
    data: ClientMeasurement[]
    meta: HistoryMeta
  }>('/api/v1/measurements/history?' + params.toString(), signal)
  return payload
}

export async function getControlStatus(
  deviceId?: string,
  signal?: AbortSignal,
): Promise<ClientControlStatus> {
  const params = deviceId
    ? '?' + new URLSearchParams({ device_id: deviceId }).toString()
    : ''
  const payload = await requestJson<{ data: ClientControlStatus }>(
    '/api/v1/controls' + params,
    signal,
  )
  return payload.data
}

export async function getNodeSettings(
  deviceId?: string,
  signal?: AbortSignal,
): Promise<ClientNodeSettings> {
  const params = deviceId
    ? '?' + new URLSearchParams({ device_id: deviceId }).toString()
    : ''
  const payload = await requestJson<{ data: ClientNodeSettings }>(
    '/api/v1/settings' + params,
    signal,
  )
  return payload.data
}

export async function updateNodeSettings(
  patch: ClientNodeSettingsPatch,
  deviceId?: string,
): Promise<ClientNodeSettings> {
  const payload = await patchJson<{ data: ClientNodeSettings }>(
    '/api/v1/settings',
    {
      ...(deviceId ? { device_id: deviceId } : {}),
      ...patch,
    },
  )
  return payload.data
}

export async function sendControlCommand(
  target: ClientControlTarget,
  action: ClientControlAction,
  deviceId?: string,
): Promise<ClientControlCommandResult> {
  const payload = await postJson<{
    data: ClientControlCommandResult
  }>('/api/v1/controls/commands', {
    ...(deviceId ? { device_id: deviceId } : {}),
    target,
    action,
  })
  return payload.data
}

export interface ClientControlCommandResult {
  commands: ClientControlCommand[]
  controls: ClientControlStatus
}

export async function sendVentilationCommand(
  action: ClientVentilationAction,
  deviceId?: string,
): Promise<ClientControlCommandResult> {
  const payload = await postJson<{
    data: ClientControlCommandResult
  }>('/api/v1/controls/ventilation', {
    ...(deviceId ? { device_id: deviceId } : {}),
    action,
  })
  return payload.data
}
