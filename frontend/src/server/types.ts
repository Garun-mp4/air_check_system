export interface SensorValues {
  co2: number
  temperature: number
  humidity: number
  pm25: number
}

export interface MeasurementInput {
  timestamp: Date
  indoor: SensorValues
  outdoor: Omit<SensorValues, 'co2'>
  windowOpen: boolean
}

export interface Measurement extends MeasurementInput {
  id: number
  createdAt: Date
}

export type PredictionStatus = 'ready' | 'insufficient_history' | 'unavailable'

export interface PredictionInput {
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

export interface DashboardResult {
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

export type ControlCommandStatus = 'pending' | 'applied'

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
}

export interface ControlState {
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
  deviceId: string
  timestamp: Date
  reported: ControlSnapshot
  appliedCommandIds: number[]
}

export interface ControlCommandResult {
  commands: ControlCommand[]
  status: ControlStatus
}

export interface NodeSettingsDefaults {
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
