import { assertDeviceTime } from './device-time.ts'
import { measurementIdentity, measurementContentHash, IngestConflictError } from './ingest-identity.ts'
import { assessOutdoor, defaultOutdoorPolicy, type OutdoorPolicy, type OutdoorSafety } from './outdoor-policy.ts'
import { Pool } from 'pg'

import type {
  ControlCommand,
  ControlCommandInput,
  ControlState,
  DataSource,
  DeviceStateReport,
  HistoryQuery,
  Measurement,
  MeasurementInput,
  NodeSettings,
  NodeSettingsDefaults,
  NodeSettingsPatch,
  Prediction,
  PredictionInput,
  PredictionStatus,
  Recommendation,
  RecommendationDraft,
  RetentionCleanupResult,
  WindowControlMode,
} from './types'

export interface Repository {
  activateMode(deviceId: string, source: 'real' | 'simulator'): Promise<void>
  createMeasurement(input: MeasurementInput): Promise<Measurement>
  getLatestMeasurement(source?: DataSource): Promise<Measurement | null>
  listMeasurements(query: HistoryQuery): Promise<Measurement[]>
  createPrediction(input: PredictionInput): Promise<Prediction>
  getLatestPrediction(source?: DataSource): Promise<Prediction | null>
  getPredictionForMeasurement(id: number): Promise<Prediction | null>
  getRecommendationForMeasurement(id: number): Promise<Recommendation | null>
  setPredictionOutcome(id: number, status: PredictionStatus, error: string | null, code: string | null): Promise<void>
  createRecommendation(input: RecommendationDraft): Promise<Recommendation>
  getLatestRecommendation(): Promise<Recommendation | null>
  purgeExpiredData(cutoff: Date): Promise<RetentionCleanupResult>
  getControlState(deviceId: string): Promise<ControlState>
  getLatestControlCommand(
    deviceId: string,
    target: ControlCommand['target'],
  ): Promise<ControlCommand | null>
  queueControlCommands(input: ControlCommandInput[]): Promise<ControlCommand[]>
  listPendingControlCommands(deviceId: string, limit: number): Promise<ControlCommand[]>
  reportControlState(input: DeviceStateReport): Promise<ControlState>
  assessOutdoorAir(deviceId: string, measurement: Measurement, policy: OutdoorPolicy): Promise<OutdoorSafety>
  cancelControlBatch(deviceId: string, commandId: number): Promise<ControlState>
  getControlBatch(deviceId: string, commandId: number): Promise<ControlCommand[]>
  setWindowControlMode(
    deviceId: string,
    mode: WindowControlMode,
    overrideUntil: Date | null,
  ): Promise<ControlState>
  getNodeSettings(
    deviceId: string,
    defaults: NodeSettingsDefaults,
  ): Promise<NodeSettings>
  updateNodeSettings(
    deviceId: string,
    patch: NodeSettingsPatch,
    defaults: NodeSettingsDefaults,
  ): Promise<NodeSettings>
  ping(): Promise<void>
  close(): Promise<void>
}

export class NotFoundError extends Error {
  constructor(message = 'Запрошенная запись не найдена') {
    super(message)
    this.name = 'NotFoundError'
  }
}

function sortByTimestamp(left: Measurement, right: Measurement): number {
  return left.timestamp.getTime() - right.timestamp.getTime() || left.id - right.id
}

function sortPredictions(left: Prediction, right: Prediction): number {
  return (
    right.targetTime.getTime() - left.targetTime.getTime() ||
    right.createdAt.getTime() - left.createdAt.getTime() ||
    right.id - left.id
  )
}

function sortRecommendations(left: Recommendation, right: Recommendation): number {
  return right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id
}

function sortCommands(left: ControlCommand, right: ControlCommand): number {
  return (
    right.createdAt.getTime() - left.createdAt.getTime() ||
    right.id - left.id
  )
}

function emptyControlSnapshot() {
  return {
    exhaustOn: false,
    intakeOn: false,
    windowOpen: false,
  }
}

function cloneControlState(state: ControlState): ControlState {
  return {
    ...state,
    reported: { ...state.reported },
    ...(state.knownTargets ? { knownTargets: [...state.knownTargets] } : {}),
    desired: { ...state.desired },
    overrideUntil: state.overrideUntil ? new Date(state.overrideUntil) : null,
    windowOpenSince: state.windowOpenSince
      ? new Date(state.windowOpenSince)
      : null,
    lastReportedAt: state.lastReportedAt
      ? new Date(state.lastReportedAt)
      : null,
    updatedAt: new Date(state.updatedAt),
    lastCommand: state.lastCommand
      ? {
          ...state.lastCommand,
          createdAt: new Date(state.lastCommand.createdAt),
          appliedAt: state.lastCommand.appliedAt
            ? new Date(state.lastCommand.appliedAt)
            : null,
        }
      : null,
  }
}

function cloneNodeSettings(settings: NodeSettings): NodeSettings {
  return {
    ...settings,
    updatedAt: new Date(settings.updatedAt),
  }
}

// Commands from previous runtime modes remain in history, but cannot describe the active installation.
export const activeCommandEpochSql = "created_at >= COALESCE((SELECT updated_at FROM runtime_device_modes WHERE device_id=$1 AND data_source IS NOT NULL), '-infinity'::timestamptz)"

export class MemoryRepository implements Repository {
  private activeModes = new Map<string, 'real' | 'simulator'>()
  private activeCommandFloor = new Map<string, number>()
  private measurements: Measurement[] = []
  private predictions: Prediction[] = []
  private recommendations: Recommendation[] = []
  private controlStates = new Map<string, ControlState>()
  private controlCommands: ControlCommand[] = []
  private nodeSettings = new Map<string, NodeSettings>()
  private nextId = 1

  async activateMode(deviceId: string, source: 'real' | 'simulator'): Promise<void> {
    if (this.activeModes.get(deviceId) === source) return
    for (const command of this.controlCommands) if (command.deviceId === deviceId && command.status === 'pending') {
      command.status = 'cancelled'; command.completedAt = new Date(); command.failureReason = 'Изменён режим установки; команда предыдущего источника отменена'
    }
    const state = this.ensureControlState(deviceId)
    Object.assign(state, { reported: emptyControlSnapshot(), desired: emptyControlSnapshot(), knownTargets: [], lastReportedAt: null, windowMode: 'auto', overrideUntil: null, windowOpenSince: null, ventilationStartedAt: null, outdoorSafety: null, updatedAt: new Date() })
    this.activeModes.set(deviceId, source)
    this.activeCommandFloor.set(deviceId, this.nextId)
  }

  async createMeasurement(input: MeasurementInput): Promise<Measurement> {
    assertDeviceTime(input.timestamp)
    const key = measurementIdentity(input)
    const existing = this.measurements.find(item => item.ingestKey === key)
    if (existing) {
      if (measurementContentHash(existing) !== measurementContentHash(input)) throw new IngestConflictError()
      return existing
    }
    const measurement: Measurement = {
      ...input,
      ingestKey: key,
      id: this.nextId,
      createdAt: new Date(),
      indoor: { ...input.indoor },
      outdoor: { ...input.outdoor },
    }
    this.nextId += 1
    this.measurements.push(measurement)
    return measurement
  }

  async getLatestMeasurement(source?: DataSource): Promise<Measurement | null> {
    return this.measurements.filter(item => !item.historicalOnly && item.timestamp.getTime() <= Date.now() + 5000 && (source === undefined || (item.dataSource ?? 'unknown') === source)).sort(sortByTimestamp).at(-1) ?? null
  }

  async listMeasurements(query: HistoryQuery): Promise<Measurement[]> {
    return this.measurements
      .filter((measurement) => {
        const timestamp = measurement.timestamp.getTime()
        return (
          (query.dataSource === undefined || (measurement.dataSource ?? 'unknown') === query.dataSource) &&
          (query.from === undefined || timestamp >= query.from.getTime()) &&
          (query.to === undefined || timestamp <= query.to.getTime())
        )
      })
      .sort(sortByTimestamp)
      .slice(-query.limit)
  }

  async createPrediction(input: PredictionInput): Promise<Prediction> {
    const existing = input.ingestKey ? this.predictions.find(item => item.ingestKey === input.ingestKey) : null
    if (existing) return existing
    const prediction: Prediction = {
      ...input,
      id: this.nextId,
      createdAt: new Date(),
    }
    this.nextId += 1
    this.predictions.push(prediction)
    return prediction
  }

  async getLatestPrediction(source?: DataSource): Promise<Prediction | null> {
    return this.predictions.filter(item => source === undefined || (item.dataSource ?? 'unknown') === source).sort(sortPredictions)[0] ?? null
  }

  async getPredictionForMeasurement(id: number): Promise<Prediction | null> {
    return this.predictions.filter(p => p.measurementId === id).sort(sortPredictions)[0] ?? null
  }
  async getRecommendationForMeasurement(id: number): Promise<Recommendation | null> {
    return this.recommendations.filter(p => p.measurementId === id).sort(sortRecommendations)[0] ?? null
  }
  async setPredictionOutcome(id: number, status: PredictionStatus, error: string | null, code: string | null): Promise<void> {
    const measurement = this.measurements.find(m => m.id === id)
    if (!measurement) throw new NotFoundError()
    const ready = this.predictions.some(item => item.measurementId === id)
    measurement.predictionStatus = ready ? 'ready' : status; measurement.predictionError = ready ? null : error; measurement.predictionErrorCode = ready ? null : code
  }

  async createRecommendation(input: RecommendationDraft): Promise<Recommendation> {
    const existing = input.ingestKey ? this.recommendations.find(item => item.ingestKey === input.ingestKey) : null
    if (existing) {
      if (input.forecastUsed || !existing.forecastUsed) Object.assign(existing, input)
      return existing
    }
    const recommendation: Recommendation = {
      ...input,
      id: this.nextId,
      createdAt: new Date(),
    }
    this.nextId += 1
    this.recommendations.push(recommendation)
    return recommendation
  }

  async getLatestRecommendation(): Promise<Recommendation | null> {
    return [...this.recommendations].sort(sortRecommendations)[0] ?? null
  }

  async purgeExpiredData(cutoff: Date): Promise<RetentionCleanupResult> {
    for (const deviceId of this.controlStates.keys()) this.settleCommands(deviceId)
    const before = {
      measurements: this.measurements.length,
      predictions: this.predictions.length,
      recommendations: this.recommendations.length,
      commands: this.controlCommands.length,
    }

    this.measurements = this.measurements.filter(
      (measurement) => measurement.timestamp >= cutoff,
    )
    for (const prediction of this.predictions) if (prediction.measurementId && !this.measurements.some(m => m.id === prediction.measurementId)) prediction.measurementId = null
    for (const rec of this.recommendations) if (rec.measurementId && !this.measurements.some(m => m.id === rec.measurementId)) rec.measurementId = null
    this.predictions = this.predictions.filter(
      (prediction) => prediction.createdAt >= cutoff,
    )
    this.recommendations = this.recommendations.filter(
      (recommendation) => recommendation.createdAt >= cutoff,
    )
    this.controlCommands = this.controlCommands.filter(
      (command) =>
        command.status === 'pending' || command.createdAt >= cutoff,
    )

    return {
      cutoff: new Date(cutoff),
      measurements: before.measurements - this.measurements.length,
      predictions: before.predictions - this.predictions.length,
      recommendations: before.recommendations - this.recommendations.length,
      commands: before.commands - this.controlCommands.length,
    }
  }

  private ensureControlState(deviceId: string): ControlState {
    const existing = this.controlStates.get(deviceId)
    if (existing) {
      return existing
    }
    const now = new Date()
    const state: ControlState = {
      deviceId,
      reported: emptyControlSnapshot(),
      desired: emptyControlSnapshot(),
      windowMode: 'auto',
      overrideUntil: null,
      windowOpenSince: null,
      lastReportedAt: null,
      updatedAt: now,
      pendingCommands: 0,
      lastCommand: null,
    }
    this.controlStates.set(deviceId, state)
    return state
  }

  private settleCommands(deviceId: string): void {
    const state = this.ensureControlState(deviceId)
    for (const command of this.controlCommands) {
      if (command.deviceId === deviceId && command.status === 'pending' && command.expiresAt && command.expiresAt.getTime() <= Date.now()) {
        command.status = 'expired'
        command.completedAt = new Date()
        command.failureReason = 'Срок действия команды истёк'
      }
    }
    for (const [target, key] of [['exhaust', 'exhaustOn'], ['intake', 'intakeOn'], ['window', 'windowOpen']] as const) {
      const pending = this.controlCommands.filter(c => c.deviceId === deviceId && c.target === target && c.status === 'pending').at(-1)
      state.desired[key] = pending?.desiredState ?? state.reported[key]
    }
  }

  async assessOutdoorAir(deviceId: string, measurement: Measurement, policy: OutdoorPolicy): Promise<OutdoorSafety> {
    const state = this.ensureControlState(deviceId)
    const safety = assessOutdoor(measurement, policy, state.outdoorSafety)
    if (!state.outdoorSafety || new Date(state.outdoorSafety.measurementAt) <= measurement.timestamp) state.outdoorSafety = safety
    return safety
  }

  async getControlBatch(deviceId: string, commandId: number): Promise<ControlCommand[]> {
    this.settleCommands(deviceId)
    const command = this.controlCommands.find(c => c.id === commandId && c.deviceId === deviceId)
    if (!command) throw new NotFoundError('Команда не найдена')
    return this.controlCommands.filter(c => c.deviceId === deviceId && c.batchId === command.batchId).map(c => ({ ...c }))
  }

  async cancelControlBatch(deviceId: string, commandId: number): Promise<ControlState> {
    this.settleCommands(deviceId)
    const command = this.controlCommands.find(c => c.deviceId === deviceId && c.id === commandId)
    if (!command) throw new NotFoundError('Команда не найдена')
    for (const c of this.controlCommands) {
      if (c.deviceId === deviceId && c.batchId === command.batchId && c.status === 'pending') {
        c.status = 'cancelled'; c.completedAt = new Date(); c.failureReason = 'Отменено оператором'
      }
    }
    return this.getControlState(deviceId)
  }

  async getControlState(deviceId: string): Promise<ControlState> {
    this.settleCommands(deviceId)
    const state = this.ensureControlState(deviceId)
    const commands = this.controlCommands.filter(
      (command) => command.deviceId === deviceId && command.id >= (this.activeCommandFloor.get(deviceId) ?? 0),
    )
    state.pendingCommands = commands.filter(
      (command) => command.status === 'pending',
    ).length
    state.lastCommand = [...commands].sort(sortCommands)[0] ?? null
    const batches = new Set([...commands].sort(sortCommands).map(c => c.batchId).filter((batch, index, all) => all.indexOf(batch) === index).slice(0, 20))
    state.recentCommands = [...commands].sort(sortCommands).filter(c => batches.has(c.batchId)).map(c => ({ ...c }))
    return cloneControlState(state)
  }

  async getLatestControlCommand(
    deviceId: string,
    target: ControlCommand['target'],
  ): Promise<ControlCommand | null> {
    const command = [...this.controlCommands]
      .filter(
        (item) => item.deviceId === deviceId && item.target === target && item.id >= (this.activeCommandFloor.get(deviceId) ?? 0),
      )
      .sort(sortCommands)[0]
    return command ? { ...command } : null
  }

  async queueControlCommands(input: ControlCommandInput[]): Promise<ControlCommand[]> {
    if (input.length === 0) {
      return []
    }
    if (input.some(item => item.deviceId !== input[0].deviceId)) throw new Error('Batch must belong to one device')
    const created: ControlCommand[] = []
    for (const item of input) {
      this.settleCommands(item.deviceId)
      const state = this.ensureControlState(item.deviceId)
      const currentDesired =
        item.target === 'exhaust'
          ? state.desired.exhaustOn
          : item.target === 'intake'
            ? state.desired.intakeOn
            : state.desired.windowOpen
      const currentReported =
        item.target === 'exhaust'
          ? state.reported.exhaustOn
          : item.target === 'intake'
            ? state.reported.intakeOn
            : state.reported.windowOpen
      const previous = this.controlCommands.filter(c => c.deviceId === item.deviceId && c.target === item.target && c.id >= (this.activeCommandFloor.get(item.deviceId) ?? 0)).at(-1)
      if (item.source === 'automatic' && previous?.source === 'automatic' && previous.desiredState === item.desiredState && ['failed', 'expired', 'cancelled'].includes(previous.status)) continue
      const pendingForTarget = this.controlCommands.some(
        (command) =>
          command.deviceId === item.deviceId &&
          command.target === item.target &&
          command.status === 'pending' &&
          command.desiredState === item.desiredState,
      )
      if (
        currentDesired === item.desiredState &&
        ((state.knownTargets === undefined || state.knownTargets.includes(item.target)) && currentReported === item.desiredState || pendingForTarget)
      ) {
        continue
      }
      for (const previous of this.controlCommands) {
        if (previous.deviceId === item.deviceId && previous.target === item.target && previous.status === 'pending' && previous.desiredState !== item.desiredState) {
          previous.status = 'cancelled'; previous.completedAt = new Date(); previous.failureReason = 'Заменено новой командой'
        }
      }
      const command: ControlCommand = {
        ...item,
        id: this.nextId,
        status: 'pending',
        createdAt: new Date(),
        appliedAt: null,
        expiresAt: new Date(Date.now() + (item.source === 'manual' ? 300_000 : 120_000)),
        completedAt: null,
        failureReason: null,
      }
      this.nextId += 1
      this.controlCommands.push(command)
      created.push(command)
      if (item.target === 'exhaust') {
        state.desired.exhaustOn = item.desiredState
      } else if (item.target === 'intake') {
        state.desired.intakeOn = item.desiredState
      } else {
        state.desired.windowOpen = item.desiredState
      }
      state.updatedAt = new Date()
    }
    return created.map((command) => ({ ...command }))
  }

  async listPendingControlCommands(
    deviceId: string,
    limit: number,
  ): Promise<ControlCommand[]> {
    this.settleCommands(deviceId)
    return this.controlCommands
      .filter(
        (command) =>
          command.deviceId === deviceId && command.status === 'pending',
      )
      .sort((left, right) => left.id - right.id)
      .slice(0, limit)
      .map((command) => ({ ...command }))
  }

  async reportControlState(input: DeviceStateReport): Promise<ControlState> {
    assertDeviceTime(input.timestamp)
    this.settleCommands(input.deviceId)
    const state = this.ensureControlState(input.deviceId)
    const reportedAt = new Date(input.timestamp)
    if (
      state.lastReportedAt !== null &&
      reportedAt.getTime() < state.lastReportedAt.getTime() && state.lastReportedAt.getTime() <= Date.now() + 5000
    ) {
      return this.getControlState(input.deviceId)
    }
    const known = new Set(input.knownTargets ?? ['exhaust', 'intake', 'window'])
    const reported = {
      exhaustOn: known.has('exhaust') ? input.reported.exhaustOn : state.reported.exhaustOn,
      intakeOn: known.has('intake') ? input.reported.intakeOn : state.reported.intakeOn,
      windowOpen: known.has('window') ? input.reported.windowOpen : state.reported.windowOpen,
    }
    state.knownTargets = input.knownTargets ? [...input.knownTargets] : undefined
    const pendingTargets = new Set(
      this.controlCommands
        .filter(
          (command) =>
            command.deviceId === input.deviceId && command.status === 'pending',
        )
        .map((command) => command.target),
    )
    const previouslyOpen = state.reported.windowOpen
    if (state.windowOpenSince && state.windowOpenSince.getTime() > Date.now() + 5000) state.windowOpenSince = reportedAt
    if (state.ventilationStartedAt && state.ventilationStartedAt.getTime() > Date.now() + 5000) state.ventilationStartedAt = reportedAt
    state.reported = { ...reported }
    state.ventilationStartedAt = reported.exhaustOn || reported.intakeOn ? state.ventilationStartedAt ?? reportedAt : null
    if (!pendingTargets.has('exhaust')) {
      state.desired.exhaustOn = reported.exhaustOn
    }
    if (!pendingTargets.has('intake')) {
      state.desired.intakeOn = reported.intakeOn
    }
    if (!pendingTargets.has('window')) {
      state.desired.windowOpen = reported.windowOpen
    }
    state.lastReportedAt = reportedAt
    state.windowOpenSince = reported.windowOpen
      ? state.windowOpenSince ?? reportedAt
      : null
    if (!previouslyOpen && reported.windowOpen) {
      state.windowOpenSince = reportedAt
    }
    const actualStateByTarget = {
      exhaust: reported.exhaustOn,
      intake: reported.intakeOn,
      window: reported.windowOpen,
    }
    for (const failure of input.failedCommands ?? []) {
      const command = this.controlCommands.find(c => c.id === failure.id && c.deviceId === input.deviceId && c.status === 'pending')
      if (command) { command.status = 'failed'; command.completedAt = new Date(); command.failureReason = failure.reason }
    }
    for (const commandId of input.appliedCommandIds) {
      const command = this.controlCommands.find(
        (item) =>
          item.id === commandId &&
          item.deviceId === input.deviceId &&
          item.status === 'pending',
      )
      if (command && known.has(command.target) && actualStateByTarget[command.target] === command.desiredState) {
        command.status = 'applied'
        command.appliedAt = new Date()
        command.completedAt = command.appliedAt
      }
    }
    state.updatedAt = new Date()
    return this.getControlState(input.deviceId)
  }

  async setWindowControlMode(
    deviceId: string,
    mode: WindowControlMode,
    overrideUntil: Date | null,
  ): Promise<ControlState> {
    const state = this.ensureControlState(deviceId)
    state.windowMode = mode
    state.overrideUntil = overrideUntil ? new Date(overrideUntil) : null
    state.updatedAt = new Date()
    return this.getControlState(deviceId)
  }

  private ensureNodeSettings(
    deviceId: string,
    defaults: NodeSettingsDefaults,
  ): NodeSettings {
    const existing = this.nodeSettings.get(deviceId)
    if (existing) {
      return existing
    }
    const settings: NodeSettings = {
      deviceId,
      ...defaults,
      updatedAt: new Date(),
    }
    this.nodeSettings.set(deviceId, settings)
    return settings
  }

  async getNodeSettings(
    deviceId: string,
    defaults: NodeSettingsDefaults,
  ): Promise<NodeSettings> {
    return cloneNodeSettings(this.ensureNodeSettings(deviceId, defaults))
  }

  async updateNodeSettings(
    deviceId: string,
    patch: NodeSettingsPatch,
    defaults: NodeSettingsDefaults,
  ): Promise<NodeSettings> {
    const current = this.ensureNodeSettings(deviceId, defaults)
    const next: NodeSettings = {
      ...current,
      ...patch,
      deviceId,
      updatedAt: new Date(),
    }
    this.nodeSettings.set(deviceId, next)
    return cloneNodeSettings(next)
  }

  async ping(): Promise<void> {}

  async close(): Promise<void> {}
}

interface MeasurementRow {
  historical_only: boolean
  ingest_key: string | null
  outdoor_sampled_at: Date | string | null
  data_source: Measurement['dataSource']
  prediction_status: PredictionStatus | 'pending'
  prediction_error: string | null
  prediction_error_code: string | null
  id: number | string
  created_at: Date | string
  measurement_timestamp: Date | string
  indoor_co2: number | string
  indoor_temperature: number | string
  indoor_humidity: number | string
  indoor_pm25: number | string
  outdoor_temperature: number | string
  outdoor_humidity: number | string
  outdoor_pm25: number | string
  window_open: boolean
}

interface PredictionRow {
  data_source: Prediction['dataSource']
  measurement_id: number | string | null
  source_timestamp: Date | string | null
  id: number | string
  created_at: Date | string
  target_time: Date | string
  predicted_co2: number | string
  model_name: string
  model_version: string
}

interface RecommendationRow {
  measurement_id: number | string | null
  id: number | string
  created_at: Date | string
  type: Recommendation['type']
  message: string
  duration_minutes: number | string | null
  reason: string
}

interface ControlStateRow {
  known_targets: ControlState['knownTargets'] | null
  outdoor_safety: OutdoorSafety | null
  ventilation_started_at: Date | string | null
  device_id: string
  exhaust_on: boolean
  intake_on: boolean
  window_open: boolean
  desired_exhaust_on: boolean
  desired_intake_on: boolean
  desired_window_open: boolean
  window_mode: WindowControlMode
  override_until: Date | string | null
  window_open_since: Date | string | null
  last_reported_at: Date | string | null
  updated_at: Date | string
}

interface ControlCommandRow {
  id: number | string
  device_id: string
  target: ControlCommand['target']
  desired_state: boolean
  source: ControlCommand['source']
  reason: string
  batch_id: string
  status: ControlCommand['status']
  created_at: Date | string
  applied_at: Date | string | null
  expires_at: Date | string
  completed_at: Date | string | null
  failure_reason: string | null
}

interface NodeSettingsRow {
  outdoor_policy: OutdoorPolicy
  device_id: string
  automation_enabled: boolean
  auto_window_enabled: boolean
  manual_override_minutes: number | string
  auto_ventilation_minimum_minutes: number | string
  co2_normal_threshold: number | string
  co2_critical_threshold: number | string
  pm25_good_limit: number | string
  pm25_elevated_limit: number | string
  alerts_enabled: boolean
  updated_at: Date | string
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function asNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value)
}

function mapMeasurement(row: MeasurementRow): Measurement {
  return {
    ...(row.historical_only ? { historicalOnly: true } : {}),
    id: Number(row.id),
    createdAt: asDate(row.created_at),
    timestamp: asDate(row.measurement_timestamp),
    ...(row.ingest_key ? { ingestKey: row.ingest_key } : {}),
    ...(row.outdoor_sampled_at ? { outdoorSampledAt: asDate(row.outdoor_sampled_at) } : {}),
    ...(row.data_source !== 'unknown' ? { dataSource: row.data_source } : {}),
    predictionStatus: row.prediction_status,
    predictionError: row.prediction_error,
    predictionErrorCode: row.prediction_error_code,
    indoor: {
      co2: asNumber(row.indoor_co2),
      temperature: asNumber(row.indoor_temperature),
      humidity: asNumber(row.indoor_humidity),
      pm25: asNumber(row.indoor_pm25),
    },
    outdoor: {
      temperature: asNumber(row.outdoor_temperature),
      humidity: asNumber(row.outdoor_humidity),
      pm25: asNumber(row.outdoor_pm25),
    },
    windowOpen: row.window_open,
  }
}

function mapPrediction(row: PredictionRow): Prediction {
  return {
    id: Number(row.id),
    createdAt: asDate(row.created_at),
    measurementId: row.measurement_id == null ? null : Number(row.measurement_id),
    sourceTimestamp: row.source_timestamp ? asDate(row.source_timestamp) : null,
    targetTime: asDate(row.target_time),
    ...(row.data_source !== 'unknown' ? { dataSource: row.data_source } : {}),
    predictedCo2: asNumber(row.predicted_co2),
    modelName: row.model_name,
    modelVersion: row.model_version,
  }
}

function mapRecommendation(row: RecommendationRow): Recommendation {
  return {
    id: Number(row.id),
    createdAt: asDate(row.created_at),
    measurementId: row.measurement_id == null ? null : Number(row.measurement_id),
    type: row.type,
    message: row.message,
    durationMinutes:
      row.duration_minutes === null ? null : asNumber(row.duration_minutes),
    reason: row.reason,
  }
}

function mapControlCommand(row: ControlCommandRow): ControlCommand {
  return {
    id: Number(row.id),
    deviceId: row.device_id,
    target: row.target,
    desiredState: row.desired_state,
    source: row.source,
    reason: row.reason,
    batchId: row.batch_id,
    status: row.status,
    createdAt: asDate(row.created_at),
    appliedAt: row.applied_at === null ? null : asDate(row.applied_at),
    expiresAt: asDate(row.expires_at),
    completedAt: row.completed_at ? asDate(row.completed_at) : null,
    failureReason: row.failure_reason,
  }
}

function mapControlState(
  row: ControlStateRow,
  pendingCommands: number,
  lastCommand: ControlCommand | null,
): ControlState {
  return {
    deviceId: row.device_id,
    ...(row.known_targets ? { knownTargets: row.known_targets } : {}),
    reported: {
      exhaustOn: row.exhaust_on,
      intakeOn: row.intake_on,
      windowOpen: row.window_open,
    },
    desired: {
      exhaustOn: row.desired_exhaust_on,
      intakeOn: row.desired_intake_on,
      windowOpen: row.desired_window_open,
    },
    outdoorSafety: row.outdoor_safety,
    ventilationStartedAt: row.ventilation_started_at ? asDate(row.ventilation_started_at) : null,
    windowMode: row.window_mode,
    overrideUntil:
      row.override_until === null ? null : asDate(row.override_until),
    windowOpenSince:
      row.window_open_since === null ? null : asDate(row.window_open_since),
    lastReportedAt:
      row.last_reported_at === null ? null : asDate(row.last_reported_at),
    updatedAt: asDate(row.updated_at),
    pendingCommands,
    lastCommand,
  }
}

function mapNodeSettings(
  row: NodeSettingsRow,
  defaults: NodeSettingsDefaults,
): NodeSettings {
  return {
    deviceId: row.device_id,
    outdoorPolicy: row.outdoor_policy ?? { ...defaultOutdoorPolicy },
    automationEnabled: row.automation_enabled,
    autoWindowEnabled: row.auto_window_enabled,
    manualOverrideMinutes: asNumber(row.manual_override_minutes),
    autoVentilationMinimumMinutes: asNumber(row.auto_ventilation_minimum_minutes),
    co2NormalThreshold: asNumber(row.co2_normal_threshold),
    co2CriticalThreshold: asNumber(row.co2_critical_threshold),
    pm25GoodLimit: asNumber(row.pm25_good_limit),
    pm25ElevatedLimit: asNumber(row.pm25_elevated_limit),
    alertsEnabled: row.alerts_enabled,
    retentionHours: defaults.retentionHours,
    updatedAt: asDate(row.updated_at),
  }
}

const measurementColumns = [
  'id',
  'created_at',
  '"timestamp" AS measurement_timestamp',
  'indoor_co2',
  'indoor_temperature',
  'indoor_humidity',
  'indoor_pm25',
  'outdoor_temperature',
  'outdoor_humidity',
  'outdoor_pm25',
  'window_open',
  'prediction_status', 'prediction_error', 'prediction_error_code', 'data_source', 'ingest_key', 'outdoor_sampled_at', 'historical_only',
].join(', ')

export class PostgresRepository implements Repository {
  private readonly pool: Pool

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  }

  async activateMode(deviceId: string, source: 'real' | 'simulator'): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('INSERT INTO runtime_device_modes (device_id) VALUES ($1) ON CONFLICT DO NOTHING', [deviceId])
      const previous = await client.query<{ data_source: DataSource | null }>('SELECT data_source FROM runtime_device_modes WHERE device_id=$1 FOR UPDATE', [deviceId])
      await client.query("INSERT INTO actuator_states (device_id,known_targets) VALUES ($1,'{}') ON CONFLICT DO NOTHING", [deviceId])
      if (previous.rows[0].data_source !== source) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('aircheck-notifications'))")
        await client.query("UPDATE notification_events SET delivery_status='disabled',delivery_error='Изменён режим установки; доставка предыдущего источника отменена',next_attempt_at=NULL WHERE device_id=$1 AND delivery_status IN ('pending','sending')", [deviceId])
        await client.query('DELETE FROM notification_conditions WHERE device_id=$1', [deviceId])
        await client.query("UPDATE actuator_commands SET status='cancelled',completed_at=clock_timestamp(),failure_reason='Изменён режим установки; команда предыдущего источника отменена' WHERE device_id=$1 AND status='pending'", [deviceId])
        await client.query('INSERT INTO actuator_states (device_id) VALUES ($1) ON CONFLICT DO NOTHING', [deviceId])
        await client.query("UPDATE actuator_states SET exhaust_on=false,intake_on=false,window_open=false,desired_exhaust_on=false,desired_intake_on=false,desired_window_open=false,known_targets='{}',last_reported_at=NULL,window_mode='auto',override_until=NULL,window_open_since=NULL,ventilation_started_at=NULL,outdoor_safety=NULL,updated_at=clock_timestamp() WHERE device_id=$1", [deviceId])
        await client.query('UPDATE runtime_device_modes SET data_source=$2,updated_at=clock_timestamp() WHERE device_id=$1', [deviceId, source])
      }
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }

  async createMeasurement(input: MeasurementInput): Promise<Measurement> {
    assertDeviceTime(input.timestamp)
    const key = measurementIdentity(input)
    const result = await this.pool.query<MeasurementRow>(
      'INSERT INTO measurements ("timestamp", indoor_co2, indoor_temperature, indoor_humidity, ' +
        'indoor_pm25, outdoor_temperature, outdoor_humidity, outdoor_pm25, window_open, data_source, co2_limit, pm25_limit, ventilation_on, ingest_key, outdoor_sampled_at, historical_only) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) ON CONFLICT (ingest_key) DO NOTHING RETURNING ' +
        measurementColumns,
      [
        input.timestamp,
        input.indoor.co2,
        input.indoor.temperature,
        input.indoor.humidity,
        input.indoor.pm25,
        input.outdoor.temperature,
        input.outdoor.humidity,
        input.outdoor.pm25,
        input.windowOpen,
        input.dataSource ?? 'unknown',
        input.co2Limit ?? null, input.pm25Limit ?? null, input.ventilationOn ?? null, key, input.outdoorSampledAt ?? null, input.historicalOnly ?? false,
      ],
    )
    if (result.rows[0]) return mapMeasurement(result.rows[0])
    const existing = await this.pool.query<MeasurementRow>('SELECT ' + measurementColumns + ' FROM measurements WHERE ingest_key = $1', [key])
    if (!existing.rows[0]) throw new NotFoundError()
    const measurement = mapMeasurement(existing.rows[0])
    if (measurementContentHash(measurement) !== measurementContentHash(input)) throw new IngestConflictError()
    return measurement
  }

  async getLatestMeasurement(source?: DataSource): Promise<Measurement | null> {
    const result = await this.pool.query<MeasurementRow>(
      'SELECT ' +
        measurementColumns +
        " FROM measurements WHERE NOT historical_only AND \"timestamp\" <= clock_timestamp() + interval '5 seconds' AND ($1::text IS NULL OR data_source=$1) ORDER BY \"timestamp\" DESC, id DESC LIMIT 1",
      [source ?? null],
    )
    return result.rows[0] ? mapMeasurement(result.rows[0]) : null
  }

  async listMeasurements(query: HistoryQuery): Promise<Measurement[]> {
    const conditions: string[] = []
    const values: unknown[] = []
    if (query.dataSource !== undefined) {
      values.push(query.dataSource); conditions.push('data_source=$' + values.length)
    }
    if (query.from) {
      values.push(query.from)
      conditions.push('"timestamp" >= $' + values.length)
    }
    if (query.to) {
      values.push(query.to)
      conditions.push('"timestamp" <= $' + values.length)
    }
    values.push(Math.floor(query.limit))
    const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : ''
    const sql =
      'SELECT ' +
      measurementColumns +
      ' FROM measurements' +
      where +
      ' ORDER BY "timestamp" DESC, id DESC LIMIT $' +
      values.length
    const result = await this.pool.query<MeasurementRow>(sql, values)
    return result.rows.reverse().map(mapMeasurement)
  }

  async createPrediction(input: PredictionInput): Promise<Prediction> {
    const result = await this.pool.query<PredictionRow>(
      'INSERT INTO predictions (target_time, predicted_co2, model_name, model_version, measurement_id, source_timestamp, data_source, ingest_key) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (ingest_key) DO UPDATE SET ingest_key = EXCLUDED.ingest_key RETURNING id, created_at, target_time, predicted_co2, model_name, model_version, measurement_id, source_timestamp, data_source',
      [input.targetTime, input.predictedCo2, input.modelName, input.modelVersion, input.measurementId ?? null, input.sourceTimestamp ?? null, input.dataSource ?? 'unknown', input.ingestKey ?? null],
    )
    return mapPrediction(result.rows[0])
  }

  async getLatestPrediction(source?: DataSource): Promise<Prediction | null> {
    const result = await this.pool.query<PredictionRow>(
      'SELECT id, created_at, target_time, predicted_co2, model_name, model_version, measurement_id, source_timestamp, data_source ' +
        'FROM predictions WHERE ($1::text IS NULL OR data_source=$1) ORDER BY target_time DESC, created_at DESC, id DESC LIMIT 1',
      [source ?? null],
    )
    return result.rows[0] ? mapPrediction(result.rows[0]) : null
  }

  async getPredictionForMeasurement(id: number): Promise<Prediction | null> {
    const result = await this.pool.query<PredictionRow>('SELECT * FROM predictions WHERE measurement_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [id])
    return result.rows[0] ? mapPrediction(result.rows[0]) : null
  }
  async getRecommendationForMeasurement(id: number): Promise<Recommendation | null> {
    const result = await this.pool.query<RecommendationRow>('SELECT * FROM recommendations WHERE measurement_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [id])
    return result.rows[0] ? mapRecommendation(result.rows[0]) : null
  }
  async setPredictionOutcome(id: number, status: PredictionStatus, error: string | null, code: string | null): Promise<void> {
    const result = await this.pool.query("UPDATE measurements SET prediction_status = CASE WHEN EXISTS (SELECT 1 FROM predictions WHERE measurement_id=$1) THEN 'ready' ELSE $2 END, prediction_error = CASE WHEN EXISTS (SELECT 1 FROM predictions WHERE measurement_id=$1) THEN NULL ELSE $3 END, prediction_error_code = CASE WHEN EXISTS (SELECT 1 FROM predictions WHERE measurement_id=$1) THEN NULL ELSE $4 END WHERE id = $1", [id, status, error, code])
    if (!result.rowCount) throw new NotFoundError()
  }

  async createRecommendation(input: RecommendationDraft): Promise<Recommendation> {
    const result = await this.pool.query<RecommendationRow>(
      'INSERT INTO recommendations (type, message, duration_minutes, reason, measurement_id, ingest_key, forecast_used) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (ingest_key) DO UPDATE SET type=EXCLUDED.type, message=EXCLUDED.message, duration_minutes=EXCLUDED.duration_minutes, reason=EXCLUDED.reason, forecast_used=EXCLUDED.forecast_used ' +
        'WHERE EXCLUDED.forecast_used OR NOT recommendations.forecast_used RETURNING id,created_at,type,message,duration_minutes,reason,measurement_id',
      [input.type,input.message,input.durationMinutes,input.reason,input.measurementId ?? null,input.ingestKey ?? null,input.forecastUsed ?? false],
    )
    if (result.rows[0]) return mapRecommendation(result.rows[0])
    const existing = await this.pool.query<RecommendationRow>('SELECT * FROM recommendations WHERE ingest_key=$1', [input.ingestKey])
    if (!existing.rows[0]) throw new NotFoundError()
    return mapRecommendation(existing.rows[0])
  }

  async getLatestRecommendation(): Promise<Recommendation | null> {
    const result = await this.pool.query<RecommendationRow>(
      'SELECT id, created_at, type, message, duration_minutes, reason, measurement_id ' +
        'FROM recommendations ORDER BY created_at DESC, id DESC LIMIT 1',
    )
    return result.rows[0] ? mapRecommendation(result.rows[0]) : null
  }

  async purgeExpiredData(cutoff: Date): Promise<RetentionCleanupResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const nodes = await client.query<{ device_id: string }>('SELECT device_id FROM actuator_states ORDER BY device_id FOR UPDATE')
      for (const node of nodes.rows) await this.settleCommands(node.device_id, client)
      const measurements = await client.query<{ count: number }>('SELECT archive_air_history($1) AS count', [cutoff])
      const predictions = await client.query(
        'DELETE FROM predictions WHERE created_at < $1',
        [cutoff],
      )
      const recommendations = await client.query(
        'DELETE FROM recommendations WHERE created_at < $1',
        [cutoff],
      )
      // Only unexpired pending commands are retained. The current actuator state is kept
      // in actuator_states and is never part of retention cleanup.
      const commands = await client.query(
        "DELETE FROM actuator_commands WHERE created_at < $1 AND status <> 'pending'",
        [cutoff],
      )
      await client.query('COMMIT')
      return {
        cutoff: new Date(cutoff),
        measurements: Number(measurements.rows[0].count),
        predictions: Number(predictions.rowCount ?? 0),
        recommendations: Number(recommendations.rowCount ?? 0),
        commands: Number(commands.rowCount ?? 0),
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async ensureControlState(deviceId: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO actuator_states (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING',
      [deviceId],
    )
  }

  private async readControlState(
    deviceId: string,
    client: Pick<Pool, 'query'> = this.pool,
  ): Promise<ControlState> {
    const stateResult = await client.query<ControlStateRow>(
      'SELECT device_id, exhaust_on, intake_on, window_open, desired_exhaust_on, ' +
        'desired_intake_on, desired_window_open, window_mode, override_until, ' +
        'window_open_since, last_reported_at, updated_at, outdoor_safety, ventilation_started_at, known_targets FROM actuator_states ' +
        'WHERE device_id = $1',
      [deviceId],
    )
    if (!stateResult.rows[0]) {
      throw new NotFoundError('Состояние локального узла не найдено')
    }
    const pendingResult = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM actuator_commands WHERE device_id = $1 AND status = 'pending'",
      [deviceId],
    )
    const lastCommandResult = await client.query<ControlCommandRow>(
      'SELECT id, device_id, target, desired_state, source, reason, batch_id, status, created_at, applied_at, expires_at, completed_at, failure_reason ' +
        'FROM actuator_commands WHERE device_id = $1 AND ' + activeCommandEpochSql + ' ORDER BY created_at DESC, id DESC LIMIT 1',
      [deviceId],
    )
    const recent = await client.query<ControlCommandRow>('SELECT * FROM actuator_commands WHERE device_id = $1 AND ' + activeCommandEpochSql + ' AND batch_id IN (SELECT batch_id FROM actuator_commands WHERE device_id = $1 GROUP BY batch_id ORDER BY MAX(id) DESC LIMIT 20) ORDER BY created_at DESC, id DESC', [deviceId])
    return { ...mapControlState(
      stateResult.rows[0],
      Number(pendingResult.rows[0]?.count ?? 0),
      lastCommandResult.rows[0]
        ? mapControlCommand(lastCommandResult.rows[0])
        : null,
    ), recentCommands: recent.rows.map(mapControlCommand) }
  }

  private async settleCommands(deviceId: string, client: Pick<Pool, 'query'>): Promise<void> {
    await client.query("UPDATE actuator_commands SET status = 'expired', completed_at = NOW(), failure_reason = 'Срок действия команды истёк' WHERE device_id = $1 AND status = 'pending' AND expires_at <= clock_timestamp()", [deviceId])
    await this.syncDesired(deviceId, client)
  }

  private async syncDesired(deviceId: string, client: Pick<Pool, 'query'>): Promise<void> {
    await client.query(`UPDATE actuator_states s SET
      desired_exhaust_on = COALESCE((SELECT desired_state FROM actuator_commands WHERE device_id = s.device_id AND target = 'exhaust' AND status = 'pending' ORDER BY id DESC LIMIT 1), exhaust_on),
      desired_intake_on = COALESCE((SELECT desired_state FROM actuator_commands WHERE device_id = s.device_id AND target = 'intake' AND status = 'pending' ORDER BY id DESC LIMIT 1), intake_on),
      desired_window_open = COALESCE((SELECT desired_state FROM actuator_commands WHERE device_id = s.device_id AND target = 'window' AND status = 'pending' ORDER BY id DESC LIMIT 1), window_open)
      WHERE device_id = $1`, [deviceId])
  }

  private async withControlLock<T>(deviceId: string, work: (client: Pick<Pool, 'query'>) => Promise<T>): Promise<T> {
    await this.ensureControlState(deviceId)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT device_id FROM actuator_states WHERE device_id = $1 FOR UPDATE', [deviceId])
      await this.settleCommands(deviceId, client)
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }

  async assessOutdoorAir(deviceId: string, measurement: Measurement, policy: OutdoorPolicy): Promise<OutdoorSafety> {
    return this.withControlLock(deviceId, async client => {
      const state = await this.readControlState(deviceId, client)
      const safety = assessOutdoor(measurement, policy, state.outdoorSafety)
      if (!state.outdoorSafety || new Date(state.outdoorSafety.measurementAt) <= measurement.timestamp) {
        await client.query('UPDATE actuator_states SET outdoor_safety = $2::jsonb WHERE device_id = $1', [deviceId, JSON.stringify(safety)])
      }
      return safety
    })
  }

  async getControlBatch(deviceId: string, commandId: number): Promise<ControlCommand[]> {
    return this.withControlLock(deviceId, async client => {
      const commands = await client.query<ControlCommandRow>('SELECT * FROM actuator_commands WHERE device_id = $1 AND batch_id = (SELECT batch_id FROM actuator_commands WHERE device_id = $1 AND id = $2) ORDER BY id', [deviceId, commandId])
      if (!commands.rows.length) throw new NotFoundError('Команда не найдена')
      return commands.rows.map(mapControlCommand)
    })
  }

  async cancelControlBatch(deviceId: string, commandId: number): Promise<ControlState> {
    return this.withControlLock(deviceId, async client => {
      const found = await client.query<{ batch_id: string }>('SELECT batch_id FROM actuator_commands WHERE device_id = $1 AND id = $2', [deviceId, commandId])
      if (!found.rows[0]) throw new NotFoundError('Команда не найдена')
      await client.query("UPDATE actuator_commands SET status = 'cancelled', completed_at = NOW(), failure_reason = 'Отменено оператором' WHERE device_id = $1 AND batch_id = $2 AND status = 'pending'", [deviceId, found.rows[0].batch_id])
      await this.syncDesired(deviceId, client)
      return this.readControlState(deviceId, client)
    })
  }

  async getControlState(deviceId: string): Promise<ControlState> {
    return this.withControlLock(deviceId, client => this.readControlState(deviceId, client))
  }

  async getLatestControlCommand(
    deviceId: string,
    target: ControlCommand['target'],
  ): Promise<ControlCommand | null> {
    const result = await this.pool.query<ControlCommandRow>(
      'SELECT id, device_id, target, desired_state, source, reason, batch_id, status, created_at, applied_at, expires_at, completed_at, failure_reason ' +
        'FROM actuator_commands WHERE device_id = $1 AND target = $2 AND ' + activeCommandEpochSql + ' ' +
        'ORDER BY created_at DESC, id DESC LIMIT 1',
      [deviceId, target],
    )
    return result.rows[0] ? mapControlCommand(result.rows[0]) : null
  }

  async queueControlCommands(input: ControlCommandInput[]): Promise<ControlCommand[]> {
    if (input.length === 0) {
      return []
    }
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'INSERT INTO actuator_states (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING',
        [input[0].deviceId],
      )
      await client.query(
        'SELECT device_id FROM actuator_states WHERE device_id = $1 FOR UPDATE',
        [input[0].deviceId],
      )
      if (input.some(item => item.deviceId !== input[0].deviceId)) throw new Error('Batch must belong to one device')
      await this.settleCommands(input[0].deviceId, client)
      const current = await this.readControlState(input[0].deviceId, client)
      const pendingResult = await client.query<{
        target: ControlCommand['target']
        desired_state: boolean
      }>(
        "SELECT target, desired_state FROM actuator_commands WHERE device_id = $1 AND status = 'pending'",
        [input[0].deviceId],
      )
      const created: ControlCommand[] = []
      for (const item of input) {
        const currentDesired =
          item.target === 'exhaust'
            ? current.desired.exhaustOn
            : item.target === 'intake'
              ? current.desired.intakeOn
              : current.desired.windowOpen
        const currentReported =
          item.target === 'exhaust'
            ? current.reported.exhaustOn
            : item.target === 'intake'
              ? current.reported.intakeOn
              : current.reported.windowOpen
        const previousResult = await client.query<ControlCommandRow>('SELECT * FROM actuator_commands WHERE device_id = $1 AND target = $2 AND ' + activeCommandEpochSql + ' ORDER BY id DESC LIMIT 1', [item.deviceId, item.target])
        const previous = previousResult.rows[0]
        if (item.source === 'automatic' && previous?.source === 'automatic' && previous.desired_state === item.desiredState && ['failed', 'expired', 'cancelled'].includes(previous.status)) continue
        const pendingForTarget = pendingResult.rows.some(
          (row) =>
            row.target === item.target &&
            row.desired_state === item.desiredState,
        )
        if (
          currentDesired === item.desiredState &&
          ((current.knownTargets === undefined || current.knownTargets.includes(item.target)) && currentReported === item.desiredState || pendingForTarget)
        ) {
          continue
        }
        await client.query("UPDATE actuator_commands SET status = 'cancelled', completed_at = NOW(), failure_reason = 'Заменено новой командой' WHERE device_id = $1 AND target = $2 AND status = 'pending' AND desired_state <> $3", [item.deviceId, item.target, item.desiredState])
        pendingResult.rows = pendingResult.rows.filter(row => row.target !== item.target || row.desired_state === item.desiredState)
        const result = await client.query<ControlCommandRow>(
          'INSERT INTO actuator_commands (device_id, target, desired_state, source, reason, batch_id, expires_at) ' +
            "VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp() + CASE WHEN $4 = 'manual' THEN INTERVAL '5 minutes' ELSE INTERVAL '2 minutes' END) RETURNING id, device_id, target, desired_state, source, reason, batch_id, status, created_at, applied_at, expires_at, completed_at, failure_reason",
          [
            item.deviceId,
            item.target,
            item.desiredState,
            item.source,
            item.reason,
            item.batchId,
          ],
        )
        created.push(mapControlCommand(result.rows[0]))
        pendingResult.rows.push({
          target: item.target,
          desired_state: item.desiredState,
        })
        if (item.target === 'exhaust') {
          await client.query(
            'UPDATE actuator_states SET desired_exhaust_on = $2, updated_at = NOW() WHERE device_id = $1',
            [item.deviceId, item.desiredState],
          )
          current.desired.exhaustOn = item.desiredState
        } else if (item.target === 'intake') {
          await client.query(
            'UPDATE actuator_states SET desired_intake_on = $2, updated_at = NOW() WHERE device_id = $1',
            [item.deviceId, item.desiredState],
          )
          current.desired.intakeOn = item.desiredState
        } else {
          await client.query(
            'UPDATE actuator_states SET desired_window_open = $2, updated_at = NOW() WHERE device_id = $1',
            [item.deviceId, item.desiredState],
          )
          current.desired.windowOpen = item.desiredState
        }
      }
      await client.query('COMMIT')
      return created
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async listPendingControlCommands(
    deviceId: string,
    limit: number,
  ): Promise<ControlCommand[]> {
    return this.withControlLock(deviceId, async client => {
    const result = await client.query<ControlCommandRow>(
      "SELECT id, device_id, target, desired_state, source, reason, batch_id, status, created_at, applied_at, expires_at, completed_at, failure_reason FROM actuator_commands WHERE device_id = $1 AND status = 'pending' ORDER BY id ASC LIMIT $2",
      [deviceId, Math.floor(limit)],
    )
    return result.rows.map(mapControlCommand)
    })
  }

  async reportControlState(input: DeviceStateReport): Promise<ControlState> {
    assertDeviceTime(input.timestamp)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('INSERT INTO actuator_states (device_id) VALUES ($1) ON CONFLICT DO NOTHING', [input.deviceId])
      await client.query('SELECT device_id FROM actuator_states WHERE device_id = $1 FOR UPDATE', [input.deviceId])
      await this.settleCommands(input.deviceId, client)
      const previous = await this.readControlState(input.deviceId, client)
      const known = new Set(input.knownTargets ?? ['exhaust', 'intake', 'window'])
      const reported = {
        exhaustOn: known.has('exhaust') ? input.reported.exhaustOn : previous.reported.exhaustOn,
        intakeOn: known.has('intake') ? input.reported.intakeOn : previous.reported.intakeOn,
        windowOpen: known.has('window') ? input.reported.windowOpen : previous.reported.windowOpen,
      }

      const reportResult = await client.query<{ device_id: string }>(
        'INSERT INTO actuator_states (device_id, exhaust_on, intake_on, window_open, desired_exhaust_on, desired_intake_on, desired_window_open, last_reported_at, window_open_since) ' +
          'VALUES ($1, $2::boolean, $3::boolean, $4::boolean, $2::boolean, $3::boolean, $4::boolean, $5::timestamptz, CASE WHEN $4::boolean THEN $5::timestamptz ELSE NULL::timestamptz END) ' +
          'ON CONFLICT (device_id) DO UPDATE SET exhaust_on = EXCLUDED.exhaust_on, intake_on = EXCLUDED.intake_on, ' +
          "window_open = EXCLUDED.window_open, window_open_since = CASE WHEN EXCLUDED.window_open THEN CASE WHEN actuator_states.window_open_since > clock_timestamp() + interval '5 seconds' THEN EXCLUDED.last_reported_at ELSE COALESCE(actuator_states.window_open_since, EXCLUDED.last_reported_at) END ELSE NULL END, " +
          "desired_exhaust_on = CASE WHEN EXISTS (SELECT 1 FROM actuator_commands WHERE device_id = EXCLUDED.device_id AND target = 'exhaust' AND status = 'pending') THEN actuator_states.desired_exhaust_on ELSE EXCLUDED.exhaust_on END, " +
          "desired_intake_on = CASE WHEN EXISTS (SELECT 1 FROM actuator_commands WHERE device_id = EXCLUDED.device_id AND target = 'intake' AND status = 'pending') THEN actuator_states.desired_intake_on ELSE EXCLUDED.intake_on END, " +
          "desired_window_open = CASE WHEN EXISTS (SELECT 1 FROM actuator_commands WHERE device_id = EXCLUDED.device_id AND target = 'window' AND status = 'pending') THEN actuator_states.desired_window_open ELSE EXCLUDED.window_open END, " +
          "ventilation_started_at = CASE WHEN EXCLUDED.exhaust_on OR EXCLUDED.intake_on THEN CASE WHEN actuator_states.ventilation_started_at > clock_timestamp() + interval '5 seconds' THEN EXCLUDED.last_reported_at ELSE COALESCE(actuator_states.ventilation_started_at, EXCLUDED.last_reported_at) END ELSE NULL END, " +
          'last_reported_at = EXCLUDED.last_reported_at, known_targets = $6::text[], updated_at = NOW() ' +
          "WHERE actuator_states.last_reported_at IS NULL OR EXCLUDED.last_reported_at >= actuator_states.last_reported_at OR actuator_states.last_reported_at > clock_timestamp() + interval '5 seconds' " +
          'RETURNING device_id',
        [
          input.deviceId,
          reported.exhaustOn,
          reported.intakeOn,
          reported.windowOpen,
          input.timestamp, input.knownTargets ?? null,
        ],
      )
      if ((reportResult.rowCount ?? 0) > 0) {
        for (const failure of input.failedCommands ?? []) {
          await client.query("UPDATE actuator_commands SET status = 'failed', completed_at = NOW(), failure_reason = $3 WHERE device_id = $1 AND id = $2 AND status = 'pending' AND expires_at > clock_timestamp()", [input.deviceId, failure.id, failure.reason])
        }
      }
      if (
        reportResult.rowCount !== null &&
        reportResult.rowCount > 0 &&
        input.appliedCommandIds.length > 0
      ) {
        await client.query(
          "UPDATE actuator_commands SET status = 'applied', applied_at = NOW(), completed_at = NOW() " +
            "WHERE device_id = $1 AND status = 'pending' AND expires_at > clock_timestamp() AND id = ANY($2::bigint[]) " +
            "AND target = ANY($6::text[]) AND ((target = 'exhaust' AND desired_state = $3::boolean) " +
            "OR (target = 'intake' AND desired_state = $4::boolean) " +
            "OR (target = 'window' AND desired_state = $5::boolean))",
          [
            input.deviceId,
            input.appliedCommandIds,
            reported.exhaustOn,
            reported.intakeOn,
            reported.windowOpen, [...known],
          ],
        )
      }
      if ((reportResult.rowCount ?? 0) > 0) await client.query('UPDATE actuator_states SET ventilation_started_at = CASE WHEN exhaust_on OR intake_on THEN COALESCE(ventilation_started_at, last_reported_at) ELSE NULL END WHERE device_id = $1', [input.deviceId])
      await this.syncDesired(input.deviceId, client)
      const state = await this.readControlState(input.deviceId, client)
      await client.query('COMMIT')
      return state
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async setWindowControlMode(
    deviceId: string,
    mode: WindowControlMode,
    overrideUntil: Date | null,
  ): Promise<ControlState> {
    await this.ensureControlState(deviceId)
    await this.pool.query(
      'UPDATE actuator_states SET window_mode = $2, override_until = $3, updated_at = NOW() WHERE device_id = $1',
      [deviceId, mode, overrideUntil],
    )
    return this.readControlState(deviceId)
  }

  private async ensureNodeSettings(
    deviceId: string,
    defaults: NodeSettingsDefaults,
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO node_settings (' +
        'device_id, automation_enabled, auto_window_enabled, manual_override_minutes, ' +
        'auto_ventilation_minimum_minutes, co2_normal_threshold, co2_critical_threshold, ' +
        'pm25_good_limit, pm25_elevated_limit, alerts_enabled, outdoor_policy' +
        ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) ' +
        'ON CONFLICT (device_id) DO NOTHING',
      [
        deviceId,
        defaults.automationEnabled,
        defaults.autoWindowEnabled,
        defaults.manualOverrideMinutes,
        defaults.autoVentilationMinimumMinutes,
        defaults.co2NormalThreshold,
        defaults.co2CriticalThreshold,
        defaults.pm25GoodLimit,
        defaults.pm25ElevatedLimit,
        defaults.alertsEnabled,
        JSON.stringify(defaults.outdoorPolicy ?? defaultOutdoorPolicy),
      ],
    )
  }

  private async readNodeSettings(
    deviceId: string,
    defaults: NodeSettingsDefaults,
  ): Promise<NodeSettings> {
    const result = await this.pool.query<NodeSettingsRow>(
      'SELECT device_id, automation_enabled, auto_window_enabled, manual_override_minutes, ' +
        'auto_ventilation_minimum_minutes, co2_normal_threshold, co2_critical_threshold, ' +
        'pm25_good_limit, pm25_elevated_limit, alerts_enabled, updated_at, outdoor_policy ' +
        'FROM node_settings WHERE device_id = $1',
      [deviceId],
    )
    if (!result.rows[0]) {
      throw new NotFoundError('Настройки локального узла не найдены')
    }
    return mapNodeSettings(result.rows[0], defaults)
  }

  async getNodeSettings(
    deviceId: string,
    defaults: NodeSettingsDefaults,
  ): Promise<NodeSettings> {
    await this.ensureNodeSettings(deviceId, defaults)
    return this.readNodeSettings(deviceId, defaults)
  }

  async updateNodeSettings(
    deviceId: string,
    patch: NodeSettingsPatch,
    defaults: NodeSettingsDefaults,
  ): Promise<NodeSettings> {
    const current = await this.getNodeSettings(deviceId, defaults)
    const next = { ...current, ...patch }
    await this.pool.query(
      'UPDATE node_settings SET automation_enabled = $2, auto_window_enabled = $3, ' +
        'manual_override_minutes = $4, auto_ventilation_minimum_minutes = $5, ' +
        'co2_normal_threshold = $6, co2_critical_threshold = $7, pm25_good_limit = $8, ' +
        'pm25_elevated_limit = $9, alerts_enabled = $10, outdoor_policy = $11::jsonb, updated_at = NOW() ' +
        'WHERE device_id = $1',
      [
        deviceId,
        next.automationEnabled,
        next.autoWindowEnabled,
        next.manualOverrideMinutes,
        next.autoVentilationMinimumMinutes,
        next.co2NormalThreshold,
        next.co2CriticalThreshold,
        next.pm25GoodLimit,
        next.pm25ElevatedLimit,
        next.alertsEnabled,
        JSON.stringify(next.outdoorPolicy ?? defaultOutdoorPolicy),
      ],
    )
    return this.readNodeSettings(deviceId, defaults)
  }

  async ping(): Promise<void> {
    const result = await this.pool.query("SELECT to_regclass('device_telemetry') IS NOT NULL AND to_regclass('runtime_device_modes') IS NOT NULL AND to_regclass('node_settings') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='measurements' AND column_name='historical_only') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_telemetry' AND column_name='delivery_kind') AS ready")
    if (!result.rows[0]?.ready) throw new Error('Database migrations are required')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

let repository: PostgresRepository | null = null

export function getRepository(databaseUrl: string): PostgresRepository {
  repository ??= new PostgresRepository(databaseUrl)
  return repository
}
