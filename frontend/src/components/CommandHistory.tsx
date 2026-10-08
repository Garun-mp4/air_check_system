'use client'
import React, { useState } from 'react'
import {
  commandAction,
  type ClientControlStatus,
  type ClientControlCommand,
} from '../lib/client-api'

const labels: Record<ClientControlCommand['status'], string> = {
  pending: 'Ожидает устройства',
  applied: 'Исполнено',
  failed: 'Ошибка устройства',
  cancelled: 'Отменено',
  expired: 'Срок истёк',
}
const targets = { exhaust: 'Вытяжка', intake: 'Приток', window: 'Окно' }
export default function CommandHistory({
  controls,
  canOperate,
  onUpdated,
}: {
  controls: ClientControlStatus | null
  canOperate: boolean
  onUpdated: (status: ClientControlStatus) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const groups = new Map<string, ClientControlCommand[]>()
  for (const command of controls?.recent_commands ?? []) {
    groups.set(command.batch_id, [
      ...(groups.get(command.batch_id) ?? []),
      command,
    ])
  }
  async function act(id: number, action: 'cancel' | 'retry', batch: string) {
    if (!controls || busy) return
    setBusy(batch)
    setError(null)
    try {
      onUpdated(
        (await commandAction(id, action, controls.device_id)).data.controls,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось изменить команду')
    } finally {
      setBusy(null)
    }
  }
  return (
    <article
      className="dashboard-card command-history"
      aria-label="История команд"
    >
      <h3>История команд</h3>
      {error ? <p role="alert">{error}</p> : null}
      {!controls ? (
        <p>Ожидание состояния узла.</p>
      ) : groups.size === 0 ? (
        <p>Команд пока нет.</p>
      ) : null}
      {[...groups.entries()].map(([batch, commands]) => {
        const applied = commands.filter((c) => c.status === 'applied').length
        const pending = commands.some((c) => c.status === 'pending')
        return (
          <div key={batch} className="command-history-group">
            <p>
              {new Date(commands[0].created_at).toLocaleString('ru-RU')} ·{' '}
              {commands[0].source === 'manual' ? 'Оператор' : 'Автоматика'} ·
              Исполнено {applied} из {commands.length}
              {applied > 0 && applied < commands.length
                ? ' · Частичное выполнение'
                : ''}
            </p>
            <ul>
              {commands.map((c) => (
                <li key={c.id}>
                  <strong>
                    {targets[c.target]}:{' '}
                    {c.target === 'window'
                      ? c.desired_state
                        ? 'открыть'
                        : 'закрыть'
                      : c.desired_state
                        ? 'включить'
                        : 'выключить'}
                  </strong>
                  <span className={'command-status command-status-' + c.status}>
                    {labels[c.status]}
                  </span>
                  {c.failure_reason ? <span>{c.failure_reason}</span> : null}
                  {c.status === 'pending' && c.expires_at ? (
                    <span>
                      Действует до{' '}
                      {new Date(c.expires_at).toLocaleTimeString('ru-RU')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {canOperate && (pending || applied < commands.length) ? (
              <button
                type="button"
                className="button-secondary"
                disabled={busy !== null}
                onClick={() =>
                  void act(commands[0].id, pending ? 'cancel' : 'retry', batch)
                }
              >
                {busy === batch
                  ? 'Сохраняем…'
                  : pending
                    ? 'Отменить группу'
                    : 'Повторить неисполненные'}
              </button>
            ) : null}
          </div>
        )
      })}
    </article>
  )
}
