import type {
  ControlCommand,
  ControlStatus,
  DashboardResult,
  IngestResult,
  Measurement,
  NodeSettings,
  Prediction,
  Recommendation,
} from './types'

function serializeControlState(
  target: ControlCommand['target'],
  desiredState: boolean,
): string {
  if (target === 'window') {
    return desiredState ? 'open' : 'closed'
  }
  return desiredState ? 'on' : 'off'
}

export function serializeControlCommand(command: ControlCommand) {
  return {
    id: command.id,
    device_id: command.deviceId,
    target: command.target,
    state: serializeControlState(command.target, command.desiredState),
    desired_state: command.desiredState,
    source: command.source,
    reason: command.reason,
    batch_id: command.batchId,
    status: command.status,
    created_at: command.createdAt.toISOString(),
    applied_at: command.appliedAt?.toISOString() ?? null,
  }
}

export function serializeControlStatus(status: ControlStatus) {
  return {
    device_id: status.deviceId,
    connection: {
      status: status.connectionStatus,
      last_seen_at: status.lastReportedAt?.toISOString() ?? null,
    },
    reported: {
      exhaust_on: status.reported.exhaustOn,
      intake_on: status.reported.intakeOn,
      window_open: status.reported.windowOpen,
    },
    desired: {
      exhaust_on: status.desired.exhaustOn,
      intake_on: status.desired.intakeOn,
      window_open: status.desired.windowOpen,
    },
    window: {
      mode: status.windowMode,
      override_until: status.overrideUntil?.toISOString() ?? null,
      open_since: status.windowOpenSince?.toISOString() ?? null,
    },
    automation: status.automation,
    pending_commands: status.pendingCommands,
    last_command: status.lastCommand
      ? serializeControlCommand(status.lastCommand)
      : null,
    updated_at: status.updatedAt.toISOString(),
  }
}

export function serializeNodeSettings(settings: NodeSettings) {
  return {
    device_id: settings.deviceId,
    automation_enabled: settings.automationEnabled,
    auto_window_enabled: settings.autoWindowEnabled,
    manual_override_minutes: settings.manualOverrideMinutes,
    auto_ventilation_minimum_minutes: settings.autoVentilationMinimumMinutes,
    co2_normal_threshold: settings.co2NormalThreshold,
    co2_critical_threshold: settings.co2CriticalThreshold,
    pm25_good_limit: settings.pm25GoodLimit,
    pm25_elevated_limit: settings.pm25ElevatedLimit,
    alerts_enabled: settings.alertsEnabled,
    retention_hours: settings.retentionHours,
    updated_at: settings.updatedAt.toISOString(),
  }
}

export function serializeMeasurement(measurement: Measurement) {
  return {
    id: measurement.id,
    created_at: measurement.createdAt.toISOString(),
    timestamp: measurement.timestamp.toISOString(),
    indoor: {
      co2: measurement.indoor.co2,
      temperature: measurement.indoor.temperature,
      humidity: measurement.indoor.humidity,
      pm25: measurement.indoor.pm25,
    },
    outdoor: {
      temperature: measurement.outdoor.temperature,
      humidity: measurement.outdoor.humidity,
      pm25: measurement.outdoor.pm25,
    },
    window_open: measurement.windowOpen,
  }
}

export function serializePrediction(prediction: Prediction | null) {
  if (!prediction) {
    return null
  }
  return {
    id: prediction.id,
    created_at: prediction.createdAt.toISOString(),
    target_time: prediction.targetTime.toISOString(),
    predicted_co2_15min: prediction.predictedCo2,
    model_name: prediction.modelName,
    model_version: prediction.modelVersion,
  }
}

export function serializeRecommendation(recommendation: Recommendation | null) {
  if (!recommendation) {
    return null
  }
  return {
    id: recommendation.id,
    created_at: recommendation.createdAt.toISOString(),
    type: recommendation.type,
    message: recommendation.message,
    duration_minutes: recommendation.durationMinutes,
    reason: recommendation.reason,
  }
}

export function serializeDashboard(result: DashboardResult) {
  return {
    measurement: result.measurement
      ? serializeMeasurement(result.measurement)
      : null,
    prediction: serializePrediction(result.prediction),
    recommendation: serializeRecommendation(result.recommendation),
  }
}

export function serializeIngest(result: IngestResult) {
  return {
    id: result.measurement.id,
    ...serializeDashboard(result),
    prediction_status: result.predictionStatus,
    prediction_error: result.predictionError,
  }
}
