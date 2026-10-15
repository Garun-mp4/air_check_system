import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { PostgresTelemetryStore, TelemetryConflictError } from '../../frontend/src/server/telemetry-store.ts'
import { PostgresRepository } from '../../frontend/src/server/repository.ts'
import { frameFixture } from '../../frontend/src/server/test-fixtures/telemetry.ts'
const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Pool } = require('pg')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const store = new PostgresTelemetryStore(pool)
const repository = new PostgresRepository(process.env.DATABASE_URL)

try {
  await pool.query('TRUNCATE device_telemetry_heads,device_telemetry,device_telemetry_boots RESTART IDENTITY CASCADE')
  const frame = frameFixture()
  const writes = await Promise.all(Array.from({ length: 10 }, () => store.save(frame)))
  assert.equal(writes.filter(write => !write.duplicate).length, 1)
  assert.equal(new Set(writes.map(write => write.record.id)).size, 1)
  assert.equal(new Set(writes.map(write => write.record.received_at)).size, 1)
  const conflict = frameFixture(); conflict.sensors[0].values.co2 = 3000
  await assert.rejects(store.save(conflict), TelemetryConflictError)
  // The conflicting insert rolled back; the previous head is intact.
  assert.equal((await store.latest(frame.device_id, 'real')).frame.sensors[0].values.co2, 900)
  const late = frameFixture(); late.sequence = 3; late.sampled_at = '2026-10-15T11:50:00Z'
  assert.equal((await store.save(late)).current, false)
  const reboot = frameFixture(); reboot.boot_id = 'boot-00000002'; reboot.sequence = 0; reboot.sampled_at = '2026-10-15T12:00:10Z'
  assert.equal((await store.save(reboot)).current, true)
  const replay = frameFixture(); replay.sequence = 100; replay.sampled_at = '2026-10-15T12:00:20Z'
  assert.equal((await store.save(replay)).current, false)
  const virtual = frameFixture(); virtual.data_source = 'simulator'; virtual.sensors[0].values.co2 = 7000
  await store.save(virtual)
  assert.equal((await store.latest(frame.device_id, 'real')).frame.boot_id, reboot.boot_id)
  assert.equal((await store.latest(frame.device_id, 'simulator')).frame.sensors[0].values.co2, 7000)
  assert.equal(await store.prune(new Date(Date.now() + 60000)), 3)
  assert.equal((await store.latest(frame.device_id, 'real')).frame.boot_id, reboot.boot_id)
  // Retired boot identity survives raw-data pruning.
  replay.sequence = 101
  assert.equal((await store.save(replay)).current, false)
  await pool.query("DELETE FROM predictions WHERE ingest_key LIKE 'db-telemetry-%'")
  await pool.query("DELETE FROM recommendations WHERE ingest_key LIKE 'db-telemetry-%'")
  await pool.query("DELETE FROM measurements WHERE ingest_key LIKE 'db-telemetry-%'")
  const input = { ingestKey: 'db-telemetry-measurement', dataSource: 'real', timestamp: new Date(Date.now() - 2000), outdoorSampledAt: new Date(Date.now() - 8000), indoor: { co2: 900, temperature: 23, humidity: 45, pm25: 8 }, outdoor: { temperature: 15, humidity: 50, pm25: 12 }, windowOpen: false }
  const measurements = await Promise.all(Array.from({ length: 10 }, () => repository.createMeasurement(input)))
  assert.equal(new Set(measurements.map(row => row.id)).size, 1)
  assert.equal(measurements[0].outdoorSampledAt.toISOString(), input.outdoorSampledAt.toISOString())
  await assert.rejects(repository.createMeasurement({ ...input, indoor: { ...input.indoor, co2: 3000 } }), /другим содержимым/)
  await assert.rejects(repository.createMeasurement({ ...input, ingestKey: 'db-telemetry-future', timestamp: new Date(Date.now() + 6000) }), /будущем/)
  const forecast = { ingestKey: 'db-telemetry-prediction', measurementId: measurements[0].id, sourceTimestamp: input.timestamp, targetTime: new Date(Date.now() + 900000), predictedCo2: 1000, modelName: 'test', modelVersion: 'test', dataSource: 'real' }
  const forecasts = await Promise.all(Array.from({ length: 5 }, () => repository.createPrediction(forecast)))
  assert.equal(new Set(forecasts.map(row => row.id)).size, 1)
  await repository.setPredictionOutcome(measurements[0].id, 'unavailable', 'late concurrent failure', 'test')
  assert.equal((await pool.query('SELECT prediction_status FROM measurements WHERE id=$1', [measurements[0].id])).rows[0].prediction_status, 'ready')
  const draft = { ingestKey: 'db-telemetry-recommendation', measurementId: measurements[0].id, type: 'normal', message: 'without forecast', durationMinutes: null, reason: 'test', forecastUsed: false }
  const initial = await repository.createRecommendation(draft)
  const improved = await repository.createRecommendation({ ...draft, type: 'forecast_warning', message: 'with forecast', forecastUsed: true })
  assert.equal(improved.id, initial.id)
  const downgrade = await repository.createRecommendation(draft)
  assert.equal(downgrade.message, 'with forecast')
  const deviceId = 'db-telemetry-controller'
  await pool.query('DELETE FROM actuator_commands WHERE device_id=$1', [deviceId])
  await pool.query('DELETE FROM actuator_states WHERE device_id=$1', [deviceId])
  await repository.reportControlState({ deviceId, timestamp: new Date(), reported: { exhaustOn: true, intakeOn: true, windowOpen: true }, appliedCommandIds: [] })
  const [command] = await repository.queueControlCommands([{ deviceId, target: 'window', desiredState: false, source: 'manual', reason: 'test', batchId: 'db-telemetry-batch' }])
  const unknown = await repository.reportControlState({ deviceId, timestamp: new Date(Date.now() + 1000), knownTargets: [], reported: { exhaustOn: false, intakeOn: false, windowOpen: false }, appliedCommandIds: [command.id] })
  assert.equal(unknown.reported.windowOpen, true)
  assert.deepEqual(unknown.knownTargets, [])
  assert.equal((await repository.listPendingControlCommands(deviceId, 20)).length, 1)
  await repository.reportControlState({ deviceId, timestamp: new Date(Date.now() + 2000), knownTargets: ['window'], reported: { exhaustOn: false, intakeOn: false, windowOpen: false }, appliedCommandIds: [command.id] })
  assert.equal((await repository.listPendingControlCommands(deviceId, 20)).length, 0)
  await assert.rejects(repository.reportControlState({ deviceId, timestamp: new Date(Date.now() + 6000), reported: { exhaustOn: false, intakeOn: false, windowOpen: false }, appliedCommandIds: [] }), /будущем/)
  // Reproduce an old poisoned record without accepting a new future heartbeat.
  await pool.query("UPDATE actuator_states SET last_reported_at=clock_timestamp()+interval '1 year',window_open_since=clock_timestamp()+interval '1 year',ventilation_started_at=clock_timestamp()+interval '1 year' WHERE device_id=$1", [deviceId])
  const recovered = await repository.reportControlState({ deviceId, timestamp: new Date(), reported: { exhaustOn: true, intakeOn: true, windowOpen: true }, appliedCommandIds: [] })
  assert.ok(recovered.lastReportedAt.getTime() <= Date.now() + 5000)
  assert.ok(recovered.windowOpenSince.getTime() <= Date.now() + 5000)
  assert.ok(recovered.ventilationStartedAt.getTime() <= Date.now() + 5000)
  console.log('telemetry: passed (concurrency, retry, conflict rollback, late history, reboot, isolation, pruning)')
} finally { await repository.close(); await pool.end() }
