'use client'
import React, { useEffect, useState } from 'react'
type Settings = {
  enabled: boolean
  co2_duration_seconds: number
  offline_duration_seconds: number
  suppression_seconds: number
  telegram_chat_id: string | null
  token_configured: boolean
}
export default function NotificationPanel({
  canManage = false,
}: {
  canManage?: boolean
}) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [token, setToken] = useState(''),
    [clear, setClear] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!canManage) return
    const controller = new AbortController()
    fetch('/api/v1/notifications', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error?.message)
        setSettings(j.data)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [canManage])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const r = await fetch('/api/v1/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          token_configured: undefined,
          ...(token ? { bot_token: token } : {}),
          clear_token: clear,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message)
      setSettings(j.data)
      setToken('')
      setClear(false)
      setNotice('Настройки уведомлений сохранены')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить канал')
    } finally {
      setBusy(false)
    }
  }
  async function test() {
    if (!settings) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/v1/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: settings.telegram_chat_id }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message)
      setNotice(
        'Тест поставлен в очередь выбранного чата. Результат появится в журнале событий.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка теста канала')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="card extension-panel"
      aria-label="Настройки уведомлений"
    >
      <h3>Уведомления и Telegram</h3>
      <p>
        Журнал событий работает без внешнего канала. Настройку канала меняет
        владелец.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!canManage ? (
        <p>Внешний канал доступен для настройки владельцу.</p>
      ) : !settings ? (
        <p role="status">Загрузка настроек уведомлений…</p>
      ) : (
        <form onSubmit={(e) => void save(e)}>
          <fieldset className="notification-fields" disabled={busy}>
            <label className="outdoor-filter-check">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) =>
                  setSettings({ ...settings, enabled: e.target.checked })
                }
              />
              Отправлять внешние уведомления
            </label>
            {(
              [
                ['co2_duration_seconds', 'Длительность превышения CO₂, сек'],
                ['offline_duration_seconds', 'Длительность потери связи, сек'],
                ['suppression_seconds', 'Подавление повторов, сек'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={key === 'suppression_seconds' ? 0 : 1}
                  max={86400}
                  required
                  value={settings[key]}
                  onChange={(e) =>
                    setSettings({ ...settings, [key]: e.target.valueAsNumber })
                  }
                />
              </label>
            ))}
            <label>
              Telegram Chat ID
              <input
                type="text"
                inputMode="numeric"
                value={settings.telegram_chat_id ?? ''}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    telegram_chat_id: e.target.value || null,
                  })
                }
              />
            </label>
            <label>
              Новый токен Telegram-бота
              <input
                type="password"
                autoComplete="new-password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <p>
              {settings.token_configured
                ? 'Токен сохранён; его значение не возвращается в панель.'
                : 'Токен не настроен.'}
            </p>
            <label className="outdoor-filter-check">
              <input
                type="checkbox"
                checked={clear}
                onChange={(e) => setClear(e.target.checked)}
              />
              Удалить сохранённый токен
            </label>
            <div className="settings-form-actions">
              <button className="button-primary" type="submit">
                Сохранить уведомления
              </button>
              <button
                className="button-secondary"
                type="button"
                disabled={
                  !settings.token_configured || !settings.telegram_chat_id
                }
                onClick={() => void test()}
              >
                Отправить тест в выбранный чат
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}
