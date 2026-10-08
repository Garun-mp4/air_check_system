'use client'
import React, { useEffect, useId, useState } from 'react'
import {
  defaultOutdoorPolicy,
  validateOutdoorPolicy,
  type OutdoorPolicy,
} from '../server/outdoor-policy'
import type {
  ClientNodeSettings,
  ClientNodeSettingsPatch,
} from '../lib/client-api'
const fields = [
  ['maxPm25', 'Ограничить при наружном PM2.5, µg/m³'],
  ['pm25Recovery', 'Возобновить при PM2.5 ниже, µg/m³'],
  ['minTemperature', 'Ограничить при температуре, °C'],
  ['temperatureRecovery', 'Возобновить при температуре выше, °C'],
  ['maxAgeSeconds', 'Максимальный возраст наружных данных, секунд'],
] as const
export default function OutdoorPolicyPanel({
  settings,
  canEdit,
  saving,
  onSave,
}: {
  settings: ClientNodeSettings | null
  canEdit: boolean
  saving: boolean
  onSave: (patch: ClientNodeSettingsPatch) => Promise<void>
}) {
  const [draft, setDraft] = useState<OutdoorPolicy>({
    ...defaultOutdoorPolicy,
    ...settings?.outdoor_policy,
  })
  const [dirty, setDirty] = useState(false)
  const id = useId()
  useEffect(() => {
    setDraft({ ...defaultOutdoorPolicy, ...settings?.outdoor_policy })
    setDirty(false)
  }, [settings?.updated_at])
  let error: string | null = null
  try {
    validateOutdoorPolicy(draft)
  } catch (e) {
    error = e instanceof Error ? e.message : 'Проверьте параметры'
  }
  return (
    <form
      className="settings-form-section outdoor-policy"
      aria-label="Правила наружного воздуха"
      onSubmit={(e) => {
        e.preventDefault()
        if (!error && dirty && canEdit) void onSave({ outdoor_policy: draft })
      }}
    >
      <h3>Наружный воздух</h3>
      <p>
        Окно и автоматический приток ограничиваются при загрязнении, холоде или
        отсутствии свежих данных. Раздельные пороги предотвращают частые
        переключения.
      </p>
      <fieldset disabled={!settings || !canEdit || saving}>
        {fields.map(([key, label]) => (
          <label className="settings-number-field" key={key} htmlFor={id + key}>
            <span>{label}</span>
            <input
              className="settings-number-input"
              id={id + key}
              type="number"
              step="1"
              value={Number.isFinite(draft[key]) ? draft[key] : ''}
              onChange={(e) => {
                setDirty(true)
                setDraft({
                  ...draft,
                  [key]: e.target.value === '' ? NaN : Number(e.target.value),
                })
              }}
            />
          </label>
        ))}
        <label className="outdoor-filter-check">
          <input
            type="checkbox"
            checked={draft.filteredIntake}
            onChange={(e) => {
              setDirty(true)
              setDraft({ ...draft, filteredIntake: e.target.checked })
            }}
          />
          Фильтрация притока подтверждена для этой установки
        </label>
        <p>
          Этот параметр разрешает приток при высоком наружном PM2.5, но не при
          низкой температуре. Включайте его только после проверки фильтра.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <button
          className="button-primary"
          type="submit"
          disabled={!dirty || !!error || saving}
        >
          {saving ? 'Сохранение…' : 'Сохранить правила воздуха'}
        </button>
      </fieldset>
    </form>
  )
}
