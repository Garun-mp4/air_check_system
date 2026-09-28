import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { PostgresRepository } from '../../frontend/src/server/repository.ts'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Pool } = require('pg')
const databaseUrl = process.env.DATABASE_URL
const scenario = process.argv[2]

assert.ok(databaseUrl, 'DATABASE_URL must point to the isolated test database')

const defaults = {
  automationEnabled: true,
  autoWindowEnabled: true,
  manualOverrideMinutes: 30,
  autoVentilationMinimumMinutes: 5,
  co2NormalThreshold: 800,
  co2CriticalThreshold: 1000,
  pm25GoodLimit: 15,
  pm25ElevatedLimit: 35,
  alertsEnabled: true,
  retentionHours: 24,
}

function measurement(timestamp, co2) {
  return {
    timestamp: new Date(timestamp),
    indoor: { co2, temperature: 22.5, humidity: 42.25, pm25: 4.75 },
    outdoor: { temperature: 16.5, humidity: 58.25, pm25: 9.75 },
    windowOpen: false,
  }
}

function command(deviceId, target, desiredState, batchId) {
  return {
    deviceId,
    target,
    desiredState,
    source: 'manual',
    reason: 'database integration test',
    batchId,
  }
}

async function runMeasurementHistory(repository) {
  assert.equal(await repository.getLatestMeasurement(), null)
  await repository.createMeasurement(measurement('2025-01-01T00:00:00Z', 600))
  const middle = await repository.createMeasurement(measurement('2025-01-01T00:00:01Z', 610))
  const tiedFirst = await repository.createMeasurement(measurement('2025-01-01T00:00:02Z', 620))
  const tiedSecond = await repository.createMeasurement(measurement('2025-01-01T00:00:02Z', 630))
  const latest = await repository.createMeasurement(measurement('2025-01-01T00:00:03Z', 640))

  const current = await repository.getLatestMeasurement()
  assert.equal(current.id, latest.id)
  assert.equal(current.indoor.co2, 640)
  assert.ok(current.createdAt instanceof Date)
  assert.ok(current.timestamp instanceof Date)

  const bounded = await repository.listMeasurements({
    from: new Date('2025-01-01T00:00:01Z'),
    to: new Date('2025-01-01T00:00:02Z'),
    limit: 10,
  })
  assert.deepEqual(bounded.map((entry) => entry.indoor.co2), [610, 620, 630])
  assert.deepEqual(bounded.map((entry) => entry.id), [middle.id, tiedFirst.id, tiedSecond.id])
  assert.equal(bounded[0].outdoor.pm25, 9.75)

  const limited = await repository.listMeasurements({ limit: 2 })
  assert.deepEqual(limited.map((entry) => entry.indoor.co2), [630, 640])
  const excluded = await repository.listMeasurements({
    to: new Date('2025-01-01T00:00:01Z'),
    limit: 100,
  })
  assert.deepEqual(excluded.map((entry) => entry.indoor.co2), [600, 610])
}

async function runReadModels(repository) {
  const noPrediction = await repository.getLatestPrediction()
  const noRecommendation = await repository.getLatestRecommendation()
  assert.equal(noPrediction, null)
  assert.equal(noRecommendation, null)

  const firstPrediction = await repository.createPrediction({
    targetTime: new Date('2025-01-01T00:15:00Z'),
    predictedCo2: 812.5,
    modelName: 'test-model',
    modelVersion: 'test-version',
  })
  const newerPrediction = await repository.createPrediction({
    targetTime: new Date('2025-01-01T00:20:00Z'),
    predictedCo2: 925.25,
    modelName: 'test-model',
    modelVersion: 'test-version',
  })
  assert.equal((await repository.getLatestPrediction()).id, newerPrediction.id)
  assert.notEqual(firstPrediction.id, newerPrediction.id)

  const firstRecommendation = await repository.createRecommendation({
    type: 'monitor',
    message: 'Check the next reading',
    durationMinutes: null,
    reason: 'test recommendation',
  })
  const latestRecommendation = await repository.createRecommendation({
    type: 'ventilate_now',
    message: 'Ventilate for ten minutes',
    durationMinutes: 10,
    reason: 'test recommendation',
  })
  const recommendation = await repository.getLatestRecommendation()
  assert.equal(recommendation.id, latestRecommendation.id)
  assert.equal(recommendation.durationMinutes, 10)
  assert.notEqual(firstRecommendation.id, latestRecommendation.id)
}

async function runSettings(repository, pool) {
  const first = await repository.getNodeSettings('settings-node-a', defaults)
  assert.equal(first.co2NormalThreshold, defaults.co2NormalThreshold)
  assert.equal(first.retentionHours, defaults.retentionHours)
  assert.equal(first.automationEnabled, true)

  const updated = await repository.updateNodeSettings(
    'settings-node-a',
    {
      automationEnabled: false,
      co2NormalThreshold: 850,
      co2CriticalThreshold: 1100,
      pm25GoodLimit: 12,
      pm25ElevatedLimit: 40,
    },
    defaults,
  )
  assert.equal(updated.automationEnabled, false)
  assert.equal(updated.co2NormalThreshold, 850)
  assert.equal(updated.co2CriticalThreshold, 1100)
  assert.equal(updated.pm25GoodLimit, 12)
  assert.equal(updated.pm25ElevatedLimit, 40)

  const second = await repository.getNodeSettings('settings-node-b', defaults)
  assert.equal(second.automationEnabled, true)
  assert.equal(second.co2NormalThreshold, 800)
  const rows = await pool.query(
    "SELECT count(*)::int AS count FROM node_settings WHERE device_id IN ('settings-node-a', 'settings-node-b')",
  )
  assert.equal(rows.rows[0].count, 2)
}

async function runRetention(repository, pool) {
  const cutoff = new Date('2025-06-01T00:00:00.000Z')
  const before = new Date(cutoff.getTime() - 1)
  const after = new Date(cutoff.getTime() + 1)

  const oldMeasurement = await repository.createMeasurement(measurement(before, 600))
  const boundaryMeasurement = await repository.createMeasurement(measurement(cutoff, 610))
  const newMeasurement = await repository.createMeasurement(measurement(after, 620))

  const oldPrediction = await repository.createPrediction({
    targetTime: new Date('2025-06-02T00:00:00Z'),
    predictedCo2: 850,
    modelName: 'retention-test',
    modelVersion: '1',
  })
  const boundaryPrediction = await repository.createPrediction({
    targetTime: new Date('2025-06-03T00:00:00Z'),
    predictedCo2: 860,
    modelName: 'retention-test',
    modelVersion: '1',
  })

  const oldRecommendation = await repository.createRecommendation({
    type: 'monitor', message: 'old', durationMinutes: null, reason: 'retention test',
  })
  const boundaryRecommendation = await repository.createRecommendation({
    type: 'monitor', message: 'boundary', durationMinutes: null, reason: 'retention test',
  })

  await pool.query('UPDATE measurements SET created_at = $1 WHERE id = $2', [before, oldMeasurement.id])
  await pool.query('UPDATE measurements SET created_at = $1 WHERE id = $2', [cutoff, boundaryMeasurement.id])
  await pool.query('UPDATE measurements SET created_at = $1 WHERE id = $2', [after, newMeasurement.id])
  await pool.query('UPDATE predictions SET created_at = $1 WHERE id = $2', [before, oldPrediction.id])
  await pool.query('UPDATE predictions SET created_at = $1 WHERE id = $2', [cutoff, boundaryPrediction.id])
  await pool.query('UPDATE recommendations SET created_at = $1 WHERE id = $2', [before, oldRecommendation.id])
  await pool.query('UPDATE recommendations SET created_at = $1 WHERE id = $2', [cutoff, boundaryRecommendation.id])

  const deviceId = 'retention-command-node'
  await repository.getControlState(deviceId)
  const pending = await repository.queueControlCommands([
    command(deviceId, 'intake', true, 'retention-pending'),
  ])
  const applied = await repository.queueControlCommands([
    command(deviceId, 'exhaust', true, 'retention-applied'),
  ])
  await repository.reportControlState({
    deviceId,
    timestamp: new Date('2025-06-10T00:00:00Z'),
    reported: { exhaustOn: true, intakeOn: false, windowOpen: false },
    appliedCommandIds: [applied[0].id],
  })
  await pool.query(
    'UPDATE actuator_commands SET created_at = $1 WHERE id = ANY($2::bigint[])',
    [before, [pending[0].id, applied[0].id]],
  )

  const result = await repository.purgeExpiredData(cutoff)
  assert.equal(result.measurements, 1)
  assert.equal(result.predictions, 1)
  assert.equal(result.recommendations, 1)
  assert.equal(result.commands, 1)
  assert.equal(result.cutoff.getTime(), cutoff.getTime())

  const measurementRows = await pool.query(
    'SELECT id FROM measurements ORDER BY id',
  )
  assert.deepEqual(
    measurementRows.rows.map((row) => Number(row.id)),
    [boundaryMeasurement.id, newMeasurement.id],
  )
  const predictionRows = await pool.query('SELECT id FROM predictions')
  assert.deepEqual(predictionRows.rows.map((row) => Number(row.id)), [boundaryPrediction.id])
  const recommendationRows = await pool.query('SELECT id FROM recommendations')
  assert.deepEqual(recommendationRows.rows.map((row) => Number(row.id)), [boundaryRecommendation.id])

  const commandRows = await pool.query(
    'SELECT id, status FROM actuator_commands WHERE device_id = $1 ORDER BY id',
    [deviceId],
  )
  assert.deepEqual(
    commandRows.rows.map((row) => ({ id: Number(row.id), status: row.status })),
    [{ id: pending[0].id, status: 'pending' }],
  )
  const state = await repository.getControlState(deviceId)
  assert.equal(state.reported.exhaustOn, true)
  assert.equal(state.pendingCommands, 1)
}

async function runRetentionRollback(repository, pool) {
  const cutoff = new Date(Date.now() + 30_000)
  const oldTimestamp = new Date(Date.now() - 30_000)
  const measurementRow = await repository.createMeasurement(measurement(oldTimestamp, 700))
  const predictionRow = await repository.createPrediction({
    targetTime: new Date(Date.now() + 15 * 60_000),
    predictedCo2: 900,
    modelName: 'retention-rollback-test',
    modelVersion: '1',
  })
  const recommendationRow = await repository.createRecommendation({
    type: 'monitor',
    message: 'rollback',
    durationMinutes: null,
    reason: 'retention rollback test',
  })

  const deviceId = 'retention-rollback-node'
  await repository.getControlState(deviceId)
  const [queued] = await repository.queueControlCommands([
    command(deviceId, 'exhaust', true, 'retention-rollback-batch'),
  ])
  await repository.reportControlState({
    deviceId,
    timestamp: new Date(),
    reported: { exhaustOn: true, intakeOn: false, windowOpen: false },
    appliedCommandIds: [queued.id],
  })
  await pool.query('UPDATE actuator_commands SET created_at = $1 WHERE id = $2', [oldTimestamp, queued.id])

  await pool.query(`
    CREATE FUNCTION aircheck_test_fail_retention_delete() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'test-retention-trigger-failure';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER aircheck_test_fail_retention_delete
      BEFORE DELETE ON actuator_commands
      FOR EACH ROW WHEN (OLD.status = 'applied')
      EXECUTE FUNCTION aircheck_test_fail_retention_delete();
  `)
  try {
    await assert.rejects(
      repository.purgeExpiredData(cutoff),
      /test-retention-trigger-failure/,
    )
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS aircheck_test_fail_retention_delete ON actuator_commands')
    await pool.query('DROP FUNCTION IF EXISTS aircheck_test_fail_retention_delete()')
  }

  const countsAfterFailure = await pool.query(
    'SELECT (SELECT count(*) FROM measurements WHERE id = $1)::int AS measurements, ' +
      '(SELECT count(*) FROM predictions WHERE id = $2)::int AS predictions, ' +
      '(SELECT count(*) FROM recommendations WHERE id = $3)::int AS recommendations, ' +
      '(SELECT count(*) FROM actuator_commands WHERE id = $4 AND status = \'applied\')::int AS commands',
    [measurementRow.id, predictionRow.id, recommendationRow.id, queued.id],
  )
  assert.deepEqual(countsAfterFailure.rows[0], {
    measurements: 1,
    predictions: 1,
    recommendations: 1,
    commands: 1,
  })

  const cleaned = await repository.purgeExpiredData(cutoff)
  assert.deepEqual(
    {
      measurements: cleaned.measurements,
      predictions: cleaned.predictions,
      recommendations: cleaned.recommendations,
      commands: cleaned.commands,
    },
    { measurements: 1, predictions: 1, recommendations: 1, commands: 1 },
  )
}

async function runTransactions(repository, pool) {
  const rollbackDevice = 'atomic-queue-node'
  await assert.rejects(
    repository.queueControlCommands([
      command(rollbackDevice, 'window', true, 'atomic-batch'),
      { ...command(rollbackDevice, 'invalid-target', true, 'atomic-batch'), target: 'invalid-target' },
    ]),
  )
  const rolledBackState = await repository.getControlState(rollbackDevice)
  assert.deepEqual(rolledBackState.desired, {
    exhaustOn: false,
    intakeOn: false,
    windowOpen: false,
  })
  assert.equal(rolledBackState.pendingCommands, 0)

  const ackDevice = 'actual-ack-node'
  const ackTimestamp = new Date('2026-01-01T00:00:00Z')
  await repository.reportControlState({
    deviceId: ackDevice,
    timestamp: ackTimestamp,
    reported: { exhaustOn: false, intakeOn: false, windowOpen: false },
    appliedCommandIds: [],
  })
  const ackCommands = await repository.queueControlCommands([
    command(ackDevice, 'exhaust', true, 'actual-ack'),
    command(ackDevice, 'intake', true, 'actual-ack'),
    command(ackDevice, 'window', true, 'actual-ack'),
  ])
  const mismatchedAck = await repository.reportControlState({
    deviceId: ackDevice,
    timestamp: new Date(ackTimestamp.getTime() + 60_000),
    reported: { exhaustOn: false, intakeOn: false, windowOpen: false },
    appliedCommandIds: ackCommands.map((item) => item.id),
  })
  assert.equal(mismatchedAck.pendingCommands, 3)
  assert.deepEqual(
    (await repository.listPendingControlCommands(ackDevice, 10)).map((item) => item.id),
    ackCommands.map((item) => item.id),
  )

  const acceptedAck = await repository.reportControlState({
    deviceId: ackDevice,
    timestamp: new Date(ackTimestamp.getTime() + 120_000),
    reported: { exhaustOn: true, intakeOn: true, windowOpen: true },
    appliedCommandIds: ackCommands.map((item) => item.id),
  })
  assert.equal(acceptedAck.pendingCommands, 0)
  for (const target of ['exhaust', 'intake', 'window']) {
    assert.equal((await repository.getLatestControlCommand(ackDevice, target)).status, 'applied')
  }

  const reportDevice = 'atomic-report-node'
  const initialTimestamp = new Date('2026-01-01T00:00:00Z')
  const nextTimestamp = new Date('2026-01-01T00:01:00Z')
  await repository.reportControlState({
    deviceId: reportDevice,
    timestamp: initialTimestamp,
    reported: { exhaustOn: false, intakeOn: false, windowOpen: false },
    appliedCommandIds: [],
  })
  const [queued] = await repository.queueControlCommands([
    command(reportDevice, 'window', true, 'atomic-report-batch'),
  ])

  await pool.query(`
    CREATE FUNCTION aircheck_test_fail_applied_command() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'test-trigger-failure';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER aircheck_test_fail_applied_command
      BEFORE UPDATE OF status ON actuator_commands
      FOR EACH ROW WHEN (NEW.status = 'applied')
      EXECUTE FUNCTION aircheck_test_fail_applied_command();
  `)
  try {
    await assert.rejects(
      repository.reportControlState({
        deviceId: reportDevice,
        timestamp: nextTimestamp,
        reported: { exhaustOn: false, intakeOn: false, windowOpen: true },
        appliedCommandIds: [queued.id],
      }),
      /test-trigger-failure/,
    )
    const rolledBack = await repository.getControlState(reportDevice)
    assert.equal(rolledBack.reported.windowOpen, false)
    assert.equal(rolledBack.pendingCommands, 1)
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS aircheck_test_fail_applied_command ON actuator_commands')
    await pool.query('DROP FUNCTION IF EXISTS aircheck_test_fail_applied_command()')
  }

  const committed = await repository.reportControlState({
    deviceId: reportDevice,
    timestamp: nextTimestamp,
    reported: { exhaustOn: false, intakeOn: false, windowOpen: true },
    appliedCommandIds: [queued.id],
  })
  assert.equal(committed.reported.windowOpen, true)
  assert.equal(committed.pendingCommands, 0)
  assert.equal(committed.lastCommand.status, 'applied')
}

async function runReportedStateSync(repository) {
  const deviceId = 'reported-state-sync-node'
  const baseline = new Date('2026-01-01T00:00:00Z')
  const off = { exhaustOn: false, intakeOn: false, windowOpen: false }
  const on = { exhaustOn: true, intakeOn: true, windowOpen: true }
  await repository.reportControlState({
    deviceId,
    timestamp: baseline,
    reported: off,
    appliedCommandIds: [],
  })
  const commands = await repository.queueControlCommands([
    command(deviceId, 'exhaust', true, 'reported-state-sync'),
    command(deviceId, 'intake', true, 'reported-state-sync'),
    command(deviceId, 'window', true, 'reported-state-sync'),
  ])

  const stillWaiting = await repository.reportControlState({
    deviceId,
    timestamp: new Date(baseline.getTime() + 1_000),
    reported: off,
    appliedCommandIds: [],
  })
  assert.deepEqual(stillWaiting.desired, on)
  assert.equal(stillWaiting.pendingCommands, 3)

  const applied = await repository.reportControlState({
    deviceId,
    timestamp: new Date(baseline.getTime() + 2_000),
    reported: on,
    appliedCommandIds: commands.map((item) => item.id),
  })
  assert.deepEqual(applied.desired, applied.reported)
  assert.equal(applied.pendingCommands, 0)

  const restarted = await repository.reportControlState({
    deviceId,
    timestamp: new Date(baseline.getTime() + 3_000),
    reported: off,
    appliedCommandIds: [],
  })
  assert.deepEqual(restarted.reported, off)
  assert.deepEqual(restarted.desired, off)
  assert.equal(restarted.pendingCommands, 0)
}

async function runConcurrentMeasurements(repository) {
  const measurements = await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      repository.createMeasurement(
        measurement(
          new Date(Date.parse('2026-09-01T00:00:00Z') + index * 1000).toISOString(),
          650 + index,
        ),
      ),
    ),
  )
  assert.equal(new Set(measurements.map((item) => item.id)).size, 40)
  assert.equal(
    (await repository.listMeasurements({ limit: 100 })).length,
    40,
    'Concurrent inserts should persist every measurement',
  )
}

async function runConcurrentCommandDeduplication(repository) {
  const deviceId = 'concurrent-queue-node'
  await repository.getControlState(deviceId)

  // Hold competing inserts briefly until two requests have independently
  // passed the repository's pending-command read. A correct per-device lock
  // serializes before this trigger; in that case the bounded wait releases the
  // first insert and lets the second request observe the committed command.
  const barrierSql = `
    CREATE SEQUENCE aircheck_test_queue_barrier_seq START WITH 1;
    CREATE FUNCTION aircheck_test_queue_barrier() RETURNS trigger AS $$
    DECLARE
      reached bigint;
      deadline timestamptz := clock_timestamp() + INTERVAL '1 second';
    BEGIN
      IF NEW.batch_id <> 'concurrent-idempotency-batch' THEN
        RETURN NEW;
      END IF;
      PERFORM nextval('aircheck_test_queue_barrier_seq');
      LOOP
        SELECT last_value INTO reached FROM aircheck_test_queue_barrier_seq;
        EXIT WHEN reached >= 2 OR clock_timestamp() >= deadline;
        PERFORM pg_sleep(0.01);
      END LOOP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER aircheck_test_queue_barrier
      BEFORE INSERT ON actuator_commands
      FOR EACH ROW EXECUTE FUNCTION aircheck_test_queue_barrier();
  `
  const { Pool } = createRequire(new URL('../../frontend/package.json', import.meta.url))('pg')
  const pool = new Pool({ connectionString: databaseUrl, max: 2 })
  await pool.query(barrierSql)

  try {
    const outcomes = await Promise.all(
      Array.from({ length: 2 }, () =>
        repository.queueControlCommands([
          command(deviceId, 'intake', true, 'concurrent-idempotency-batch'),
        ]),
      ),
    )
    const createdCount = outcomes.reduce((count, commands) => count + commands.length, 0)
    const pending = await repository.listPendingControlCommands(deviceId, 100)
    assert.equal(createdCount, 1, 'Concurrent identical requests should queue one command')
    assert.equal(pending.length, 1, 'Concurrent identical requests should not leave duplicate commands')
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS aircheck_test_queue_barrier ON actuator_commands')
    await pool.query('DROP FUNCTION IF EXISTS aircheck_test_queue_barrier()')
    await pool.query('DROP SEQUENCE IF EXISTS aircheck_test_queue_barrier_seq')
    await pool.end()
  }
}

const repository = new PostgresRepository(databaseUrl)
const pool = new Pool({ connectionString: databaseUrl, max: 2 })

try {
  switch (scenario) {
    case 'measurement-history':
      await runMeasurementHistory(repository)
      break
    case 'read-models':
      await runReadModels(repository)
      break
    case 'settings':
      await runSettings(repository, pool)
      break
    case 'retention':
      await runRetention(repository, pool)
      break
    case 'retention-rollback':
      await runRetentionRollback(repository, pool)
      break
    case 'transactions':
      await runTransactions(repository, pool)
      break
    case 'reported-state-sync':
      await runReportedStateSync(repository)
      break
    case 'concurrent-writes':
      await runConcurrentMeasurements(repository)
      break
    case 'concurrent-command-deduplication':
      await runConcurrentCommandDeduplication(repository)
      break
    default:
      throw new Error(`Unknown database test scenario: ${scenario}`)
  }
  process.stdout.write(`${scenario}: passed\n`)
} finally {
  await Promise.all([repository.close(), pool.end()])
}
