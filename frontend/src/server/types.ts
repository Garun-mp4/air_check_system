import type { OutdoorPolicy, OutdoorSafety } from './outdoor-policy'
import type { StoredTelemetry } from '../lib/telemetry'
export interface SensorValues {
  co2: number
  temperature: number
  humidity: number
  pm25: number
}

export type DataSource = 'real' | 'simulator' | 'unknown'

export interface MeasurementInput {
  historicalOnly?: boolean
  ingestKey?: string
  outdoorSampledAt?: Date
  dataSource?: DataSource
  co2Limit?: number
  pm25Limit?: number
  ventilationOn?: boolean | null
  timestamp: Date
  indoor: SensorValues
  outdoor: Omit<SensorValues, 'co2'>
  windowOpen: boolean
}

export interface Measurement extends MeasurementInput {
  predictionStatus?: PredictionStatus | 'pending'
  predictionError?: string | null
  predictionErrorCode?: string | null
  id: number
  createdAt: Date
}

export type PredictionStatus = 'ready' | 'insufficient_history' | 'unavailable'

export interface PredictionInput {
  ingestKey?: string
  dataSource?: DataSource
  measurementId?: number | null
  sourceTimestamp?: Date | null
  targetTime: Date
  predictedCo2: number
  modelName: string
  modelVersion: string
}

export interface Prediction extends PredictionInput {
  id: number
  createdAt: Date
}

export type RecommendationType =
  | 'normal'
  | 'monitor'
  | 'forecast_warning'
  | 'ventilate_now'
  | 'ventilating'

export interface RecommendationDraft {
  ingestKey?: string
  forecastUsed?: boolean
  measurementId?: number | null
  type: RecommendationType
  message: string
  durationMinutes: number | null
  reason: string
}

export interface Recommendation extends RecommendationDraft {
  id: number
  createdAt: Date
}

export interface HistoryQuery {
  dataSource?: DataSource
  from?: Date
  to?: Date
  limit: number
}

export interface RetentionCleanupResult {
  cutoff: Date
  measurements: number
  predictions: number
  recommendations: number
  commands: number
}

export interface DashboardDiagnostics {
  measurement: 'missing' | 'fresh' | 'stale' | 'partial'
  device: DeviceConnectionStatus
  prediction: 'stale' | 'ready' | 'pending' | 'insufficient_history' | 'model_untrained' | 'unavailable' | 'error' | 'legacy'
  predictionMessage: string | null
  measuredAt: string | null
  assessedAt: string
}

export interface DashboardResult {
  telemetry?: StoredTelemetry | null
  diagnostics?: DashboardDiagnostics
  measurement: Measurement | null
  prediction: Prediction | null
  recommendation: Recommendation | null
}

export interface IngestResult extends DashboardResult {
  measurement: Measurement
  predictionStatus: PredictionStatus
  predictionError: string | null
}

export type ControlTarget = 'exhaust' | 'intake' | 'window'

export type ControlAction = 'on' | 'off' | 'open' | 'close' | 'auto'

export type VentilationAction = 'on' | 'off'

export type ControlSource = 'manual' | 'automatic'

export type ControlCommandStatus = 'pending' | 'applied' | 'failed' | 'cancelled' | 'expired'

export type WindowControlMode = 'auto' | 'manual'

export type DeviceConnectionStatus = 'online' | 'stale' | 'offline'

export interface ControlSnapshot {
  exhaustOn: boolean
  intakeOn: boolean
  windowOpen: boolean
}

export interface ControlCommandInput {
  deviceId: string
  target: ControlTarget
  desiredState: boolean
  source: ControlSource
  reason: string
  batchId: string
}

export interface ControlCommand extends ControlCommandInput {
  id: number
  status: ControlCommandStatus
  createdAt: Date
  appliedAt: Date | null
  expiresAt?: Date
  completedAt?: Date | null
  failureReason?: string | null
}

export interface ControlState {
  knownTargets?: ControlTarget[]
  deviceId: string
  reported: ControlSnapshot
  desired: ControlSnapshot
  windowMode: WindowControlMode
  overrideUntil: Date | null
  windowOpenSince: Date | null
  lastReportedAt: Date | null
  updatedAt: Date
  pendingCommands: number
  lastCommand: ControlCommand | null
  outdoorSafety?: OutdoorSafety | null
  ventilationStartedAt?: Date | null
  recentCommands?: ControlCommand[]
}

export interface ControlStatus extends ControlState {
  connectionStatus: DeviceConnectionStatus
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
}

export interface DeviceStateReport {
  knownTargets?: ControlTarget[]
  deviceId: string
  timestamp: Date
  reported: ControlSnapshot
  appliedCommandIds: number[]
  failedCommands?: Array<{ id: number; reason: string }>
}

export interface ControlCommandResult {
  commands: ControlCommand[]
  status: ControlStatus
}

export interface NodeSettingsDefaults {
  outdoorPolicy?: OutdoorPolicy
  automationEnabled: boolean
  autoWindowEnabled: boolean
  manualOverrideMinutes: number
  autoVentilationMinimumMinutes: number
  co2NormalThreshold: number
  co2CriticalThreshold: number
  pm25GoodLimit: number
  pm25ElevatedLimit: number
  alertsEnabled: boolean
  retentionHours: number
}

export interface NodeSettings extends NodeSettingsDefaults {
  deviceId: string
  updatedAt: Date
}

export type NodeSettingsPatch = Partial<
  Omit<NodeSettings, 'deviceId' | 'updatedAt' | 'retentionHours'>
>
