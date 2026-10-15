import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import type { StoredTelemetry, TelemetryFrame } from '../lib/telemetry'

export class TelemetryConflictError extends Error {
  readonly code = 'telemetry_conflict'
  constructor() { super('Идентификатор пакета уже использован с другим содержимым'); this.name = 'TelemetryConflictError' }
}
export interface TelemetryWrite {
  record: StoredTelemetry
  duplicate: boolean
  current: boolean
}
export interface TelemetryStore {
  save(frame: TelemetryFrame, delivery?: 'live' | 'archive'): Promise<TelemetryWrite>
  latest(deviceId: string, source: TelemetryFrame['data_source']): Promise<StoredTelemetry | null>
  history(deviceId: string, source: TelemetryFrame['data_source'], from: Date, to: Date, limit: number): Promise<StoredTelemetry[]>
  prune(cutoff: Date): Promise<number>
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value)
}
export function telemetryHash(frame: TelemetryFrame): string { return createHash('sha256').update(canonical(frame)).digest('hex') }

// Archive delivery never owns the current state. A live unsynchronized reboot
// replaces the old state with unknown quality, retiring the previous boot.
export function supersedes(next: TelemetryFrame, previous: TelemetryFrame | null, nextBoot: number, previousBoot: number, delivery: 'live' | 'archive' = 'live'): boolean {
  if (delivery === 'archive') return false
  if (!previous) return true
  if (nextBoot < previousBoot) return false
  if (next.boot_id === previous.boot_id && next.sequence <= previous.sequence) return false
  if (previous.sampled_at && next.sampled_at && Date.parse(next.sampled_at) < Date.parse(previous.sampled_at)) return false
  return true
}

export class MemoryTelemetryStore implements TelemetryStore {
  private records = new Map<string, { record: StoredTelemetry; hash: string }>()
  private heads = new Map<string, StoredTelemetry>()
  private boots = new Map<string, number>()
  private nextId = 1
  private readonly now: () => Date
  constructor(now = () => new Date()) { this.now = now }
  async save(frame: TelemetryFrame, delivery: 'live' | 'archive' = 'live'): Promise<TelemetryWrite> {
    const owner = `${frame.device_id}/${frame.data_source}`
    const boot = `${owner}/${frame.boot_id}`
    const key = `${boot}/${frame.sequence}`
    const hash = telemetryHash(frame)
    const existing = this.records.get(key)
    if (existing) {
      if (hash !== existing.hash) throw new TelemetryConflictError()
      return { record: structuredClone(existing.record), duplicate: true, current: delivery === 'live' && this.heads.get(owner)?.id === existing.record.id }
    }
    if (!this.boots.has(boot)) this.boots.set(boot, this.boots.size + 1)
    const record = { id: this.nextId++, delivery_kind: delivery, received_at: this.now().toISOString(), frame: structuredClone(frame) }
    const previous = this.heads.get(owner)
    const current = supersedes(frame, previous?.frame ?? null, this.boots.get(boot)!, previous ? this.boots.get(`${owner}/${previous.frame.boot_id}`)! : 0, delivery)
    this.records.set(key, { record, hash })
    if (current) this.heads.set(owner, record)
    return { record: structuredClone(record), duplicate: false, current }
  }
  async latest(deviceId: string, source: TelemetryFrame['data_source']): Promise<StoredTelemetry | null> {
    return structuredClone(this.heads.get(`${deviceId}/${source}`) ?? null)
  }
  async history(deviceId: string, source: TelemetryFrame['data_source'], from: Date, to: Date, limit: number): Promise<StoredTelemetry[]> {
    return structuredClone([...this.records.values()].map(value => value.record)
      .filter(value => value.frame.device_id === deviceId && value.frame.data_source === source && value.frame.sampled_at && Date.parse(value.frame.sampled_at) >= from.getTime() && Date.parse(value.frame.sampled_at) <= to.getTime())
      .sort((a, b) => Date.parse(a.frame.sampled_at!) - Date.parse(b.frame.sampled_at!) || a.id - b.id).slice(-limit))
  }
  async prune(cutoff: Date): Promise<number> {
    const protectedIds = new Set([...this.heads.values()].map(record => record.id))
    let removed = 0
    for (const [key, { record }] of this.records) if (Date.parse(record.received_at) < cutoff.getTime() && !protectedIds.has(record.id)) { this.records.delete(key); ++removed }
    return removed
  }
}

interface Row { id: string | number; received_at: Date; payload: TelemetryFrame; delivery_kind?: 'live' | 'archive' }
function mapRow(row: Row): StoredTelemetry { return { id: Number(row.id), received_at: row.received_at.toISOString(), frame: row.payload, delivery_kind: row.delivery_kind ?? 'live' } }

export class PostgresTelemetryStore implements TelemetryStore {
  private readonly pool: Pool
  constructor(pool: Pool) { this.pool = pool }
  async save(frame: TelemetryFrame, delivery: 'live' | 'archive' = 'live'): Promise<TelemetryWrite> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('INSERT INTO device_telemetry_heads (device_id,data_source) VALUES ($1,$2) ON CONFLICT DO NOTHING', [frame.device_id, frame.data_source])
      // One ordering/duplicate decision at a time per physical or virtual device.
      await client.query('SELECT frame_id FROM device_telemetry_heads WHERE device_id=$1 AND data_source=$2 FOR UPDATE', [frame.device_id, frame.data_source])
      const identity = [frame.device_id, frame.data_source, frame.boot_id]
      await client.query('INSERT INTO device_telemetry_boots (device_id,data_source,boot_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', identity)
      const hash = telemetryHash(frame)
      const inserted = await client.query<Row>('INSERT INTO device_telemetry (device_id,data_source,boot_id,sequence,sampled_at,payload,payload_hash,delivery_kind) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT (device_id,data_source,boot_id,sequence) DO NOTHING RETURNING id,received_at,payload,delivery_kind', [...identity, frame.sequence, frame.sampled_at, JSON.stringify(frame), hash, delivery])
      const previous = await client.query<Row & { boot_order: string }>('SELECT t.id,t.received_at,t.payload,b.id AS boot_order FROM device_telemetry_heads h JOIN device_telemetry t ON t.id=h.frame_id JOIN device_telemetry_boots b ON b.device_id=t.device_id AND b.data_source=t.data_source AND b.boot_id=t.boot_id WHERE h.device_id=$1 AND h.data_source=$2', [frame.device_id, frame.data_source])
      if (!inserted.rows[0]) {
        const existing = await client.query<Row & { payload_hash: string }>('SELECT id,received_at,payload,payload_hash,delivery_kind FROM device_telemetry WHERE device_id=$1 AND data_source=$2 AND boot_id=$3 AND sequence=$4', [...identity, frame.sequence])
        const row = existing.rows[0]
        if (!row || row.payload_hash !== hash) throw new TelemetryConflictError()
        await client.query('COMMIT')
        return { record: mapRow(row), duplicate: true, current: delivery === 'live' && Number(previous.rows[0]?.id) === Number(row.id) }
      }
      const boot = await client.query<{ id: string }>('SELECT id FROM device_telemetry_boots WHERE device_id=$1 AND data_source=$2 AND boot_id=$3', identity)
      const current = supersedes(frame, previous.rows[0]?.payload ?? null, Number(boot.rows[0].id), Number(previous.rows[0]?.boot_order ?? 0), delivery)
      if (current) await client.query('UPDATE device_telemetry_heads SET frame_id=$3 WHERE device_id=$1 AND data_source=$2', [frame.device_id, frame.data_source, inserted.rows[0].id])
      await client.query('COMMIT')
      return { record: mapRow(inserted.rows[0]), duplicate: false, current }
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }
  async latest(deviceId: string, source: TelemetryFrame['data_source']): Promise<StoredTelemetry | null> {
    const result = await this.pool.query<Row>('SELECT t.id,t.received_at,t.payload,t.delivery_kind FROM device_telemetry_heads h JOIN device_telemetry t ON t.id=h.frame_id WHERE h.device_id=$1 AND h.data_source=$2', [deviceId, source])
    return result.rows[0] ? mapRow(result.rows[0]) : null
  }
  async history(deviceId: string, source: TelemetryFrame['data_source'], from: Date, to: Date, limit: number): Promise<StoredTelemetry[]> {
    const result = await this.pool.query<Row>('SELECT id,received_at,payload,delivery_kind FROM device_telemetry WHERE device_id=$1 AND data_source=$2 AND sampled_at BETWEEN $3 AND $4 ORDER BY sampled_at DESC,id DESC LIMIT $5', [deviceId, source, from, to, Math.min(20000, limit)])
    return result.rows.map(mapRow).reverse()
  }
  async prune(cutoff: Date): Promise<number> {
    const result = await this.pool.query('DELETE FROM device_telemetry t WHERE received_at < $1 AND NOT EXISTS (SELECT 1 FROM device_telemetry_heads h WHERE h.frame_id=t.id)', [cutoff])
    return result.rowCount ?? 0
  }
}
