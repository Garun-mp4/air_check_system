import {
  buildFeatureVector,
  InsufficientHistoryError,
  PREDICTION_HORIZON_MS,
  toMlPredictionPayload,
} from './features'
import type { AppConfig } from './config'
import { ControlService, type ControlRequest } from './control-service'
import {
  InvalidMlResponseError,
  MlServiceError,
  type MlPredictionResult,
  type Predictor,
} from './ml-client'
import { evaluateRecommendation } from './recommendation'
import type { Repository } from './repository'
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
  Prediction,
  Recommendation,
  PredictionStatus,
} from './types'

export class AirQualityService {
  constructor(
    private readonly repository: Repository,
    private readonly predictor: Predictor,
    private readonly config: AppConfig,
    private readonly controlService = new ControlService(repository, config),
  ) {}

  async ingest(input: MeasurementInput): Promise<IngestResult> {
    const measurement = await this.repository.createMeasurement(input)
    let prediction: Prediction | null = null
    let predictionStatus: PredictionStatus = 'insufficient_history'
    let predictionError: string | null = null

    try {
      const history = await this.repository.listMeasurements({
        from: new Date(
          measurement.timestamp.getTime() - 12 * 60 * 1000,
        ),
        to: measurement.timestamp,
        limit: this.config.mlHistoryLimit,
      })
      const features = buildFeatureVector(history, measurement)
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
      } else {
        throw error
      }
    }

    const recommendation = await this.repository.createRecommendation(
      evaluateRecommendation(
        measurement,
        prediction,
        {
          normal: this.config.co2NormalThreshold,
          critical: this.config.co2CriticalThreshold,
        },
      ),
    )
    try {
      await this.controlService.reconcile(measurement, prediction)
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
    if (!measurement) {
      return {
        measurement: null,
        prediction: null,
        recommendation: null,
      }
    }
    return {
      measurement,
      prediction: await this.repository.getLatestPrediction(),
      recommendation: await this.repository.getLatestRecommendation(),
    }
  }

  async latestPrediction(): Promise<Prediction | null> {
    return this.repository.getLatestPrediction()
  }

  async latestRecommendation(): Promise<Recommendation | null> {
    return this.repository.getLatestRecommendation()
  }

  async history(query: HistoryQuery): Promise<Measurement[]> {
    return this.repository.listMeasurements(query)
  }

  async controlsStatus(deviceId = this.config.deviceId): Promise<ControlStatus> {
    return this.controlService.status(deviceId)
  }

  async issueControl(request: ControlRequest): Promise<ControlCommandResult> {
    return this.controlService.issue(request)
  }

  async pendingControlCommands(
    deviceId = this.config.deviceId,
    limit = 20,
  ): Promise<ControlCommand[]> {
    return this.controlService.pendingCommands(deviceId, limit)
  }

  async reportControlState(input: DeviceStateReport): Promise<ControlStatus> {
    return this.controlService.report(input)
  }

  private async savePrediction(
    measurement: Measurement,
    result: MlPredictionResult,
  ): Promise<Prediction> {
    return this.repository.createPrediction({
      targetTime: new Date(
        measurement.timestamp.getTime() + PREDICTION_HORIZON_MS,
      ),
      predictedCo2: result.predictedCo2_15min,
      modelName: result.model,
      modelVersion: result.modelVersion,
    })
  }
}
