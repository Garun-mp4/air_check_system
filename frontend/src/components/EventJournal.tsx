'use client'
import React, { useCallback, useEffect, useState } from 'react'
type Event = {
  id: number
  kind: string
  message: string
  created_at: string
  delivery_status: string
  attempts: number
  delivery_error: string | null
  read: boolean
}
export default function EventJournal({
  canView = false,
}: {
  canView?: boolean
}) {
  const [events, setEvents] = useState<Event[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    if (!canView) return
    try {
      const r = await fetch('/api/v1/events', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message)
      setEvents(j.data)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить события')
    } finally {
      setLoading(false)
    }
  }, [canView])
  useEffect(() => {
    void refresh()
    if (!canView) return
    const timer = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(timer)
  }, [refresh, canView])
  async function mark(id: number) {
    try {
      const r = await fetch('/api/v1/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!r.ok) throw new Error('Не удалось отметить событие')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка события')
    }
  }
  const delivery: Record<string, string> = {
    disabled: 'Только журнал',
    pending: 'Ожидает доставки',
    sending: 'Отправляется',
    sent: 'Доставлено',
    failed: 'Доставка не удалась',
  }
  return (
    <section
      className="card extension-panel command-history"
      aria-label="Журнал событий"
    >
      <h3>События</h3>
      {!canView ? (
        <p>
          Для просмотра событий{' '}
          <a href="/login?returnTo=%2F%23controls">войдите в аккаунт</a>.
        </p>
      ) : (
        <>
          <button className="button-secondary" onClick={() => void refresh()}>
            Обновить события
          </button>
          {error ? <p role="alert">{error}</p> : null}
          {loading ? <p role="status">Загрузка событий…</p> : null}
          {!loading && !events.length ? <p>Важных событий пока нет.</p> : null}
          <ul className="event-list">
            {events.map((event) => (
              <li className="command-history-group" key={event.id}>
                <strong>
                  {event.kind === 'recovery'
                    ? 'Восстановление: '
                    : event.kind === 'channel_test'
                      ? 'Тест канала: '
                      : ''}
                  {event.message}
                </strong>
                <p>
                  {new Date(event.created_at).toLocaleString('ru-RU')} ·{' '}
                  {delivery[event.delivery_status]}
                  {event.attempts ? ' · попыток: ' + event.attempts : ''}
                </p>
                {event.delivery_error ? (
                  <p>
                    Канал недоступен или настройки изменены. Событие сохранено.
                  </p>
                ) : null}
                {event.read ? (
                  <span>Прочитано</span>
                ) : (
                  <button
                    className="button-secondary"
                    aria-label={'Отметить событие ' + event.id + ' прочитанным'}
                    onClick={() => void mark(event.id)}
                  >
                    Отметить прочитанным
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
