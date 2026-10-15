'use client'
import React from 'react'
import type { DashboardDiagnostics } from '../server/types'
export const predictionStatusLabels: Record<
  DashboardDiagnostics['prediction'],
  string
> = {
  ready: 'Прогноз готов',
  pending: 'Ожидание прогноза',
  insufficient_history: 'Недостаточно истории',
  model_untrained: 'Модель не обучена',
  unavailable: 'Прогноз недоступен',
  error: 'Ошибка ответа ML',
  legacy: 'Старый прогноз без связи с измерением',
  stale: 'Прогноз устарел',
}
export default function DataStatus({
  diagnostics,
}: {
  diagnostics?: DashboardDiagnostics
}) {
  if (!diagnostics) return null
  return (
    <aside
      className="control-feedback data-status"
      aria-label="Актуальность данных"
      role="status"
    >
      <strong>
        {diagnostics.measurement === 'missing'
          ? 'Измерений пока нет'
          : diagnostics.measurement === 'stale'
            ? 'Измерения устарели'
            : diagnostics.measurement === 'partial'
              ? 'Часть каналов недоступна'
              : 'Измерения актуальны'}
      </strong>
      <span>
        Устройство:{' '}
        {diagnostics.device === 'online'
          ? 'на связи'
          : diagnostics.device === 'stale'
            ? 'связь нестабильна'
            : 'не на связи'}
      </span>
      <span>{predictionStatusLabels[diagnostics.prediction]}</span>
      {diagnostics.measuredAt ? (
        <span>
          Измерено: {new Date(diagnostics.measuredAt).toLocaleString('ru-RU')}
        </span>
      ) : null}
      {diagnostics.predictionMessage ? (
        <span>{diagnostics.predictionMessage}</span>
      ) : null}
    </aside>
  )
}
