import { randomUUID } from 'node:crypto'

import type { AppConfig } from './config'
import type { Repository } from './repository'
import type {
  ControlAction,
  ControlCommand,
  ControlCommandInput,
  ControlCommandResult,
  ControlStatus,
  DeviceStateReport,
  DeviceConnectionStatus,
  Measurement,
  Prediction,
} from './types'

export interface ControlRequest {
  deviceId: string
  target: 'exhaust' | 'intake' | 'window'
  action: ControlAction
}

export type AutomationStatus =
  | 'ready'
  | 'ventilating'
  | 'manual_override'
  | 'waiting_for_device'
  | 'disabled'

function actionToState(request: ControlRequest): boolean | null {
  if (request.action === 'auto') {
    return null
  }
  if (request.target === 'window') {
    return request.action === 'open'
  }
  return request.action === 'on'
}

function commandLabel(target: ControlRequest['target'], state: boolean): string {
  if (target === 'window') {
    return state ? 'открыть окно' : 'закрыть окно'
  }
  if (target === 'exhaust') {
    return state ? 'включить вытяжку' : 'выключить вытяжку'
  }
  return state ? 'включить приток' : 'выключить приток'
}

function connectionStatus(
  lastReportedAt: Date | null,
  heartbeatTimeoutMs: number,
  now: Date,
): DeviceConnectionStatus {
  if (!lastReportedAt) {
    return 'offline'
  }
  const elapsed = now.getTime() - lastReportedAt.getTime()
  if (elapsed <= heartbeatTimeoutMs) {
    return 'online'
  }
  if (elapsed <= heartbeatTimeoutMs * 3) {
    return 'stale'
  }
  return 'offline'
}

function withAutomationSummary(
  status: Omit<ControlStatus, 'automation'>,
  config: AppConfig,
): ControlStatus {
  let automationStatus: AutomationStatus
  let message: string
  if (!config.automationEnabled) {
    automationStatus = 'disabled'
    message = 'Автоматическое управление отключено в конфигурации.'
  } else if (
    status.windowMode === 'manual' &&
    status.overrideUntil !== null &&
    status.overrideUntil.getTime() > Date.now()
  ) {
    automationStatus = 'manual_override'
    message = 'Окно оставлено под ручным контролем до ' +
      status.overrideUntil.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      }) +
      '.'
  } else if (
    status.pendingCommands > 0 ||
    status.connectionStatus !== 'online' ||
    status.reported.exhaustOn !== status.desired.exhaustOn ||
    status.reported.intakeOn !== status.desired.intakeOn ||
    status.reported.windowOpen !== status.desired.windowOpen
  ) {
    automationStatus = 'waiting_for_device'
    message =
      status.pendingCommands > 0
        ? 'Команда ожидает подтверждения локального узла.'
        : status.reported.exhaustOn !== status.desired.exhaustOn ||
            status.reported.intakeOn !== status.desired.intakeOn ||
            status.reported.windowOpen !== status.desired.windowOpen
          ? 'Фактическое состояние отличается от желаемого, ожидается синхронизация.'
        : 'Ожидание отчёта от локального узла.'
  } else if (status.reported.windowOpen || status.desired.windowOpen) {
    automationStatus = 'ventilating'
    message = 'Контур проветривания активен.'
  } else {
    automationStatus = 'ready'
    message = 'Автоматика готова открыть окно при необходимости.'
  }
  return {
    ...status,
    automation: {
      enabled: config.automationEnabled,
      status: automationStatus,
      message,
    },
  }
}

function predictedValue(prediction: Prediction | null): number | null {
  return prediction?.predictedCo2 ?? null
}

export class ControlService {
  constructor(
    private readonly repository: Repository,
    private readonly config: AppConfig,
  ) {}

  async status(deviceId = this.config.deviceId): Promise<ControlStatus> {
    let state = await this.repository.getControlState(deviceId)
    if (
      state.windowMode === 'manual' &&
      state.overrideUntil !== null &&
      state.overrideUntil.getTime() <= Date.now()
    ) {
      state = await this.repository.setWindowControlMode(deviceId, 'auto', null)
    }
    const current = new Date()
    return withAutomationSummary(
      {
        ...state,
        connectionStatus: connectionStatus(
          state.lastReportedAt,
          this.config.deviceHeartbeatTimeoutMs,
          current,
        ),
      },
      this.config,
    )
  }

  async pendingCommands(deviceId = this.config.deviceId, limit = 20): Promise<ControlCommand[]> {
    return this.repository.listPendingControlCommands(deviceId, limit)
  }

  async issue(request: ControlRequest): Promise<ControlCommandResult> {
    if (request.target === 'window' && request.action === 'auto') {
      await this.repository.setWindowControlMode(request.deviceId, 'auto', null)
      return { commands: [], status: await this.status(request.deviceId) }
    }

    const desiredState = actionToState(request)
    if (desiredState === null) {
      throw new Error('Недопустимое действие управления')
    }

    if (request.target === 'window') {
      await this.repository.setWindowControlMode(
        request.deviceId,
        'manual',
        new Date(Date.now() + this.config.windowManualOverrideMinutes * 60_000),
      )
    }

    const input: ControlCommandInput = {
      deviceId: request.deviceId,
      target: request.target,
      desiredState,
      source: 'manual',
      reason: 'Ручная команда: ' + commandLabel(request.target, desiredState) + '.',
      batchId: randomUUID(),
    }
    const commands = await this.repository.queueControlCommands([input])
    return { commands, status: await this.status(request.deviceId) }
  }

  async report(input: DeviceStateReport): Promise<ControlStatus> {
    return this.statusFromState(await this.repository.reportControlState(input))
  }

  async reconcile(
    measurement: Measurement,
    prediction: Prediction | null,
  ): Promise<ControlCommand[]> {
    if (!this.config.automationEnabled) {
      return []
    }

    let state = await this.repository.getControlState(this.config.deviceId)
    if (
      state.windowMode === 'manual' &&
      state.overrideUntil !== null &&
      state.overrideUntil.getTime() <= Date.now()
    ) {
      state = await this.repository.setWindowControlMode(
        this.config.deviceId,
        'auto',
        null,
      )
    }
    if (state.windowMode === 'manual') {
      return []
    }

    const currentCo2 = measurement.indoor.co2
    const predictedCo2 = predictedValue(prediction)
    const critical =
      currentCo2 >= this.config.co2CriticalThreshold ||
      (predictedCo2 !== null && predictedCo2 >= this.config.co2CriticalThreshold)
    const currentlyOpen = state.reported.windowOpen || measurement.windowOpen
    const shouldSupportOpenWindow =
      currentlyOpen && currentCo2 >= this.config.co2NormalThreshold
    const commandPlans: Array<
      Pick<ControlCommandInput, 'target' | 'desiredState' | 'reason'>
    > = []
    const addPlan = (
      target: ControlCommandInput['target'],
      desiredState: boolean,
      reason: string,
    ) => {
      commandPlans.push({ target, desiredState, reason })
    }
    const shouldStopAutomaticFan = async (
      target: 'exhaust' | 'intake',
    ): Promise<boolean> => {
      const active =
        target === 'exhaust'
          ? state.desired.exhaustOn || state.reported.exhaustOn
          : state.desired.intakeOn || state.reported.intakeOn
      if (!active) {
        return false
      }
      const latestCommand = await this.repository.getLatestControlCommand(
        this.config.deviceId,
        target,
      )
      return latestCommand?.source === 'automatic' && latestCommand.desiredState
    }

    if (critical) {
      const reason =
        'Автоматика: CO₂ достиг критического порога или прогнозирует его через 15 минут.'
      if (!state.desired.windowOpen || !state.reported.windowOpen) {
        commandPlans.push({ target: 'window', desiredState: true, reason })
      }
      if (!state.desired.exhaustOn || !state.reported.exhaustOn) {
        commandPlans.push({ target: 'exhaust', desiredState: true, reason })
      }
      if (!state.desired.intakeOn || !state.reported.intakeOn) {
        commandPlans.push({ target: 'intake', desiredState: true, reason })
      }
    } else if (shouldSupportOpenWindow) {
      const reason =
        'Автоматика: окно открыто, поэтому оба воздушных контура поддерживают проветривание.'
      if (!state.desired.exhaustOn || !state.reported.exhaustOn) {
        commandPlans.push({ target: 'exhaust', desiredState: true, reason })
      }
      if (!state.desired.intakeOn || !state.reported.intakeOn) {
        commandPlans.push({ target: 'intake', desiredState: true, reason })
      }
    } else {
      const [automaticExhaustOn, automaticIntakeOn] = await Promise.all([
        shouldStopAutomaticFan('exhaust'),
        shouldStopAutomaticFan('intake'),
      ])

      if (
        currentCo2 < this.config.co2NormalThreshold &&
        (predictedCo2 === null || predictedCo2 < this.config.co2NormalThreshold) &&
        (state.desired.windowOpen || state.reported.windowOpen) &&
        state.windowOpenSince !== null &&
        Date.now() - state.windowOpenSince.getTime() >=
          this.config.autoVentilationMinimumMinutes * 60_000
      ) {
        const reason =
          'Автоматика: CO₂ вернулся в комфортную зону после минимального времени проветривания.'
        if (state.desired.windowOpen || state.reported.windowOpen) {
          addPlan('window', false, reason)
        }
        if (automaticExhaustOn) {
          addPlan('exhaust', false, reason)
        }
        if (automaticIntakeOn) {
          addPlan('intake', false, reason)
        }
      } else if (
        currentCo2 < this.config.co2NormalThreshold &&
        (predictedCo2 === null || predictedCo2 < this.config.co2NormalThreshold) &&
        !state.desired.windowOpen &&
        !state.reported.windowOpen
      ) {
        const reason =
          'Автоматика: поддержание выключенного воздушного контура после восстановления CO₂.'
        if (automaticExhaustOn) {
          addPlan('exhaust', false, reason)
        }
        if (automaticIntakeOn) {
          addPlan('intake', false, reason)
        }
      }
    }

    if (commandPlans.length === 0) {
      return []
    }
    const batchId = randomUUID()
    return this.repository.queueControlCommands(
      commandPlans.map((plan) => ({
        ...plan,
        deviceId: this.config.deviceId,
        source: 'automatic',
        batchId,
      })),
    )
  }

  private async statusFromState(state: Awaited<ReturnType<Repository['getControlState']>>): Promise<ControlStatus> {
    return withAutomationSummary(
      {
        ...state,
        connectionStatus: connectionStatus(
          state.lastReportedAt,
          this.config.deviceHeartbeatTimeoutMs,
          new Date(),
        ),
      },
      this.config,
    )
  }
}
