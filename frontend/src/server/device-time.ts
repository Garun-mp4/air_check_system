export class DeviceTimeError extends Error {
  readonly code = 'invalid_device_time'
  constructor() { super('Время устройства некорректно или более чем на 5 секунд в будущем'); this.name = 'DeviceTimeError' }
}
export function assertDeviceTime(timestamp: Date, now = Date.now()): void {
  if (!Number.isFinite(timestamp.getTime()) || timestamp.getTime() > now + 5000) throw new DeviceTimeError()
}
