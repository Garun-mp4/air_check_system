import type {
  ControlAction,
  ControlTarget,
  DeviceStateReport,
  HistoryQuery,
  MeasurementInput,
  NodeSettingsPatch,
  SensorValues,
  VentilationAction,
} from './types'

export const MAX_HISTORY_LIMIT = 5000

export interface ValidationIssue {
  field: string
  message: string
}

export class ValidationError extends Error {
  readonly issues: ValidationIssue[]

  constructor(issues: ValidationIssue[]) {
    super('Проверьте данные запроса')
    this.name = 'ValidationError'
    this.issues = issues
  }
}

const ranges = {
  indoorCo2: [250, 10000],
  indoorTemperature: [-40, 80],
  indoorHumidity: [0, 100],
  indoorPm25: [0, 1000],
  outdoorTemperature: [-60, 80],
  outdoorHumidity: [0, 100],
  outdoorPm25: [0, 1000],
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberField(
  object: Record<string, unknown>,
  key: string,
  field: string,
  minimum: number,
  maximum: number,
  issues: ValidationIssue[],
): number {
  const value = object[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ field, message: 'должно быть конечным числом' })
    return Number.NaN
  }
  if (value < minimum || value > maximum) {
    issues.push({ field, message: 'должно быть в диапазоне ' + minimum + '–' + maximum })
  }
  return value
}

function timestampField(value: unknown, field: string, issues: ValidationIssue[]): Date {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push({ field, message: 'требуется дата RFC3339 с часовым поясом' })
    return new Date(Number.NaN)
  }
  const candidate = value.trim()
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(candidate)
  const parsed = new Date(candidate)
  if (!hasTimezone || Number.isNaN(parsed.getTime())) {
    issues.push({ field, message: 'должна быть датой RFC3339 с часовым поясом' })
    return new Date(Number.NaN)
  }
  return parsed
}

function requiredObject(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
): Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push({ field, message: 'требуется объект' })
    return {}
  }
  return value
}

export function parseMeasurementInput(payload: unknown): MeasurementInput {
  const issues: ValidationIssue[] = []
  if (!isRecord(payload)) {
    throw new ValidationError([{ field: 'body', message: 'требуется JSON-объект' }])
  }

  const indoor = requiredObject(payload.indoor, 'indoor', issues)
  const outdoor = requiredObject(payload.outdoor, 'outdoor', issues)
  const timestamp = timestampField(payload.timestamp, 'timestamp', issues)
  const windowOpen = payload.window_open
  if (typeof windowOpen !== 'boolean') {
    issues.push({ field: 'window_open', message: 'должно быть boolean' })
  }

  const indoorValues: SensorValues = {
    co2: numberField(indoor, 'co2', 'indoor.co2', ...ranges.indoorCo2, issues),
    temperature: numberField(
      indoor,
      'temperature',
      'indoor.temperature',
      ...ranges.indoorTemperature,
      issues,
    ),
    humidity: numberField(
      indoor,
      'humidity',
      'indoor.humidity',
      ...ranges.indoorHumidity,
      issues,
    ),
    pm25: numberField(indoor, 'pm25', 'indoor.pm25', ...ranges.indoorPm25, issues),
  }
  const outdoorValues = {
    temperature: numberField(
      outdoor,
      'temperature',
      'outdoor.temperature',
      ...ranges.outdoorTemperature,
      issues,
    ),
    humidity: numberField(
      outdoor,
      'humidity',
      'outdoor.humidity',
      ...ranges.outdoorHumidity,
      issues,
    ),
    pm25: numberField(
      outdoor,
      'pm25',
      'outdoor.pm25',
      ...ranges.outdoorPm25,
      issues,
    ),
  }

  if (issues.length > 0) {
    throw new ValidationError(issues)
  }
  return {
    timestamp,
    indoor: indoorValues,
    outdoor: outdoorValues,
    windowOpen: windowOpen as boolean,
  }
}

export function parseHistoryQuery(
  searchParams: URLSearchParams,
  defaultLimit: number,
): HistoryQuery {
  const issues: ValidationIssue[] = []
  const from = parseOptionalTimestamp(searchParams.get('from'), 'from', issues)
  const to = parseOptionalTimestamp(searchParams.get('to'), 'to', issues)
  const rawLimit = searchParams.get('limit')
  let limit = defaultLimit
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) {
      issues.push({ field: 'limit', message: 'должно быть целым положительным числом' })
    } else {
      limit = Number(rawLimit)
      if (limit < 1 || limit > MAX_HISTORY_LIMIT) {
        issues.push({
          field: 'limit',
          message: 'должно быть в диапазоне 1–' + MAX_HISTORY_LIMIT,
        })
      }
    }
  }
  if (from && to && from > to) {
    issues.push({ field: 'from', message: 'не может быть позже параметра to' })
  }
  if (issues.length > 0) {
    throw new ValidationError(issues)
  }
  return { from, to, limit }
}

const controlTargets = new Set<ControlTarget>(['exhaust', 'intake', 'window'])
const controlActions = new Set<ControlAction>([
  'on',
  'off',
  'open',
  'close',
  'auto',
])
const ventilationActions = new Set<VentilationAction>(['on', 'off'])

export function parseDeviceId(
  value: string | null | undefined,
  fallback: string,
): string {
  const candidate = value?.trim() || fallback
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(candidate)) {
    throw new ValidationError([
      {
        field: 'device_id',
        message:
          'должен содержать 1–64 символа: латинские буквы, цифры, _ или -',
      },
    ])
  }
  return candidate
}

function optionalBooleanField(
  object: Record<string, unknown>,
  inputKey: string,
  patchKey: 'automationEnabled' | 'autoWindowEnabled' | 'alertsEnabled',
  field: string,
  patch: NodeSettingsPatch,
  issues: ValidationIssue[],
): void {
  if (object[inputKey] === undefined) {
    return
  }
  if (typeof object[inputKey] !== 'boolean') {
    issues.push({ field, message: 'должно быть boolean' })
    return
  }
  patch[patchKey] = object[inputKey]
}

type NumericNodeSettingsKey =
  | 'manualOverrideMinutes'
  | 'autoVentilationMinimumMinutes'
  | 'co2NormalThreshold'
  | 'co2CriticalThreshold'
  | 'pm25GoodLimit'
  | 'pm25ElevatedLimit'

function optionalNumberField<K extends NumericNodeSettingsKey>(
  object: Record<string, unknown>,
  inputKey: string,
  patchKey: K,
  field: string,
  minimum: number,
  maximum: number,
  patch: NodeSettingsPatch,
  issues: ValidationIssue[],
  integer = false,
): void {
  if (object[inputKey] === undefined) {
    return
  }
  const value = object[inputKey]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ field, message: 'должно быть конечным числом' })
    return
  }
  if (value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    issues.push({
      field,
      message: integer
        ? 'должно быть целым числом в диапазоне ' + minimum + '–' + maximum
        : 'должно быть в диапазоне ' + minimum + '–' + maximum,
    })
    return
  }
  patch[patchKey] = value
}

export interface ParsedNodeSettingsPatch {
  deviceId: string
  patch: NodeSettingsPatch
}

export function parseNodeSettingsPatch(
  payload: unknown,
  fallbackDeviceId: string,
): ParsedNodeSettingsPatch {
  const issues: ValidationIssue[] = []
  if (!isRecord(payload)) {
    throw new ValidationError([{ field: 'body', message: 'требуется JSON-объект' }])
  }

  let deviceId = fallbackDeviceId
  if (payload.device_id !== undefined) {
    if (typeof payload.device_id !== 'string') {
      issues.push({ field: 'device_id', message: 'должен быть строкой' })
    } else {
      try {
        deviceId = parseDeviceId(payload.device_id, fallbackDeviceId)
      } catch (error) {
        if (error instanceof ValidationError) {
          issues.push(...error.issues)
        }
      }
    }
  }

  const patch: NodeSettingsPatch = {}
  optionalBooleanField(payload, 'automation_enabled', 'automationEnabled', 'automation_enabled', patch, issues)
  optionalBooleanField(payload, 'auto_window_enabled', 'autoWindowEnabled', 'auto_window_enabled', patch, issues)
  optionalBooleanField(payload, 'alerts_enabled', 'alertsEnabled', 'alerts_enabled', patch, issues)
  optionalNumberField(
    payload,
    'manual_override_minutes',
    'manualOverrideMinutes',
    'manual_override_minutes',
    1,
    240,
    patch,
    issues,
    true,
  )
  optionalNumberField(
    payload,
    'auto_ventilation_minimum_minutes',
    'autoVentilationMinimumMinutes',
    'auto_ventilation_minimum_minutes',
    1,
    120,
    patch,
    issues,
    true,
  )
  optionalNumberField(
    payload,
    'co2_normal_threshold',
    'co2NormalThreshold',
    'co2_normal_threshold',
    250,
    10000,
    patch,
    issues,
  )
  optionalNumberField(
    payload,
    'co2_critical_threshold',
    'co2CriticalThreshold',
    'co2_critical_threshold',
    250,
    10000,
    patch,
    issues,
  )
  optionalNumberField(payload, 'pm25_good_limit', 'pm25GoodLimit', 'pm25_good_limit', 0, 1000, patch, issues)
  optionalNumberField(
    payload,
    'pm25_elevated_limit',
    'pm25ElevatedLimit',
    'pm25_elevated_limit',
    0,
    1000,
    patch,
    issues,
  )

  if (Object.keys(patch).length === 0 && issues.length === 0) {
    issues.push({ field: 'body', message: 'нужно указать хотя бы одну настройку' })
  }
  if (issues.length > 0) {
    throw new ValidationError(issues)
  }
  return { deviceId, patch }
}

export interface ParsedControlCommand {
  deviceId: string
  target: ControlTarget
  action: ControlAction
}

export function parseControlCommand(
  payload: unknown,
  fallbackDeviceId: string,
): ParsedControlCommand {
  const issues: ValidationIssue[] = []
  if (!isRecord(payload)) {
    throw new ValidationError([{ field: 'body', message: 'требуется JSON-объект' }])
  }
  let deviceId = fallbackDeviceId
  if (payload.device_id !== undefined) {
    if (typeof payload.device_id !== 'string') {
      issues.push({ field: 'device_id', message: 'должен быть строкой' })
    } else {
      try {
        deviceId = parseDeviceId(payload.device_id, fallbackDeviceId)
      } catch (error) {
        if (error instanceof ValidationError) {
          issues.push(...error.issues)
        }
      }
    }
  }

  const target = payload.target
  if (typeof target !== 'string' || !controlTargets.has(target as ControlTarget)) {
    issues.push({ field: 'target', message: 'должен быть exhaust, intake или window' })
  }
  const action = payload.action
  if (typeof action !== 'string' || !controlActions.has(action as ControlAction)) {
    issues.push({ field: 'action', message: 'должно быть on, off, open, close или auto' })
  }
  if (
    typeof target === 'string' &&
    controlTargets.has(target as ControlTarget) &&
    typeof action === 'string' &&
    controlActions.has(action as ControlAction)
  ) {
    const targetValue = target as ControlTarget
    const actionValue = action as ControlAction
    const valid =
      targetValue === 'window'
        ? new Set<ControlAction>(['open', 'close', 'auto']).has(actionValue)
        : new Set<ControlAction>(['on', 'off']).has(actionValue)
    if (!valid) {
      issues.push({
        field: 'action',
        message:
          targetValue === 'window'
            ? 'для window доступны open, close или auto'
            : 'для exhaust и intake доступны on или off',
      })
    }
  }
  if (issues.length > 0) {
    throw new ValidationError(issues)
  }
  return {
    deviceId,
    target: target as ControlTarget,
    action: action as ControlAction,
  }
}

export interface ParsedVentilationCommand {
  deviceId: string
  action: VentilationAction
}

export function parseVentilationCommand(
  payload: unknown,
  fallbackDeviceId: string,
): ParsedVentilationCommand {
  const issues: ValidationIssue[] = []
  if (!isRecord(payload)) {
    throw new ValidationError([{ field: 'body', message: 'требуется JSON-объект' }])
  }

  let deviceId = fallbackDeviceId
  if (payload.device_id !== undefined) {
    if (typeof payload.device_id !== 'string') {
      issues.push({ field: 'device_id', message: 'должен быть строкой' })
    } else {
      try {
        deviceId = parseDeviceId(payload.device_id, fallbackDeviceId)
      } catch (error) {
        if (error instanceof ValidationError) {
          issues.push(...error.issues)
        }
      }
    }
  }

  const action = payload.action
  if (typeof action !== 'string' || !ventilationActions.has(action as VentilationAction)) {
    issues.push({ field: 'action', message: 'должно быть on или off' })
  }

  if (issues.length > 0) {
    throw new ValidationError(issues)
  }

  return {
    deviceId,
    action: action as VentilationAction,
  }
}

export function parseControlLimit(
  searchParams: URLSearchParams,
  defaultLimit = 20,
): number {
  const rawLimit = searchParams.get('limit')
  if (rawLimit === null || rawLimit.trim() === '') {
    return defaultLimit
  }
  if (!/^\d+$/.test(rawLimit)) {
    throw new ValidationError([
      { field: 'limit', message: 'должно быть целым положительным числом' },
    ])
  }
  const limit = Number(rawLimit)
  if (limit < 1 || limit > 100) {
    throw new ValidationError([
      { field: 'limit', message: 'должно быть в диапазоне 1–100' },
    ])
  }
  return limit
}

export function parseDeviceStateReport(
  payload: unknown,
  fallbackDeviceId: string,
): DeviceStateReport {
  const issues: ValidationIssue[] = []
  if (!isRecord(payload)) {
    throw new ValidationError([{ field: 'body', message: 'требуется JSON-объект' }])
  }
  let deviceId = fallbackDeviceId
  if (typeof payload.device_id !== 'string') {
    issues.push({ field: 'device_id', message: 'должен быть строкой' })
  } else {
    try {
      deviceId = parseDeviceId(payload.device_id, fallbackDeviceId)
    } catch (error) {
      if (error instanceof ValidationError) {
        issues.push(...error.issues)
      }
    }
  }
  const timestamp = timestampField(payload.timestamp, 'timestamp', issues)
  const booleans = ['exhaust_on', 'intake_on', 'window_open'] as const
  const values: Record<(typeof booleans)[number], boolean> = {
    exhaust_on: false,
    intake_on: false,
    window_open: false,
  }
  for (const key of booleans) {
    if (typeof payload[key] !== 'boolean') {
      issues.push({ field: key, message: 'должно быть boolean' })
    } else {
      values[key] = payload[key] as boolean
    }
  }
  const appliedCommandIds: number[] = []
  if (payload.applied_command_ids !== undefined) {
    if (
      !Array.isArray(payload.applied_command_ids) ||
      payload.applied_command_ids.some(
        (value) =>
          typeof value !== 'number' ||
          !Number.isInteger(value) ||
          value < 1,
      )
    ) {
      issues.push({
        field: 'applied_command_ids',
        message: 'должен быть массивом положительных целых чисел',
      })
    } else {
      appliedCommandIds.push(...(payload.applied_command_ids as number[]))
    }
  }
  if (issues.length > 0) {
    throw new ValidationError(issues)
  }
  return {
    deviceId,
    timestamp,
    reported: {
      exhaustOn: values.exhaust_on,
      intakeOn: values.intake_on,
      windowOpen: values.window_open,
    },
    appliedCommandIds,
  }
}

function parseOptionalTimestamp(
  value: string | null,
  field: string,
  issues: ValidationIssue[],
): Date | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }
  return timestampField(value, field, issues)
}
