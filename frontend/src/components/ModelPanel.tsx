'use client'
import React, { useCallback, useEffect, useState } from 'react'
type Metrics = { mae: number; rmse: number }
type Training = {
  horizon_minutes?: number
  baseline?: Metrics
  beats_baseline?: boolean
  source: string
  train_rows: number
  test_rows: number
  data_from: string
  data_to: string
  models: Record<string, Metrics>
  selected_model: string
}
type ModelStatus = {
  configured_horizon_minutes?: number
  model: {
    status: string
    model_version?: string
    trained_at?: string
    training?: Training
  }
  job: { id: string; status: string; error?: string; source: string } | null
  rollback_available: boolean
  quality: {
    retention_hours: number
    groups: Array<
      Metrics & { source: string; model_version: string; matches: number }
    >
  }
}
export default function ModelPanel({
  canTrain = false,
}: {
  canTrain?: boolean
}) {
  const [data, setData] = useState<ModelStatus | null>(null),
    [error, setError] = useState(''),
    [source, setSource] = useState('real'),
    [busy, setBusy] = useState(false)
  const [readiness, setReadiness] = useState<{ ready: boolean; span_hours: number; training_rows: number; rejected: number; reasons: string[]; next_steps: string[] } | null>(null)
  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/model', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message)
      setData(j.data)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка ML')
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [refresh])
  async function action(action: string) {
    setBusy(true)
    try {
      const r = await fetch('/api/v1/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, source }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message)
      if (action === 'readiness') setReadiness(j.data)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка ML')
    } finally {
      setBusy(false)
    }
  }
  const working =
    busy || data?.job?.status === 'queued' || data?.job?.status === 'running'
  const training = data?.model.training
  const labels: Record<string, string> = {
    queued: 'В очереди',
    running: 'Обучение',
    succeeded: 'Обучение завершено',
    failed: 'Ошибка обучения',
  }
  const sources: Record<string, string> = {
    real: 'Реальные измерения',
    simulator: 'Синтетические данные симулятора',
    unknown: 'Старые данные: источник неизвестен',
  }
  return (
    <section
      className="card outdoor-policy extension-panel"
      aria-label="Управление ML-моделью"
    >
      <h3>ML-модель</h3>
      {error ? (
        <p role="alert" className="control-feedback">
          {error}
        </p>
      ) : null}
      {!data && !error ? <p role="status">Загрузка модели…</p> : null}
      {data ? (
        <>
          <p>
            Состояние: {data.model.status === 'ready' ? 'Готова' : 'Не обучена'}{' '}
            · Версия: {data.model.model_version ?? '—'}
          </p>
          <p>
            Обучена:{' '}
            {data.model.trained_at
              ? new Date(data.model.trained_at).toLocaleString('ru-RU')
              : '—'}
          </p>
          {training ? (
            <>
              <p>
                {sources[training.source]} · {training.train_rows} обучающих /{' '}
                {training.test_rows} проверочных строк
              </p>
              <p>
                {training.data_from} — {training.data_to}
              </p>
              <p>
                Метрики обучения: MAE{' '}
                {training.models[training.selected_model].mae.toFixed(1)} ppm ·
                RMSE {training.models[training.selected_model].rmse.toFixed(1)}{' '}
                ppm
              </p>
            </>
          ) : null}
          <p role="status">
            Последнее обучение:{' '}
            <span>
              {busy
                ? 'Отправляем запрос…'
                : data.job
                  ? labels[data.job.status]
                  : 'Обучение не запускалось'}
            </span>
          </p>
          <p>Горизонт прогноза: {data.configured_horizon_minutes ?? 15} мин.</p>
          {training?.baseline ? <p>Baseline «текущее CO₂»: RMSE {training.baseline.rmse.toFixed(1)} ppm. {training.beats_baseline ? 'Модель улучшает RMSE минимум на 5%.' : 'Улучшение не подтверждено.'}</p> : null}
          {data.job?.error ? <p role="alert">{data.job.error}</p> : null}
          <p>
            Качество эксплуатации за доступные {data.quality.retention_hours} ч;
            соответствие цели ±60 секунд:
          </p>
          {data.quality.groups.length ? (
            data.quality.groups.map((g) => (
              <p key={g.source + g.model_version}>
                {sources[g.source]} · {g.model_version}: {g.matches}{' '}
                сопоставлений · MAE {Number(g.mae).toFixed(1)} ppm · RMSE{' '}
                {Number(g.rmse).toFixed(1)} ppm
              </p>
            ))
          ) : (
            <p>Подходящих фактических измерений пока нет.</p>
          )}
        </>
      ) : null}
      <label>
        Данные для обучения{' '}
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          disabled={working || !canTrain}
        >
          {Object.entries(sources).map(([key, label]) => (
            <option key={key} value={key}>
              {key === 'simulator'
                ? 'Симулятор (синтетические)'
                : key === 'unknown'
                  ? 'Источник неизвестен'
                  : label}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-form-actions">
        <button className="button-secondary" disabled={working || !canTrain || !data} onClick={() => void action('readiness')}>Проверить данные</button>
        <button
          className="button-primary"
          disabled={working || !canTrain || !data}
          onClick={() => void action('train')}
        >
          Обучить модель
        </button>
        <button
          className="button-secondary"
          disabled={working || !canTrain || !data?.rollback_available}
          onClick={() => void action('rollback')}
        >
          Вернуть предыдущую модель
        </button>
      </div>
      {readiness ? <div role="status"><p>{readiness.ready ? 'Данные допускают обучение кандидата.' : 'Данные пока не готовы.'} {readiness.span_hours} ч · {readiness.training_rows} строк · отклонено {readiness.rejected}.</p>{readiness.reasons.concat(readiness.next_steps).map(reason => <p key={reason}>{reason}</p>)}</div> : null}
      {!canTrain ? (
        <p>Запуск обучения и возврат версии доступны владельцу.</p>
      ) : null}
    </section>
  )
}
