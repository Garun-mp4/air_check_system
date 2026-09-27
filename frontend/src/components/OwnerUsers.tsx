'use client'

import { useEffect, useState } from 'react'

type ManagedUser = {
  id: string
  email: string
  name: string
  role: 'user' | 'operator' | 'owner'
  operator_expires_at: string | null
  created_at: string
}

async function readJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data
      && typeof data.error === 'object' && data.error !== null && 'message' in data.error
      && typeof data.error.message === 'string'
      ? data.error.message
      : 'Сервер не выполнил запрос'
    throw new Error(message)
  }
  return data as T
}

function toLocalInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export default function OwnerUsers() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)

  async function loadUsers() {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store' })
      const result = await readJson<{ data: ManagedUser[] }>(response)
      setUsers(result.data)
      setMessage(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить пользователей')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadUsers() }, [])

  async function updateRole(user: ManagedUser, role: 'user' | 'operator', expiresAt: string) {
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, expires_at: role === 'operator' && expiresAt ? new Date(expiresAt).toISOString() : null }),
      })
      await readJson(response)
      await loadUsers()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось изменить роль')
    }
  }

  async function deleteUser(user: ManagedUser) {
    if (!window.confirm(`Удалить учётную запись ${user.email}?`)) return
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
      await readJson(response)
      await loadUsers()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось удалить пользователя')
    }
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreating(true)
    setMessage(null)
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      await readJson(response)
      setName('')
      setEmail('')
      setPassword('')
      await loadUsers()
      setMessage('Учётная запись создана. Передайте пользователю пароль безопасным способом.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось создать пользователя')
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="owner-page">
      <div className="owner-page-heading">
        <a className="auth-back" href="/simulator">← К 3D-стенду</a>
        <span className="eyebrow">Только владелец установки</span>
        <h1>Учётные записи</h1>
        <p>Выдача операторских прав, срок доступа и обслуживание аккаунтов.</p>
      </div>
      {message ? <p className="owner-feedback" role="status">{message}</p> : null}
      <form className="owner-create-card" onSubmit={(event) => void createUser(event)}>
        <div><span className="eyebrow">Новый пользователь</span><h2>Создать аккаунт</h2></div>
        <div className="owner-create-fields">
          <label>Имя<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Email<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Временный пароль<input required type="password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="button-primary" disabled={creating}>{creating ? 'Создаём…' : 'Создать'}</button>
        </div>
        <p className="auth-field-note">Email не отправляется: пароль нужно передать пользователю отдельно. Учётная запись создаётся с правами только на просмотр.</p>
      </form>
      <div className="owner-user-list">
        <div className="owner-list-heading"><h2>Пользователи</h2><button className="button-secondary" type="button" onClick={() => void loadUsers()}>Обновить</button></div>
        {loading ? <p className="owner-empty">Загружаем список…</p> : users.length === 0 ? <p className="owner-empty">Список пуст.</p> : users.map((user) => (
          <OwnerUserRow key={user.id} user={user} onSave={updateRole} onDelete={deleteUser} />
        ))}
      </div>
    </section>
  )
}

function OwnerUserRow({
  user,
  onSave,
  onDelete,
}: {
  user: ManagedUser
  onSave: (user: ManagedUser, role: 'user' | 'operator', expiresAt: string) => Promise<void>
  onDelete: (user: ManagedUser) => Promise<void>
}) {
  const [role, setRole] = useState<'user' | 'operator'>(user.role === 'operator' ? 'operator' : 'user')
  const [expiry, setExpiry] = useState(toLocalInput(user.operator_expires_at))
  const owner = user.role === 'owner'
  return (
    <article className="owner-user-row">
      <div className="owner-user-identity">
        <strong>{user.name}</strong>
        <span>{user.email}</span>
        <small>Создан: {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(user.created_at))}</small>
      </div>
      {owner ? <span className="owner-role-chip">Владелец · защищён</span> : (
        <div className="owner-role-editor">
          <label>Доступ
            <select value={role} onChange={(event) => setRole(event.target.value as 'user' | 'operator')}>
              <option value="user">Только просмотр</option>
              <option value="operator">Оператор</option>
            </select>
          </label>
          {role === 'operator' ? <label>Действует до<input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} aria-label="Срок прав оператора, пусто означает бессрочно" /><small>Оставьте пустым для постоянных прав.</small></label> : null}
          <div className="owner-role-actions">
            <button className="button-secondary" type="button" onClick={() => void onSave(user, role, expiry)}>Сохранить права</button>
            <button className="owner-delete-button" type="button" onClick={() => void onDelete(user)}>Удалить</button>
          </div>
        </div>
      )}
    </article>
  )
}
