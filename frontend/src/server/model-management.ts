import { ApiError } from './api'
import { getConfig } from './config'
import { getAuthPool } from './auth'
export async function modelRequest(path: string, payload?: unknown) {
  const token = process.env.ML_MANAGEMENT_TOKEN?.trim()
  if (!token || token.length < 32)
    throw new ApiError(
      'model_management_unconfigured',
      'Настройте ML_MANAGEMENT_TOKEN в backend и ML-сервисе',
      503,
    )
  let response: Response
  try {
    response = await fetch(getConfig().mlServiceUrl + '/management/' + path, {
      method: payload === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    })
    const result = await response.json()
    if (!response.ok)
      throw new ApiError(
        result.error?.code ?? 'model_error',
        result.error?.message ?? 'Ошибка управления моделью',
        response.status,
      )
    return result
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError('ml_unavailable', 'ML-сервис недоступен', 503)
  }
}
export async function operationalQuality() {
  // One actual point per forecast, same declared source, nearest target within ±60s.
  // Predictions whose target is still in the future do not contribute.
  const result = await getAuthPool().query(
    `SELECT p.data_source AS source, p.model_version,
    count(*)::int AS matches, avg(abs(p.predicted_co2-a.indoor_co2)) AS mae,
    sqrt(avg(power(p.predicted_co2-a.indoor_co2,2))) AS rmse
    FROM predictions p JOIN LATERAL (
      SELECT m.indoor_co2 FROM measurements m WHERE m.data_source=p.data_source AND m.timestamp<=clock_timestamp()
      AND m.timestamp BETWEEN p.target_time-interval '60 seconds' AND p.target_time+interval '60 seconds'
      ORDER BY abs(extract(epoch FROM m.timestamp-p.target_time)), m.id LIMIT 1
    ) a ON true WHERE p.source_timestamp IS NOT NULL AND p.target_time<=clock_timestamp()
    AND p.target_time>=clock_timestamp()-($1::double precision*interval '1 hour')
    GROUP BY p.data_source,p.model_version ORDER BY p.data_source,p.model_version`,
    [getConfig().dataRetentionHours],
  )
  return {
    tolerance_seconds: 60,
    retention_hours: getConfig().dataRetentionHours,
    groups: result.rows,
  }
}
