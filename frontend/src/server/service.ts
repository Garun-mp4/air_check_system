import { assessOutdoor, defaultOutdoorPolicy, validateOutdoorPolicy } from './outdoor-policy'
import { IngestConflictError, measurementContentHash, measurementIdentity } from './ingest-identity'
import { assessSensor } from '../lib/telemetry'
import type { TelemetryStore } from './telemetry-store'
import {
  buildFeatureVector,
  InsufficientHistoryError,
  PREDICTION_HORIZON_MS,
  toMlPredictionPayload,
} from './features'
import type { AppConfig } from './config'
import {
  ControlService,
  type ControlRequest,
  type VentilationRequest,
} from './control-service'
import {
  InvalidMlResponseError,
  MlServiceError,
  type MlPredictionResult,
  type Predictor,
} from './ml-client'
import { evaluateRecommendation } from './recommendation'
import type { Repository } from './repository'
import { getNodeSettingsDefaults } from './settings'
import { ValidationError } from './validation'
import type {
  ControlCommand,
  ControlCommandResult,
  ControlStatus,
  DeviceStateReport,
  DashboardResult,
  DashboardDiagnostics,
  HistoryQuery,
  IngestResult,
  Measurement,
  MeasurementInput,
  NodeSettings,
  NodeSettingsPatch,
  Prediction,
  Recommendation,
  PredictionStatus,
  RetentionCleanupResult,
} from './types'

export class AirQualityService {
  private readonly inFlight = new Map<string, { hash: string; result: Promise<IngestResult> }>()
  private modeReady: Promise<void> | null = null
  constructor(
    private readonly repository: Repository,
    private readonly predictor: Predictor,
    private readonly config: AppConfig,
    private readonly controlService = new ControlService(repository, config),
    private readonly telemetryStore?: TelemetryStore,
  ) {}

  readyForRuntime(): Promise<void> {
    if (!this.modeReady) this.modeReady = (this.config.dataSource ? this.repository.activateMode(this.config.deviceId, this.config.dataSource) : Promise.resolve()).catch(error => { this.modeReady = null; throw error })
    return this.modeReady
  }

  private assertActiveDevice(deviceId: string): void {
    if (this.config.dataSource && deviceId !== this.config.deviceId) throw new ValidationError([{ field: 'device_id', message: 'устройство не относится к установке' }])
  }

  async ingest(input: MeasurementInput): Promise<IngestResult> {
    await this.readyForRuntime()
    if (this.config.dataSource && input.dataSource && input.dataSource !== this.config.dataSource) throw new ValidationError([{ field: 'data_source', message: 'источник не соответствует режиму установки' }])
    if (this.config.dataSource) input = { ...input, dataSource: this.config.dataSource }
    const key = measurementIdentity(input)
    const hash = measurementContentHash(input)
    const existing = this.inFlight.get(key)
    if (existing) {
      if (existing.hash !== hash) throw new IngestConflictError()
      return existing.result
    }
    const pending = this.ingestOnce({ ...input, ingestKey: key })
    this.inFlight.set(key, { hash, result: pending })
    try { return await pending }
    finally { if (this.inFlight.get(key)?.result === pending) this.inFlight.delete(key) }
  }

  private async ingestOnce(input: MeasurementInput): Promise<IngestResult> {
    const settings = await this.nodeSettings()
    const controls = await this.repository.getControlState(this.config.deviceId)
    const reportFresh = controls.lastReportedAt && Date.now()-controls.lastReportedAt.getTime()<=this.config.deviceHeartbeatTimeoutMs && Date.now()-controls.lastReportedAt.getTime()>=-5000 && input.timestamp.getTime()-controls.lastReportedAt.getTime()>=-5000 && input.timestamp.getTime()-controls.lastReportedAt.getTime()<=this.config.deviceHeartbeatTimeoutMs
    const measurement = await this.repository.createMeasurement({...input,
      co2Limit:settings.co2CriticalThreshold,pm25Limit:settings.pm25ElevatedLimit,
      ventilationOn:reportFresh ? controls.reported.intakeOn||controls.reported.exhaustOn : null,
    })
    if (measurement.historicalOnly) {
      const reason = 'Архивное измерение сохранено для истории и обучения; текущий прогноз не рассчитывается'
      await this.repository.setPredictionOutcome(measurement.id, 'unavailable', reason, 'historical')
      return { measurement, prediction: null, recommendation: null, predictionStatus: 'unavailable', predictionError: reason }
    }
    let prediction: Prediction | null = await this.repository.getPredictionForMeasurement(measurement.id)
    const existingRecommendation = await this.repository.getRecommendationForMeasurement(measurement.id)
    if (existingRecommendation && measurement.predictionStatus && measurement.predictionStatus !== 'pending') {
      return { measurement, prediction, recommendation: existingRecommendation, predictionStatus: measurement.predictionStatus, predictionError: measurement.predictionError ?? null }
    }
    let predictionStatus: PredictionStatus = prediction ? 'ready' : 'insufficient_history'
    let predictionError: string | null = null
    let predictionErrorCode: string | null = null

    if (!prediction) try {
      const history = await this.repository.listMeasurements({
        dataSource: measurement.dataSource ?? 'unknown',
        from: new Date(
          measurement.timestamp.getTime() - 12 * 60 * 1000,
        ),
        to: measurement.timestamp,
        limit: this.config.mlHistoryLimit,
      })
      const sourceHistory = history.filter(point => (point.dataSource ?? 'unknown') === (measurement.dataSource ?? 'unknown'))
      const features = buildFeatureVector(sourceHistory, measurement)
      const payload = toMlPredictionPayload(features)
      if (this.config.dataSource) Object.assign(payload, { data_source: measurement.dataSource ?? 'unknown', schema_version: 1, horizon_minutes: this.config.mlForecastHorizonMinutes ?? 15 })
      const result = await this.predictor.predict(payload)
      prediction = await this.savePrediction(measurement, result)
      predictionStatus = 'ready'
    } catch (error) {
      if (
        error instanceof InsufficientHistoryError ||
        error instanceof MlServiceError ||
        error instanceof InvalidMlResponseError
      ) {
        predictionStatus =
          error instanceof InsufficientHistoryError
            ? 'insufficient_history'
            : 'unavailable'
        predictionError = error.message
        predictionErrorCode = error instanceof MlServiceError ? error.code ?? 'service_error' : error instanceof InvalidMlResponseError ? 'invalid_response' : 'insufficient_history'
      } else {
        throw error
      }
    }

    await this.repository.setPredictionOutcome(measurement.id, predictionStatus, predictionError, predictionErrorCode)
    measurement.predictionStatus = predictionStatus; measurement.predictionError = predictionError; measurement.predictionErrorCode = predictionErrorCode
    const latest = await this.repository.getLatestMeasurement(this.config.dataSource)
    const current = latest?.id === measurement.id && Date.now() - measurement.timestamp.getTime() <= this.config.deviceHeartbeatTimeoutMs
    const policy = settings.outdoorPolicy ?? defaultOutdoorPolicy
    const safety = current ? await this.repository.assessOutdoorAir(this.config.deviceId, measurement, policy) : assessOutdoor(measurement, policy)
    const recommendation = await this.repository.createRecommendation(
      { ...evaluateRecommendation(
        measurement,
        prediction,
        {
          outdoorSafety: safety,
          normal: settings.co2NormalThreshold,
          critical: settings.co2CriticalThreshold,
          pm25Good: settings.pm25GoodLimit,
          pm25Elevated: settings.pm25ElevatedLimit,
          alertsEnabled: settings.alertsEnabled,
        },
      ), measurementId: measurement.id, ingestKey: measurement.ingestKey + ':recommendation', forecastUsed: prediction !== null },
    )
    try {
      if (current) await this.controlService.reconcile(measurement, prediction, safety)
    } catch (error) {
      console.error('automatic control reconciliation failed', error)
    }
    return {
      measurement,
      prediction,
      recommendation,
      predictionStatus,
      predictionError,
    }
  }

  async latest(): Promise<DashboardResult> {
    await this.readyForRuntime()
    const measurement = await this.repository.getLatestMeasurement(this.config.dataSource)
    const candidate = measurement ? await this.repository.getPredictionForMeasurement(measurement.id) : null
    const candidateRecommendation = measurement ? await this.repository.getRecommendationForMeasurement(measurement.id) : null
    const control = await this.controlService.status()
    const lastPrediction = candidate ? null : await this.repository.getLatestPrediction(this.config.dataSource)
    const legacy = !!lastPrediction && lastPrediction.measurementId == null && !lastPrediction.sourceTimestamp
    const now = new Date()
    const age = measurement ? now.getTime() - measurement.timestamp.getTime() : null
    let freshness: DashboardDiagnostics['measurement'] = age === null ? 'missing' : age < -5000 || age > this.config.deviceHeartbeatTimeoutMs ? 'stale' : 'fresh'
    let prediction = candidate && freshness === 'fresh' && candidate.targetTime > now ? candidate : null
    let recommendation = freshness === 'fresh' ? candidateRecommendation : null
    let status: DashboardDiagnostics['prediction'] = candidate && !prediction ? 'stale' : prediction ? 'ready'
      : measurement?.predictionErrorCode === 'model_unavailable' ? 'model_untrained'
      : measurement?.predictionErrorCode === 'invalid_response' ? 'error'
      : measurement?.predictionStatus === 'unavailable' ? 'unavailable'
      : measurement?.predictionStatus === 'insufficient_history' ? 'insufficient_history'
      : measurement?.predictionStatus === 'ready' ? 'error' : legacy ? 'legacy' : 'pending'
    const telemetry = this.telemetryStore ? await this.telemetryStore.latest(this.config.deviceId, this.config.dataSource ?? 'simulator') : undefined
    let message = status === 'stale' ? 'Измерение или прогноз устарели; ожидается новая телеметрия' : measurement?.predictionError ?? (status === 'legacy' ? 'Старый прогноз не связан с текущим измерением' : null)
    if (telemetry) {
      const frame = telemetry.frame
      const usable = frame.sensors.filter(sensor => assessSensor(sensor, now.getTime(), frame.controller.clock_synced).usable).length
      freshness = usable === 4 ? 'fresh' : usable > 0 ? 'partial' : 'stale'
      const key = `v2:${frame.data_source}:${frame.device_id}:${frame.boot_id}:${frame.sequence}`
      if (measurement?.ingestKey !== key || usable < 4) {
        prediction = null; recommendation = null; status = 'unavailable'
        message = usable < 4 ? 'Прогноз ждёт достоверных данных всех необходимых каналов' : 'Прогноз ждёт подтверждённого положения окна и полного набора признаков'
      }
    }
    return {
      ...(this.telemetryStore ? { telemetry: telemetry ?? null } : {}),
      measurement, prediction, recommendation,
      diagnostics: { measurement: freshness, device: control.connectionStatus, prediction: status,
        predictionMessage: message,
        measuredAt: telemetry ? telemetry.frame.sampled_at : measurement?.timestamp.toISOString() ?? null, assessedAt: now.toISOString() },
    }
  }

  async latestPrediction(): Promise<Prediction | null> {
    return (await this.latest()).prediction
  }

  async latestRecommendation(): Promise<Recommendation | null> {
    return (await this.latest()).recommendation
  }

  async history(query: HistoryQuery): Promise<Measurement[]> {
    await this.readyForRuntime()
    return this.repository.listMeasurements({ ...query, ...(this.config.dataSource ? { dataSource: this.config.dataSource } : {}) })
  }

  async cleanupExpiredData(now = new Date()): Promise<RetentionCleanupResult> {
    await this.readyForRuntime()
    const cutoff = new Date(
      now.getTime() - this.config.dataRetentionHours * 60 * 60 * 1000,
    )
    return this.repository.purgeExpiredData(cutoff)
  }

  async controlsStatus(deviceId = this.config.deviceId): Promise<ControlStatus> {
    await this.readyForRuntime()
    this.assertActiveDevice(deviceId)
    return this.controlService.status(deviceId)
  }

  async nodeSettings(deviceId = this.config.deviceId): Promise<NodeSettings> {
    await this.readyForRuntime()
    this.assertActiveDevice(deviceId)
    return this.repository.getNodeSettings(deviceId, getNodeSettingsDefaults(this.config))
  }

  async updateNodeSettings(
    deviceId: string,
    patch: NodeSettingsPatch,
  ): Promise<NodeSettings> {
    await this.readyForRuntime()
    this.assertActiveDevice(deviceId)
    const current = await this.nodeSettings(deviceId)
    const next = { ...current, ...patch }
    if (patch.outdoorPolicy) {
      try { validateOutdoorPolicy(patch.outdoorPolicy) }
      catch (e) { throw new ValidationError([{ field: 'outdoor_policy', message: e instanceof Error ? e.message : 'Недопустимые правила' }]) }
    }
    const numericRules: Array<[
      keyof NodeSettings,
      string,
      number,
      number,
      boolean,
    ]> = [
      ['manualOverrideMinutes', 'manual_override_minutes', 1, 240, true],
      ['autoVentilationMinimumMinutes', 'auto_ventilation_minimum_minutes', 1, 120, true],
      ['co2NormalThreshold', 'co2_normal_threshold', 250, 10000, false],
      ['co2CriticalThreshold', 'co2_critical_threshold', 250, 10000, false],
      ['pm25GoodLimit', 'pm25_good_limit', 0, 1000, false],
      ['pm25ElevatedLimit', 'pm25_elevated_limit', 0, 1000, false],
    ]
    for (const [key, field, minimum, maximum, integer] of numericRules) {
      const value = next[key]
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < minimum ||
        value > maximum ||
        (integer && !Number.isInteger(value))
      ) {
        throw new ValidationError([
          {
            field,
            message: integer
              ? 'должно быть целым числом в диапазоне ' + minimum + '–' + maximum
              : 'должно быть в диапазоне ' + minimum + '–' + maximum,
          },
        ])
      }
    }
    if (next.co2CriticalThreshold <= next.co2NormalThreshold) {
      throw new ValidationError([
        {
          field: 'co2_critical_threshold',
          message: 'должен быть выше комфортного порога CO₂',
        },
      ])
    }
    if (next.pm25ElevatedLimit <= next.pm25GoodLimit) {
      throw new ValidationError([
        {
          field: 'pm25_elevated_limit',
          message: 'должен быть выше нормального порога PM2.5',
        },
      ])
    }
    return this.repository.updateNodeSettings(
      deviceId,
      patch,
      getNodeSettingsDefaults(this.config),
    )
  }

  async issueControl(request: ControlRequest): Promise<ControlCommandResult> {
    await this.readyForRuntime()
    this.assertActiveDevice(request.deviceId)
    return this.controlService.issue(request)
  }

  async issueVentilation(request: VentilationRequest): Promise<ControlCommandResult> {
    await this.readyForRuntime()
    this.assertActiveDevice(request.deviceId)
    return this.controlService.issueVentilation(request)
  }

  async pendingControlCommands(
    deviceId = this.config.deviceId,
    limit = 20,
  ): Promise<ControlCommand[]> {
    await this.readyForRuntime()
    this.assertActiveDevice(deviceId)
    return this.controlService.pendingCommands(deviceId, limit)
  }

  async commandAction(deviceId: string, id: number, action: 'cancel' | 'retry'): Promise<ControlCommandResult> {
    await this.readyForRuntime()
    this.assertActiveDevice(deviceId)
    return this.controlService.commandAction(deviceId, id, action)
  }

  async reportControlState(input: DeviceStateReport): Promise<ControlStatus> {
    await this.readyForRuntime()
    this.assertActiveDevice(input.deviceId)
    return this.controlService.report(input)
  }

  private async savePrediction(
    measurement: Measurement,
    result: MlPredictionResult,
  ): Promise<Prediction> {
    return this.repository.createPrediction({
      ingestKey: measurement.ingestKey ? measurement.ingestKey + ':prediction' : undefined,
      measurementId: measurement.id,
      dataSource: measurement.dataSource,
      sourceTimestamp: measurement.timestamp,
      targetTime: new Date(
        measurement.timestamp.getTime() + (result.horizonMinutes ? result.horizonMinutes * 60000 : PREDICTION_HORIZON_MS),
      ),
      predictedCo2: result.predictedCo2_15min,
      modelName: result.model,
      modelVersion: result.modelVersion,
    })
  }
}
