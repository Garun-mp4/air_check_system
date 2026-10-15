import { createHash } from 'node:crypto'
import type { MeasurementInput } from './types'

export function measurementIdentity(input: MeasurementInput): string {
  if (input.ingestKey) return input.ingestKey
  return measurementContentHash(input)
}
export class IngestConflictError extends Error {
  readonly code = 'ingest_conflict'
  constructor() { super('Идентификатор измерения уже использован с другим содержимым'); this.name = 'IngestConflictError' }
}
export function measurementContentHash(input: MeasurementInput): string {
  // Settings and server receipt time may change between retries; source data may not.
  const content = [input.dataSource ?? 'unknown', input.timestamp.toISOString(),
    input.indoor.co2, input.indoor.temperature, input.indoor.humidity, input.indoor.pm25,
    input.outdoor.temperature, input.outdoor.humidity, input.outdoor.pm25,
    (input.outdoorSampledAt ?? input.timestamp).toISOString(), input.windowOpen]
  return 'legacy:' + createHash('sha256').update(JSON.stringify(content)).digest('hex')
}
