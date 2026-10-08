import { getAuthPool } from './auth'
import { ApiError } from './api'
export const historyMetrics = [
  'co2',
  'temperature',
  'humidity',
  'pm25',
  'outdoor_temperature',
  'outdoor_humidity',
  'outdoor_pm25',
] as const
export type HourStats = {
  bucket: Date | string
  data_source: string
  samples: number | string
  metric_sums: Record<string, number>
  metric_minima: Record<string, number | null>
  metric_maxima: Record<string, number | null>
  covered_seconds: number
  co2_known_seconds: number
  pm25_known_seconds: number
  co2_exceed_seconds: number
  pm25_exceed_seconds: number
  window_seconds: number
  ventilation_seconds: number
  ventilation_known_seconds: number
}
export function summary(rows: HourStats[]) {
  const samples = rows.reduce((total, row) => total + Number(row.samples), 0)
  const metrics = Object.fromEntries(
    historyMetrics.map((key) => {
      const minima = rows
        .map((r) => r.metric_minima[key])
        .filter((v): v is number => v !== null && v !== undefined)
      const maxima = rows
        .map((r) => r.metric_maxima[key])
        .filter((v): v is number => v !== null && v !== undefined)
      return [
        key,
        {
          average: samples
            ? rows.reduce(
                (sum, r) => sum + Number(r.metric_sums[key] ?? 0),
                0,
              ) / samples
            : null,
          min: minima.length ? Math.min(...minima) : null,
          max: maxima.length ? Math.max(...maxima) : null,
        },
      ]
    }),
  )
  const totals = Object.fromEntries(
    [
      'covered_seconds',
      'co2_known_seconds',
      'pm25_known_seconds',
      'co2_exceed_seconds',
      'pm25_exceed_seconds',
      'window_seconds',
      'ventilation_seconds',
      'ventilation_known_seconds',
    ].map((key) => [
      key,
      rows.reduce((sum, r) => sum + Number(r[key as keyof HourStats] ?? 0), 0),
    ]),
  )
  return { samples, metrics, totals }
}
export function parseLongHistory(params: URLSearchParams) {
  const days = Number(params.get('days') ?? 7)
  if (days !== 7 && days !== 30)
    throw new ApiError(
      'invalid_period',
      'Период должен быть 7 или 30 дней',
      400,
    )
  const source = params.get('source') ?? 'all'
  if (!['all', 'real', 'simulator', 'unknown'].includes(source))
    throw new ApiError('invalid_source', 'Неверный источник данных', 400)
  const timezone = params.get('timezone') ?? 'UTC'
  if (timezone.length > 80)
    throw new ApiError('invalid_timezone', 'Неверная временная зона', 400)
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: timezone }).format(new Date())
  } catch {
    throw new ApiError('invalid_timezone', 'Неверная временная зона', 400)
  }
  return { days, source, timezone }
}
export async function longHistory(query: ReturnType<typeof parseLongHistory>) {
  const client = await getAuthPool().connect()
  const now = new Date(),
    end = new Date(Math.ceil(now.getTime() / 3600_000) * 3600_000),
    start = new Date(end.getTime() - query.days * 86400_000),
    previousStart = new Date(start.getTime() - query.days * 86400_000)
  try {
    await client.query('BEGIN')
    await client.query('SELECT refresh_live_air_stats($1)', [now])
    const result = await client.query<HourStats>(
      `SELECT bucket,data_source,sum(samples)::bigint AS samples,
   jsonb_build_object(${historyMetrics.map((k) => `'${k}',sum((metric_sums->>'${k}')::double precision)`).join(',')}) AS metric_sums,
   jsonb_build_object(${historyMetrics.map((k) => `'${k}',min((metric_minima->>'${k}')::double precision)`).join(',')}) AS metric_minima,
   jsonb_build_object(${historyMetrics.map((k) => `'${k}',max((metric_maxima->>'${k}')::double precision)`).join(',')}) AS metric_maxima,
   ${['covered_seconds', 'co2_known_seconds', 'pm25_known_seconds', 'co2_exceed_seconds', 'pm25_exceed_seconds', 'window_seconds', 'ventilation_seconds', 'ventilation_known_seconds'].map((k) => `sum(${k}) AS ${k}`).join(',')}
   FROM (SELECT * FROM archived_air_stats UNION ALL SELECT * FROM live_air_stats) stats
   WHERE bucket>=$1 AND bucket<$2 AND ($3='all' OR data_source=$3) GROUP BY bucket,data_source ORDER BY bucket,data_source`,
      [previousStart, end, query.source],
    )
    await client.query('COMMIT')
    const rows = result.rows.filter((r) => new Date(r.bucket) >= start),
      previous = result.rows.filter((r) => new Date(r.bucket) < start)
    return {
      days: query.days,
      source: query.source,
      timezone: query.timezone,
      bucket_timezone: 'UTC',
      from: start.toISOString(),
      to: now.toISOString(),
      summary: summary(rows),
      previous_summary: summary(previous),
      rows,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
export function historyCsv(data: Awaited<ReturnType<typeof longHistory>>) {
  const fields = [
    'hour_utc',
    'hour_local',
    'timezone',
    'source',
    'samples',
    ...historyMetrics.flatMap((k) => [k + '_average', k + '_min', k + '_max']),
    'coverage_seconds',
    'co2_threshold_known_seconds',
    'pm25_threshold_known_seconds',
    'co2_exceed_seconds',
    'pm25_exceed_seconds',
    'window_seconds',
    'ventilation_seconds',
    'ventilation_known_seconds',
  ]
  const units = [
    'UTC timestamp',
    'local time',
    'IANA timezone',
    'declared source',
    'count',
    ...['ppm', 'degC', '%', 'ug/m3', 'degC', '%', 'ug/m3'].flatMap((u) => [
      u,
      u,
      u,
    ]),
    ...Array(8).fill('s'),
  ]
  const cell = (value: unknown) =>
    '"' + String(value ?? '').replaceAll('"', '""') + '"'
  const records = data.rows.map((row) => {
    const date = new Intl.DateTimeFormat('sv-SE', {
      timeZone: data.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(row.bucket))
    return [
      new Date(row.bucket).toISOString(),
      date,
      data.timezone,
      row.data_source,
      row.samples,
      ...historyMetrics.flatMap((key) => [
        Number(row.samples)
          ? Number(row.metric_sums[key]) / Number(row.samples)
          : null,
        row.metric_minima[key],
        row.metric_maxima[key],
      ]),
      row.covered_seconds,
      row.co2_known_seconds,
      row.pm25_known_seconds,
      row.co2_exceed_seconds,
      row.pm25_exceed_seconds,
      row.window_seconds,
      row.ventilation_seconds,
      row.ventilation_known_seconds,
    ]
  })
  return (
    [fields, units, ...records]
      .map((row) => row.map(cell).join(','))
      .join('\r\n') + '\r\n'
  )
}
