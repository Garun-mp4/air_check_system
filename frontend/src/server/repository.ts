import { Pool } from 'pg'

import type {
  ControlCommand,
  ControlCommandInput,
  ControlState,
  DeviceStateReport,
  HistoryQuery,
  Measurement,
  MeasurementInput,
  Prediction,
  PredictionInput,
  Recommendation,
  RecommendationDraft,
  WindowControlMode,
} from './types'

export interface Repository {
  createMeasurement(input: MeasurementInput): Promise<Measurement>
  getLatestMeasurement(): Promise<Measurement | null>
  listMeasurements(query: HistoryQuery): Promise<Measurement[]>
  createPrediction(input: PredictionInput): Promise<Prediction>
  getLatestPrediction(): Promise<Prediction | null>
  createRecommendation(input: RecommendationDraft): Promise<Recommendation>
  getLatestRecommendation(): Promise<Recommendation | null>
  getControlState(deviceId: string): Promise<ControlState>
  getLatestControlCommand(
    deviceId: string,
    target: ControlCommand['target'],
  ): Promise<ControlCommand | null>
  queueControlCommands(input: ControlCommandInput[]): Promise<ControlCommand[]>
  listPendingControlCommands(deviceId: string, limit: number): Promise<ControlCommand[]>
  reportControlState(input: DeviceStateReport): Promise<ControlState>
  setWindowControlMode(
    deviceId: string,
    mode: WindowControlMode,
    overrideUntil: Date | null,
  ): Promise<ControlState>
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

export class MemoryRepository implements Repository {
  private measurements: Measurement[] = []
  private predictions: Prediction[] = []
  private recommendations: Recommendation[] = []
  private controlStates = new Map<string, ControlState>()
  private controlCommands: ControlCommand[] = []
  private nextId = 1

  async createMeasurement(input: MeasurementInput): Promise<Measurement> {
    const measurement: Measurement = {
      ...input,
      id: this.nextId,
      createdAt: new Date(),
      indoor: { ...input.indoor },
      outdoor: { ...input.outdoor },
    }
    this.nextId += 1
    this.measurements.push(measurement)
    return measurement
  }

  async getLatestMeasurement(): Promise<Measurement | null> {
    return [...this.measurements].sort(sortByTimestamp).at(-1) ?? null
  }

  async listMeasurements(query: HistoryQuery): Promise<Measurement[]> {
    return this.measurements
      .filter((measurement) => {
        const timestamp = measurement.timestamp.getTime()
        return (
          (query.from === undefined || timestamp >= query.from.getTime()) &&
          (query.to === undefined || timestamp <= query.to.getTime())
        )
      })
      .sort(sortByTimestamp)
      .slice(-query.limit)
  }

  async createPrediction(input: PredictionInput): Promise<Prediction> {
    const prediction: Prediction = {
      ...input,
      id: this.nextId,
      createdAt: new Date(),
    }
    this.nextId += 1
    this.predictions.push(prediction)
    return prediction
  }

  async getLatestPrediction(): Promise<Prediction | null> {
    return [...this.predictions].sort(sortPredictions)[0] ?? null
  }

  async createRecommendation(input: RecommendationDraft): Promise<Recommendation> {
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

  async getControlState(deviceId: string): Promise<ControlState> {
    const state = this.ensureControlState(deviceId)
    const commands = this.controlCommands.filter(
      (command) => command.deviceId === deviceId,
    )
    state.pendingCommands = commands.filter(
      (command) => command.status === 'pending',
    ).length
    state.lastCommand = [...commands].sort(sortCommands)[0] ?? null
    return cloneControlState(state)
  }

  async getLatestControlCommand(
    deviceId: string,
    target: ControlCommand['target'],
  ): Promise<ControlCommand | null> {
    const command = [...this.controlCommands]
      .filter(
        (item) => item.deviceId === deviceId && item.target === target,
      )
      .sort(sortCommands)[0]
    return command ? { ...command } : null
  }

  async queueControlCommands(input: ControlCommandInput[]): Promise<ControlCommand[]> {
    if (input.length === 0) {
      return []
    }
    const created: ControlCommand[] = []
    for (const item of input) {
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
      const pendingForTarget = this.controlCommands.some(
        (command) =>
          command.deviceId === item.deviceId &&
          command.target === item.target &&
          command.status === 'pending' &&
          command.desiredState === item.desiredState,
      )
      if (
        currentDesired === item.desiredState &&
        (currentReported === item.desiredState || pendingForTarget)
      ) {
        continue
      }
      const command: ControlCommand = {
        ...item,
        id: this.nextId,
        status: 'pending',
        createdAt: new Date(),
        appliedAt: null,
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
    const state = this.ensureControlState(input.deviceId)
    const previouslyOpen = state.reported.windowOpen
    state.reported = { ...input.reported }
    state.lastReportedAt = new Date(input.timestamp)
    state.windowOpenSince = input.reported.windowOpen
      ? state.windowOpenSince ?? new Date(input.timestamp)
      : null
    if (!previouslyOpen && input.reported.windowOpen) {
      state.windowOpenSince = new Date(input.timestamp)
    }
    for (const commandId of input.appliedCommandIds) {
      const command = this.controlCommands.find(
        (item) =>
          item.id === commandId &&
          item.deviceId === input.deviceId &&
          item.status === 'pending' &&
          ((item.target === 'exhaust' &&
            item.desiredState === input.reported.exhaustOn) ||
            (item.target === 'intake' &&
              item.desiredState === input.reported.intakeOn) ||
            (item.target === 'window' &&
              item.desiredState === input.reported.windowOpen)),
      )
      if (command) {
        command.status = 'applied'
        command.appliedAt = new Date()
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

  async ping(): Promise<void> {}

  async close(): Promise<void> {}
}

interface MeasurementRow {
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
  id: number | string
  created_at: Date | string
  target_time: Date | string
  predicted_co2: number | string
  model_name: string
  model_version: string
}

interface RecommendationRow {
  id: number | string
  created_at: Date | string
  type: Recommendation['type']
  message: string
  duration_minutes: number | string | null
  reason: string
}

interface ControlStateRow {
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
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function asNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value)
}

function mapMeasurement(row: MeasurementRow): Measurement {
  return {
    id: Number(row.id),
    createdAt: asDate(row.created_at),
    timestamp: asDate(row.measurement_timestamp),
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
    targetTime: asDate(row.target_time),
    predictedCo2: asNumber(row.predicted_co2),
    modelName: row.model_name,
    modelVersion: row.model_version,
  }
}

function mapRecommendation(row: RecommendationRow): Recommendation {
  return {
    id: Number(row.id),
    createdAt: asDate(row.created_at),
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
  }
}

function mapControlState(
  row: ControlStateRow,
  pendingCommands: number,
  lastCommand: ControlCommand | null,
): ControlState {
  return {
    deviceId: row.device_id,
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

  async createMeasurement(input: MeasurementInput): Promise<Measurement> {
    const result = await this.pool.query<MeasurementRow>(
      'INSERT INTO measurements ("timestamp", indoor_co2, indoor_temperature, indoor_humidity, ' +
        'indoor_pm25, outdoor_temperature, outdoor_humidity, outdoor_pm25, window_open) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ' +
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
      ],
    )
    return mapMeasurement(result.rows[0])
  }

  async getLatestMeasurement(): Promise<Measurement | null> {
    const result = await this.pool.query<MeasurementRow>(
      'SELECT ' +
        measurementColumns +
        ' FROM measurements ORDER BY "timestamp" DESC, id DESC LIMIT 1',
    )
    return result.rows[0] ? mapMeasurement(result.rows[0]) : null
  }

  async listMeasurements(query: HistoryQuery): Promise<Measurement[]> {
    const conditions: string[] = []
    const values: unknown[] = []
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
      'INSERT INTO predictions (target_time, predicted_co2, model_name, model_version) ' +
        'VALUES ($1, $2, $3, $4) RETURNING id, created_at, target_time, predicted_co2, model_name, model_version',
      [input.targetTime, input.predictedCo2, input.modelName, input.modelVersion],
    )
    return mapPrediction(result.rows[0])
  }

  async getLatestPrediction(): Promise<Prediction | null> {
    const result = await this.pool.query<PredictionRow>(
      'SELECT id, created_at, target_time, predicted_co2, model_name, model_version ' +
        'FROM predictions ORDER BY target_time DESC, created_at DESC, id DESC LIMIT 1',
    )
    return result.rows[0] ? mapPrediction(result.rows[0]) : null
  }

  async createRecommendation(input: RecommendationDraft): Promise<Recommendation> {
    const result = await this.pool.query<RecommendationRow>(
      'INSERT INTO recommendations (type, message, duration_minutes, reason) ' +
        'VALUES ($1, $2, $3, $4) RETURNING id, created_at, type, message, duration_minutes, reason',
      [input.type, input.message, input.durationMinutes, input.reason],
    )
    return mapRecommendation(result.rows[0])
  }

  async getLatestRecommendation(): Promise<Recommendation | null> {
    const result = await this.pool.query<RecommendationRow>(
      'SELECT id, created_at, type, message, duration_minutes, reason ' +
        'FROM recommendations ORDER BY created_at DESC, id DESC LIMIT 1',
    )
    return result.rows[0] ? mapRecommendation(result.rows[0]) : null
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
        'window_open_since, last_reported_at, updated_at FROM actuator_states ' +
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
      'SELECT id, device_id, target, desired_state, source, reason, batch_id, status, created_at, applied_at ' +
        'FROM actuator_commands WHERE device_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
      [deviceId],
    )
    return mapControlState(
      stateResult.rows[0],
      Number(pendingResult.rows[0]?.count ?? 0),
      lastCommandResult.rows[0]
        ? mapControlCommand(lastCommandResult.rows[0])
        : null,
    )
  }

  async getControlState(deviceId: string): Promise<ControlState> {
    await this.ensureControlState(deviceId)
    return this.readControlState(deviceId)
  }

  async getLatestControlCommand(
    deviceId: string,
    target: ControlCommand['target'],
  ): Promise<ControlCommand | null> {
    const result = await this.pool.query<ControlCommandRow>(
      'SELECT id, device_id, target, desired_state, source, reason, batch_id, status, created_at, applied_at ' +
        'FROM actuator_commands WHERE device_id = $1 AND target = $2 ' +
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
        const pendingForTarget = pendingResult.rows.some(
          (row) =>
            row.target === item.target &&
            row.desired_state === item.desiredState,
        )
        if (
          currentDesired === item.desiredState &&
          (currentReported === item.desiredState || pendingForTarget)
        ) {
          continue
        }
        const result = await client.query<ControlCommandRow>(
          'INSERT INTO actuator_commands (device_id, target, desired_state, source, reason, batch_id) ' +
            'VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, device_id, target, desired_state, source, reason, batch_id, status, created_at, applied_at',
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
    const result = await this.pool.query<ControlCommandRow>(
      "SELECT id, device_id, target, desired_state, source, reason, batch_id, status, created_at, applied_at FROM actuator_commands WHERE device_id = $1 AND status = 'pending' ORDER BY id ASC LIMIT $2",
      [deviceId, Math.floor(limit)],
    )
    return result.rows.map(mapControlCommand)
  }

  async reportControlState(input: DeviceStateReport): Promise<ControlState> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'INSERT INTO actuator_states (device_id, exhaust_on, intake_on, window_open, desired_exhaust_on, desired_intake_on, desired_window_open, last_reported_at, window_open_since) ' +
          'VALUES ($1, $2::boolean, $3::boolean, $4::boolean, $2::boolean, $3::boolean, $4::boolean, $5::timestamptz, CASE WHEN $4::boolean THEN $5::timestamptz ELSE NULL::timestamptz END) ' +
          'ON CONFLICT (device_id) DO UPDATE SET exhaust_on = EXCLUDED.exhaust_on, intake_on = EXCLUDED.intake_on, ' +
          'window_open = EXCLUDED.window_open, window_open_since = CASE WHEN EXCLUDED.window_open THEN COALESCE(actuator_states.window_open_since, EXCLUDED.last_reported_at) ELSE NULL END, ' +
          'last_reported_at = EXCLUDED.last_reported_at, updated_at = NOW()',
        [
          input.deviceId,
          input.reported.exhaustOn,
          input.reported.intakeOn,
          input.reported.windowOpen,
          input.timestamp,
        ],
      )
      if (input.appliedCommandIds.length > 0) {
        await client.query(
          "UPDATE actuator_commands SET status = 'applied', applied_at = NOW() WHERE device_id = $1 AND status = 'pending' AND id = ANY($2::bigint[]) AND ((target = 'exhaust' AND desired_state = $3::boolean) OR (target = 'intake' AND desired_state = $4::boolean) OR (target = 'window' AND desired_state = $5::boolean))",
          [
            input.deviceId,
            input.appliedCommandIds,
            input.reported.exhaustOn,
            input.reported.intakeOn,
            input.reported.windowOpen,
          ],
        )
      }
      await client.query('COMMIT')
      return this.readControlState(input.deviceId)
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

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1')
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
