import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { getAuthPool } from './auth'
import { getConfig } from './config'
import { ApiError } from './api'
import {
  emptyCondition,
  stepCondition,
  type ConditionState,
} from './notification-policy'
import {
  encryptToken,
  decryptToken,
  sendTelegram,
  type TelegramTransport,
} from './telegram'
type Queryable = Pick<Pool | PoolClient, 'query'>
export type NotificationSettings = {
  enabled: boolean
  co2_duration_seconds: number
  offline_duration_seconds: number
  suppression_seconds: number
  telegram_chat_id: string | null
  token_ciphertext: string | null
}
const secret = () =>
  process.env.NOTIFICATION_ENCRYPTION_KEY?.trim() ||
  process.env.BETTER_AUTH_SECRET ||
  ''
export async function notificationSettings(
  db: Queryable = getAuthPool(),
): Promise<NotificationSettings> {
  await db.query(
    'INSERT INTO notification_settings(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING',
  )
  return (
    await db.query<NotificationSettings>(
      'SELECT * FROM notification_settings WHERE singleton',
    )
  ).rows[0]
}
export function publicNotificationSettings(settings: NotificationSettings) {
  return {
    enabled: settings.enabled,
    co2_duration_seconds: settings.co2_duration_seconds,
    offline_duration_seconds: settings.offline_duration_seconds,
    suppression_seconds: settings.suppression_seconds,
    telegram_chat_id: settings.telegram_chat_id,
    token_configured: !!settings.token_ciphertext,
  }
}
export function parseNotificationSettings(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError('invalid_settings', 'Нужен объект настроек', 400)
  const value = body as Record<string, unknown>
  const keys = [
    'enabled',
    'co2_duration_seconds',
    'offline_duration_seconds',
    'suppression_seconds',
    'telegram_chat_id',
    'bot_token',
    'clear_token',
  ]
  if (Object.keys(value).some((k) => !keys.includes(k)))
    throw new ApiError('invalid_settings', 'Неизвестное поле настройки', 400)
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    throw new ApiError('invalid_settings', 'enabled должен быть boolean', 400)
  for (const key of keys.slice(1, 4))
    if (
      value[key] !== undefined &&
      (!Number.isInteger(value[key]) ||
        Number(value[key]) < (key === 'suppression_seconds' ? 0 : 1) ||
        Number(value[key]) > 86400)
    )
      throw new ApiError(
        'invalid_settings',
        'Длительности должны быть целыми секундами в допустимых пределах',
        400,
      )
  if (
    value.telegram_chat_id !== undefined &&
    value.telegram_chat_id !== null &&
    (typeof value.telegram_chat_id !== 'string' ||
      !/^[-]?[1-9]\d{0,19}$/.test(value.telegram_chat_id))
  )
    throw new ApiError(
      'invalid_settings',
      'Укажите числовой ID выбранного Telegram-чата',
      400,
    )
  if (
    value.bot_token !== undefined &&
    (typeof value.bot_token !== 'string' ||
      !/^\d{5,20}:[A-Za-z0-9_-]{20,150}$/.test(value.bot_token))
  )
    throw new ApiError('invalid_settings', 'Неверный формат токена бота', 400)
  if (value.clear_token !== undefined && typeof value.clear_token !== 'boolean')
    throw new ApiError(
      'invalid_settings',
      'clear_token должен быть boolean',
      400,
    )
  if (value.clear_token && value.bot_token)
    throw new ApiError(
      'invalid_settings',
      'Нельзя одновременно записать и удалить токен',
      400,
    )
  return value as Partial<NotificationSettings> & {
    bot_token?: string
    clear_token?: boolean
  }
}
export async function saveNotificationSettings(body: unknown) {
  const patch = parseNotificationSettings(body),
    client = await getAuthPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('aircheck-notifications'))",
    )
    const previous = await notificationSettings(client)
    if (patch.bot_token && secret().length < 32)
      throw new ApiError(
        'encryption_unconfigured',
        'Настройте ключ шифрования уведомлений длиной минимум 32 символа',
        503,
      )
    const next = {
      ...previous,
      ...patch,
      token_ciphertext: patch.clear_token
        ? null
        : patch.bot_token
          ? encryptToken(patch.bot_token, secret())
          : previous.token_ciphertext,
    }
    if (next.enabled && (!next.telegram_chat_id || !next.token_ciphertext))
      throw new ApiError(
        'channel_unconfigured',
        'Для включения выберите чат и сохраните токен бота',
        400,
      )
    const result = await client.query<NotificationSettings>(
      `UPDATE notification_settings SET enabled=$1,co2_duration_seconds=$2,offline_duration_seconds=$3,suppression_seconds=$4,telegram_chat_id=$5,token_ciphertext=$6,updated_at=now() WHERE singleton RETURNING *`,
      [
        next.enabled,
        next.co2_duration_seconds,
        next.offline_duration_seconds,
        next.suppression_seconds,
        next.telegram_chat_id,
        next.token_ciphertext,
      ],
    )
    await client.query(
      "UPDATE notification_events SET delivery_status='disabled',delivery_error='channel_changed',next_attempt_at=NULL WHERE delivery_status='pending' AND ($1=false OR destination_chat IS DISTINCT FROM $2)",
      [next.enabled, next.telegram_chat_id],
    )
    await client.query('COMMIT')
    return publicNotificationSettings(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
async function recordEvent(
  db: Queryable,
  settings: NotificationSettings,
  device: string,
  kind: string,
  message: string,
  key: string,
  now: Date,
  force = false,
) {
  const channel =
    !!settings.token_ciphertext &&
    !!settings.telegram_chat_id &&
    (settings.enabled || force)
  await db.query(
    `INSERT INTO notification_events(event_key,device_id,kind,message,created_at,destination_chat,delivery_status,next_attempt_at) VALUES($1,$2,$3,$4,$5,$6,$7,$5) ON CONFLICT(event_key) DO NOTHING`,
    [
      key,
      device,
      kind,
      message,
      now,
      channel ? settings.telegram_chat_id : null,
      channel ? 'pending' : 'disabled',
    ],
  )
}
export async function refreshEvents(
  db: Pool = getAuthPool(),
  now = new Date(),
) {
  const config = getConfig(),
    client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('aircheck-notifications'))",
    )
    const settings = await notificationSettings(client)
    const measurement = (
      await client.query<{ timestamp: Date; indoor_co2: number }>(
        "SELECT timestamp,indoor_co2 FROM measurements WHERE timestamp <= clock_timestamp() + interval '5 seconds' AND ($1::text IS NULL OR data_source=$1) ORDER BY timestamp DESC,id DESC LIMIT 1",
        [config.dataSource ?? null],
      )
    ).rows[0]
    const state = (
      await client.query<{ last_reported_at: Date | null }>(
        'SELECT last_reported_at FROM actuator_states WHERE device_id=$1',
        [config.deviceId],
      )
    ).rows[0]
    const threshold =
      (
        await client.query<{ co2_critical_threshold: number }>(
          'SELECT co2_critical_threshold FROM node_settings WHERE device_id=$1',
          [config.deviceId],
        )
      ).rows[0]?.co2_critical_threshold ?? config.co2CriticalThreshold
    const fresh =
      measurement &&
      now.getTime() - measurement.timestamp.getTime() <=
        config.deviceHeartbeatTimeoutMs &&
      now.getTime() - measurement.timestamp.getTime() >= -5000
    const last = state?.last_reported_at?.getTime()
    const offline =
      last === undefined ||
      last === null ||
      now.getTime() - last > config.deviceHeartbeatTimeoutMs ||
      now.getTime() - last < -5000
    const failed = (
      await client.query<{
        id: string
        target: string
        failure_reason: string | null
      }>(
        `SELECT * FROM (SELECT DISTINCT ON(target) id,target,status,failure_reason FROM actuator_commands WHERE device_id=$1 AND status IN ('applied','failed','expired') ORDER BY target,id DESC) latest WHERE status IN ('failed','expired') ORDER BY id DESC LIMIT 1`,
        [config.deviceId],
      )
    ).rows[0]
    const conditions: Array<{
      kind: string
      bad: boolean | null
      duration: number
      problem: string
      recovery: string
    }> = [
      {
        kind: 'co2_high',
        bad: fresh ? measurement.indoor_co2 >= threshold : null,
        duration: settings.co2_duration_seconds,
        problem: `CO₂ длительно превышает ${threshold} ppm`,
        recovery: 'CO₂ вернулся ниже порога',
      },
      {
        kind: 'device_offline',
        bad: offline,
        duration: settings.offline_duration_seconds,
        problem: 'Связь с устройством потеряна',
        recovery: 'Связь с устройством восстановлена',
      },
      {
        kind: 'command_failed',
        bad: !!failed,
        duration: 0,
        problem: `Команда ${failed?.id ?? ''} не исполнена (${failed?.target ?? ''})${failed?.failure_reason ? ': ' + failed.failure_reason : ''}`,
        recovery: 'Новые команды для проблемных целей подтверждены устройством',
      },
    ]
    for (const condition of conditions) {
      await client.query(
        'INSERT INTO notification_conditions(device_id,kind) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [config.deviceId, condition.kind],
      )
      const previous = (
        await client.query<{
          since_at: Date | null
          active: boolean
          last_alert_at: Date | null
          last_check_at: Date | null
        }>(
          'SELECT * FROM notification_conditions WHERE device_id=$1 AND kind=$2 FOR UPDATE',
          [config.deviceId, condition.kind],
        )
      ).rows[0]
      const before: ConditionState = {
        since: previous.since_at?.getTime() ?? null,
        active: previous.active,
        lastAlert: previous.last_alert_at?.getTime() ?? null,
        lastCheck: previous.last_check_at?.getTime() ?? null,
      }
      const result = stepCondition(
        before,
        condition.bad,
        now.getTime(),
        condition.duration * 1000,
        settings.suppression_seconds * 1000,
        config.deviceHeartbeatTimeoutMs,
      )
      const after = result.state
      await client.query(
        'UPDATE notification_conditions SET since_at=$3,active=$4,last_alert_at=$5,last_check_at=$6 WHERE device_id=$1 AND kind=$2',
        [
          config.deviceId,
          condition.kind,
          after.since === null ? null : new Date(after.since),
          after.active,
          after.lastAlert === null ? null : new Date(after.lastAlert),
          now,
        ],
      )
      if (result.event)
        await recordEvent(
          client,
          settings,
          config.deviceId,
          result.event === 'recovery' ? 'recovery' : condition.kind,
          result.event === 'recovery' ? condition.recovery : condition.problem,
          `${config.deviceId}:${condition.kind}:${result.event}:${result.event === 'problem' ? after.lastAlert : before.lastAlert}`,
          now,
        )
    }
    await client.query(
      "DELETE FROM notification_events WHERE created_at<$1::timestamptz-interval '90 days'",
      [now],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
export async function listEvents(userId: string) {
  const result = await getAuthPool().query(
    `SELECT e.id,e.device_id,e.kind,e.message,e.created_at,e.delivery_status,e.attempts,e.delivery_error,(r.user_id IS NOT NULL) AS read FROM notification_events e LEFT JOIN notification_reads r ON r.event_id=e.id AND r.user_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,
    [userId],
  )
  return result.rows.map((row) => ({ ...row, id: Number(row.id) }))
}
export async function markEventRead(id: number, userId: string) {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new ApiError('invalid_id', 'Неверный ID события', 400)
  const result = await getAuthPool().query(
    'INSERT INTO notification_reads(event_id,user_id) SELECT id,$2 FROM notification_events WHERE id=$1 ON CONFLICT(event_id,user_id) DO UPDATE SET read_at=now()',
    [id, userId],
  )
  if (!result.rowCount)
    throw new ApiError('not_found', 'Событие не найдено', 404)
}
export async function queueChannelTest(chat: unknown) {
  const settings = await notificationSettings()
  if (
    typeof chat !== 'string' ||
    chat !== settings.telegram_chat_id ||
    !settings.token_ciphertext
  )
    throw new ApiError(
      'chat_required',
      'Сначала сохраните токен и явно выберите чат для теста',
      400,
    )
  await recordEvent(
    getAuthPool(),
    settings,
    getConfig().deviceId,
    'channel_test',
    'AirCheck: тест подключения Telegram',
    'test:' + randomUUID(),
    new Date(),
    true,
  )
}
export async function deliverEvents(
  db: Pool = getAuthPool(),
  transport: TelegramTransport = sendTelegram,
  now = new Date(),
) {
  await notificationSettings(db)
  // Claim with an expiring lease. Another process can recover abandoned deliveries.
  const due = await db.query<{
    id: string
    message: string
    kind: string
    destination_chat: string
    attempts: number
  }>(
    `WITH due AS (SELECT id FROM notification_events WHERE delivery_status IN ('pending','sending') AND next_attempt_at<=$1 AND attempts<3 ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED) UPDATE notification_events e SET delivery_status='sending',attempts=attempts+1,next_attempt_at=$1::timestamptz+interval '30 seconds' FROM due WHERE e.id=due.id RETURNING e.id,e.message,e.kind,e.destination_chat,e.attempts`,
    [now],
  )
  for (const event of due.rows) {
    const current = await notificationSettings(db)
    if (
      !current.token_ciphertext ||
      !current.telegram_chat_id ||
      current.telegram_chat_id !== event.destination_chat ||
      (!current.enabled && event.kind !== 'channel_test')
    ) {
      await db.query(
        "UPDATE notification_events SET delivery_status='disabled',next_attempt_at=NULL WHERE id=$1",
        [event.id],
      )
      continue
    }
    try {
      await transport(
        decryptToken(current.token_ciphertext, secret()),
        event.destination_chat,
        event.message,
      )
      await db.query(
        "UPDATE notification_events SET delivery_status='sent',delivered_at=$2,next_attempt_at=NULL,delivery_error=NULL WHERE id=$1",
        [event.id, now],
      )
    } catch {
      await db.query(
        'UPDATE notification_events SET delivery_status=$2,next_attempt_at=$3,delivery_error=$4 WHERE id=$1',
        [
          event.id,
          event.attempts >= 3 ? 'failed' : 'pending',
          event.attempts >= 3
            ? null
            : new Date(now.getTime() + 30_000 * 2 ** (event.attempts - 1)),
          'telegram_unavailable',
        ],
      )
    }
  }
  await db.query(
    "UPDATE notification_events SET delivery_status='failed',delivery_error='delivery_interrupted',next_attempt_at=NULL WHERE delivery_status='sending' AND attempts>=3 AND next_attempt_at<=$1",
    [now],
  )
}
let timer: ReturnType<typeof setInterval> | null = null,
  busy = false
export function startNotificationWorker() {
  if (timer) return
  const run = async () => {
    if (busy) return
    busy = true
    try {
      await refreshEvents()
      await deliverEvents()
    } catch {
      console.error('notification refresh failed')
    } finally {
      busy = false
    }
  }
  void run()
  timer = setInterval(() => void run(), 10_000)
  timer.unref?.()
}
