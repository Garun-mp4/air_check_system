import { assessSensor, type SensorId, type StoredTelemetry, type TelemetryFrame } from '../lib/telemetry'
import type { AirQualityService } from './service'
import type { Repository } from './repository'
import type { TelemetryStore } from './telemetry-store'
import type { ControlTarget, MeasurementInput } from './types'
import { ValidationError } from './validation'

export const commandFailureMessages: Record<Exclude<TelemetryFrame['command_results'][number]['status'], 'applied'>, string> = {
  expired: 'Срок команды истёк на устройстве', clock_unsynced: 'Часы устройства не синхронизированы',
  disabled: 'Исполнительные каналы не введены в эксплуатацию', fault: 'Сработала защита исполнительного механизма; проверьте обратную связь',
  cancelled: 'Устройство остановило отменённую команду', unsafe_air: 'Локальная защита: наружный воздух небезопасен или измерения недостоверны',
}

export function completeMeasurement(frame: TelemetryFrame): MeasurementInput | null {
  if (!frame.sampled_at || !frame.controller.clock_synced) return null
  const at = Date.parse(frame.sampled_at)
  if (frame.sensors.length !== 4 || frame.sensors.some(sensor => !assessSensor(sensor, at).usable)) return null
  const window = frame.actuators.window
  if (window.position_quality !== 'measured' || window.position_percent === null || window.open_limit && window.close_limit) return null
  const channel = (id: SensorId, name: 'co2' | 'temperature' | 'humidity' | 'pm25'): number => {
    const value = frame.sensors.find(sensor => sensor.sensor_id === id)?.values[name]
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError([{ field: id + '.' + name, message: 'нет достоверного значения' }])
    return value
  }
  const outdoorDates = frame.sensors.filter(sensor => sensor.sensor_id.startsWith('outdoor_')).map(sensor => Date.parse(sensor.last_good_at ?? ''))
  return {
    ingestKey: `v2:${frame.data_source}:${frame.device_id}:${frame.boot_id}:${frame.sequence}`,
    timestamp: new Date(at), dataSource: frame.data_source, outdoorSampledAt: new Date(Math.min(...outdoorDates)),
    indoor: { co2: channel('indoor_climate', 'co2'), temperature: channel('indoor_climate', 'temperature'), humidity: channel('indoor_climate', 'humidity'), pm25: channel('indoor_particles', 'pm25') },
    outdoor: { temperature: channel('outdoor_climate', 'temperature'), humidity: channel('outdoor_climate', 'humidity'), pm25: channel('outdoor_particles', 'pm25') },
    windowOpen: window.position_percent > 0,
  }
}

export class TelemetryService {
  constructor(
    private readonly store: TelemetryStore,
    private readonly repository: Pick<Repository, 'getControlState' | 'listPendingControlCommands'>,
    private readonly air: Pick<AirQualityService, 'ingest' | 'reportControlState'>,
    private readonly deviceId: string,
    private readonly now = () => Date.now(),
  ) {}

  async ingest(frame: TelemetryFrame) {
    if (frame.device_id !== this.deviceId) throw new ValidationError([{ field: 'device_id', message: 'не соответствует устройству установки' }])
    const saved = await this.store.save(frame)
    const now = this.now()
    const age = now - Date.parse(frame.sampled_at ?? saved.record.received_at)
    if (saved.current && age >= -5000 && age <= 90000) {
      const previous = await this.repository.getControlState(frame.device_id)
      const pending = await this.repository.listPendingControlCommands(frame.device_id, 20)
      const { window, exhaust, intake } = frame.actuators
      const valid = frame.controller.clock_synced && frame.controller.outputs_commissioned
      const known: ControlTarget[] = []
      if (valid && window.position_quality === 'measured' && window.position_percent !== null && !(window.open_limit && window.close_limit) && window.motion !== 'fault') known.push('window')
      if (valid && exhaust.status === 'measured' && exhaust.rpm !== null) known.push('exhaust')
      if (valid && intake.status === 'measured' && intake.rpm !== null) known.push('intake')
      const applied = frame.command_results.filter(result => {
        if (result.status !== 'applied') return false
        const command = pending.find(item => item.id === result.id)
        if (!command || !known.includes(command.target)) return false
        if (command.target === 'window') return window.motion === 'stopped' && window.position_percent === (command.desiredState ? 100 : 0)
        const fan = command.target === 'exhaust' ? exhaust : intake
        return fan.requested_on === command.desiredState && fan.rpm !== null && (command.desiredState ? fan.rpm > 0 : fan.rpm === 0)
      }).map(result => result.id)
      await this.air.reportControlState({
        deviceId: frame.device_id, timestamp: new Date(saved.record.received_at), knownTargets: known,
        reported: { windowOpen: window.position_percent === null ? previous.reported.windowOpen : window.position_percent > 0, exhaustOn: exhaust.rpm === null ? previous.reported.exhaustOn : exhaust.rpm > 0, intakeOn: intake.rpm === null ? previous.reported.intakeOn : intake.rpm > 0 },
        appliedCommandIds: applied,
        failedCommands: frame.command_results.flatMap(result => result.status === 'applied' ? [] : [{ id: result.id, reason: commandFailureMessages[result.status] }]),
      })
    }
    const measurement = completeMeasurement(frame)
    const projected = measurement ? await this.air.ingest(measurement) : null
    return { ...saved, measurementId: projected?.measurement.id ?? null }
  }

  latest(source: TelemetryFrame['data_source']): Promise<StoredTelemetry | null> {
    return this.store.latest(this.deviceId, source)
  }
}
