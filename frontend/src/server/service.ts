import { defaultOutdoorPolicy, validateOutdoorPolicy } from './outdoor-policy'
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
  constructor(
    private readonly repository: Repository,
    private readonly predictor: Predictor,
    private readonly config: AppConfig,
    private readonly controlService = new ControlService(repository, config),
  ) {}

  async ingest(input: MeasurementInput): Promise<IngestResult> {
    const settings = await this.nodeSettings()
    const controls = await this.repository.getControlState(this.config.deviceId)
    const reportFresh = controls.lastReportedAt && Date.now()-controls.lastReportedAt.getTime()<=this.config.deviceHeartbeatTimeoutMs && Date.now()-controls.lastReportedAt.getTime()>=-5000 && input.timestamp.getTime()-controls.lastReportedAt.getTime()>=-5000 && input.timestamp.getTime()-controls.lastReportedAt.getTime()<=this.config.deviceHeartbeatTimeoutMs
    const measurement = await this.repository.createMeasurement({...input,
      co2Limit:settings.co2CriticalThreshold,pm25Limit:settings.pm25ElevatedLimit,
      ventilationOn:reportFresh ? controls.reported.intakeOn||controls.reported.exhaustOn : null,
    })
    let prediction: Prediction | null = null
    let predictionStatus: PredictionStatus = 'insufficient_history'
    let predictionError: string | null = null
    let predictionErrorCode: string | null = null

    try {
      const history = await this.repository.listMeasurements({
        from: new Date(
          measurement.timestamp.getTime() - 12 * 60 * 1000,
        ),
        to: measurement.timestamp,
        limit: this.config.mlHistoryLimit,
      })
      const sourceHistory = history.filter(point => (point.dataSource ?? 'unknown') === (measurement.dataSource ?? 'unknown'))
      const features = buildFeatureVector(sourceHistory, measurement)
      const result = await this.predictor.predict(toMlPredictionPayload(features))
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
    const safety = await this.repository.assessOutdoorAir(this.config.deviceId, measurement, settings.outdoorPolicy ?? defaultOutdoorPolicy)
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
      ), measurementId: measurement.id },
    )
    try {
      await this.controlService.reconcile(measurement, prediction, safety)
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
    const measurement = await this.repository.getLatestMeasurement()
    const candidate = measurement ? await this.repository.getPredictionForMeasurement(measurement.id) : null
    const candidateRecommendation = measurement ? await this.repository.getRecommendationForMeasurement(measurement.id) : null
    const control = await this.controlService.status()
    const lastPrediction = candidate ? null : await this.repository.getLatestPrediction()
    const legacy = !!lastPrediction && lastPrediction.measurementId == null && !lastPrediction.sourceTimestamp
    const now = new Date()
    const age = measurement ? now.getTime() - measurement.timestamp.getTime() : null
    const freshness = age === null ? 'missing' : age < -5000 || age > this.config.deviceHeartbeatTimeoutMs ? 'stale' : 'fresh'
    const prediction = candidate && freshness === 'fresh' && candidate.targetTime > now ? candidate : null
    const recommendation = freshness === 'fresh' ? candidateRecommendation : null
    const status = candidate && !prediction ? 'stale' : prediction ? 'ready'
      : measurement?.predictionErrorCode === 'model_unavailable' ? 'model_untrained'
      : measurement?.predictionErrorCode === 'invalid_response' ? 'error'
      : measurement?.predictionStatus === 'unavailable' ? 'unavailable'
      : measurement?.predictionStatus === 'insufficient_history' ? 'insufficient_history'
      : measurement?.predictionStatus === 'ready' ? 'error' : legacy ? 'legacy' : 'pending'
    return {
      measurement, prediction, recommendation,
      diagnostics: { measurement: freshness, device: control.connectionStatus, prediction: status,
        predictionMessage: status === 'stale' ? 'Измерение или прогноз устарели; ожидается новая телеметрия' : measurement?.predictionError ?? (status === 'legacy' ? 'Старый прогноз не связан с текущим измерением' : null),
        measuredAt: measurement?.timestamp.toISOString() ?? null, assessedAt: now.toISOString() },
    }
  }

  async latestPrediction(): Promise<Prediction | null> {
    const measurement = await this.repository.getLatestMeasurement()
    if (!measurement) return null
    const age = Date.now() - measurement.timestamp.getTime()
    if (age < -5000 || age > this.config.deviceHeartbeatTimeoutMs) return null
    const prediction = await this.repository.getPredictionForMeasurement(measurement.id)
    return prediction && prediction.targetTime.getTime() > Date.now() ? prediction : null
  }

  async latestRecommendation(): Promise<Recommendation | null> {
    const measurement = await this.repository.getLatestMeasurement()
    return measurement && Date.now() - measurement.timestamp.getTime() >= -5000 && Date.now() - measurement.timestamp.getTime() <= this.config.deviceHeartbeatTimeoutMs ? this.repository.getRecommendationForMeasurement(measurement.id) : null
  }

  async history(query: HistoryQuery): Promise<Measurement[]> {
    return this.repository.listMeasurements(query)
  }

  async cleanupExpiredData(now = new Date()): Promise<RetentionCleanupResult> {
    const cutoff = new Date(
      now.getTime() - this.config.dataRetentionHours * 60 * 60 * 1000,
    )
    return this.repository.purgeExpiredData(cutoff)
  }

  async controlsStatus(deviceId = this.config.deviceId): Promise<ControlStatus> {
    return this.controlService.status(deviceId)
  }

  async nodeSettings(deviceId = this.config.deviceId): Promise<NodeSettings> {
    return this.repository.getNodeSettings(deviceId, getNodeSettingsDefaults(this.config))
  }

  async updateNodeSettings(
    deviceId: string,
    patch: NodeSettingsPatch,
  ): Promise<NodeSettings> {
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
    return this.controlService.issue(request)
  }

  async issueVentilation(request: VentilationRequest): Promise<ControlCommandResult> {
    return this.controlService.issueVentilation(request)
  }

  async pendingControlCommands(
    deviceId = this.config.deviceId,
    limit = 20,
  ): Promise<ControlCommand[]> {
    return this.controlService.pendingCommands(deviceId, limit)
  }

  async commandAction(deviceId: string, id: number, action: 'cancel' | 'retry'): Promise<ControlCommandResult> {
    return this.controlService.commandAction(deviceId, id, action)
  }

  async reportControlState(input: DeviceStateReport): Promise<ControlStatus> {
    return this.controlService.report(input)
  }

  private async savePrediction(
    measurement: Measurement,
    result: MlPredictionResult,
  ): Promise<Prediction> {
    return this.repository.createPrediction({
      measurementId: measurement.id,
      dataSource: measurement.dataSource,
      sourceTimestamp: measurement.timestamp,
      targetTime: new Date(
        measurement.timestamp.getTime() + PREDICTION_HORIZON_MS,
      ),
      predictedCo2: result.predictedCo2_15min,
      modelName: result.model,
      modelVersion: result.modelVersion,
    })
  }
}
