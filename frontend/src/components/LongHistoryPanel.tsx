'use client'
import React, { useEffect, useState } from 'react'
import type { HourStats } from '../server/long-history'
type Summary = {
  samples: number
  metrics: Record<
    string,
    { average: number | null; min: number | null; max: number | null }
  >
  totals: Record<string, number>
}
type History = {
  from: string
  to: string
  summary: Summary
  previous_summary: Summary
  rows: HourStats[]
}
export default function LongHistoryPanel() {
  const [metric, setMetric] = useState('co2')
  const metricLabels: Record<string, [string, string]> = {
    co2: ['CO₂', 'ppm'],
    temperature: ['Температура внутри', '°C'],
    humidity: ['Влажность внутри', '%'],
    pm25: ['PM2.5 внутри', 'мкг/м³'],
    outdoor_temperature: ['Температура снаружи', '°C'],
    outdoor_humidity: ['Влажность снаружи', '%'],
    outdoor_pm25: ['PM2.5 снаружи', 'мкг/м³'],
  }
  const [days, setDays] = useState(7),
    [source, setSource] = useState('simulator'),
    [timezone, setTimezone] = useState('UTC'),
    [data, setData] = useState<History | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  const params = new URLSearchParams({ days: String(days), source, timezone })
  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setError('')
    setData(null)
    fetch(
      '/api/v1/history?' +
        new URLSearchParams({ days: String(days), source, timezone }),
      { signal: abort.signal, cache: 'no-store' },
    )
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error?.message)
        setData(j.data)
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [days, source, timezone])
  const totalSeconds = data
    ? (new Date(data.to).getTime() - new Date(data.from).getTime()) / 1000
    : 0
  const coverage =
    data && totalSeconds
      ? Math.min(
          100,
          (100 * data.summary.totals.covered_seconds) / totalSeconds,
        )
      : 0
  const current = data?.summary.metrics[metric].average,
    previous = data?.previous_summary.metrics[metric].average
  const daily = new Map<string, { sum: number; samples: number }>()
  for (const row of data?.rows ?? []) {
    const day = new Date(row.bucket).toISOString().slice(0, 10)
    const aggregate = daily.get(day) ?? { sum: 0, samples: 0 }
    aggregate.sum += row.metric_sums.co2
    aggregate.samples += Number(row.samples)
    daily.set(day, aggregate)
  }
  const max = Math.max(
    1000,
    ...[...daily.values()].map((d) => (d.samples ? d.sum / d.samples : 0)),
  )
  return (
    <section
      className="card extension-panel long-history"
      aria-label="Долгосрочная история"
    >
      <h3>История за неделю и месяц</h3>
      <div className="settings-form-actions">
        {[7, 30].map((n) => (
          <button
            key={n}
            type="button"
            className={days === n ? 'button-primary' : 'button-secondary'}
            aria-pressed={days === n}
            onClick={() => setDays(n)}
          >
            {n} дней
          </button>
        ))}
      </div>
      <label>
        Источник истории{' '}
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="simulator">Симулятор (синтетические)</option>
          <option value="real">Реальные измерения</option>
          <option value="unknown">Неизвестный источник</option>
        </select>
      </label>
      <label>
        Временная зона экспорта{' '}
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((v) => (
              <option key={v}>{v}</option>
            ))}
        </select>
      </label>
      <label>
        Показатель сводки{' '}
        <select value={metric} onChange={(e) => setMetric(e.target.value)}>
          {Object.entries(metricLabels).map(([key, [label]]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {loading ? <p role="status">Загрузка архива…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {data ? (
        <>
          <p>
            {data.summary.samples} точек · покрытие {coverage.toFixed(1)}%.
            Пропуски не считаются нормальным воздухом.
          </p>
          <p>
            {metricLabels[metric][0]}: среднее {current?.toFixed(1) ?? '—'}{' '}
            {metricLabels[metric][1]} · min{' '}
            {data.summary.metrics[metric].min?.toFixed(1) ?? '—'} · max{' '}
            {data.summary.metrics[metric].max?.toFixed(1) ?? '—'}
          </p>
          <p>
            Предыдущие {days} дней: {previous?.toFixed(1) ?? '—'}{' '}
            {metricLabels[metric][1]} · разница{' '}
            {current != null && previous != null
              ? (current - previous).toFixed(1)
              : '—'}{' '}
            {metricLabels[metric][1]}
          </p>
          <p>
            Превышение CO₂:{' '}
            {data.summary.totals.co2_known_seconds
              ? (data.summary.totals.co2_exceed_seconds / 60).toFixed(1) +
                ' мин'
              : 'неизвестно'}{' '}
            · PM2.5:{' '}
            {data.summary.totals.pm25_known_seconds
              ? (data.summary.totals.pm25_exceed_seconds / 60).toFixed(1) +
                ' мин'
              : 'неизвестно'}
            . Порог CO₂ известен для{' '}
            {(data.summary.totals.co2_known_seconds / 60).toFixed(1)} мин, PM2.5
            — для {(data.summary.totals.pm25_known_seconds / 60).toFixed(1)} мин
            покрытия.
          </p>
          <p>
            Открытое окно:{' '}
            {(data.summary.totals.window_seconds / 60).toFixed(1)} мин ·
            вентиляция:{' '}
            {data.summary.totals.ventilation_known_seconds
              ? (data.summary.totals.ventilation_seconds / 60).toFixed(1) +
                ' мин'
              : 'неизвестно'}
            . Состояние вентиляции известно для{' '}
            {(data.summary.totals.ventilation_known_seconds / 60).toFixed(1)}{' '}
            мин.
          </p>
          {data.summary.samples ? (
            <figure
              className="history-bars"
              aria-label="Средний CO₂ по дням UTC"
            >
              <figcaption>Средний CO₂ по дням (UTC)</figcaption>
              {[...daily].map(([day, value]) => (
                <div key={day} className="history-bar-row">
                  <span>{day}</span>
                  <span
                    className="history-bar"
                    style={{
                      width:
                        (value.samples
                          ? (value.sum / value.samples / max) * 100
                          : 0) + '%',
                    }}
                  />
                  <span>
                    {value.samples
                      ? (value.sum / value.samples).toFixed(0)
                      : '—'}{' '}
                    ppm
                  </span>
                </div>
              ))}
            </figure>
          ) : (
            <p>
              За этот период данных нет. Удалённая до внедрения архива история
              не восстанавливается.
            </p>
          )}
          <a
            className="button-secondary"
            href={'/api/v1/history?' + params + '&format=csv'}
            download
          >
            Скачать CSV
          </a>
        </>
      ) : null}
    </section>
  )
}
