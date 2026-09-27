'use client'

import { useEffect, useState } from 'react'

import { getLoginHref } from '../../lib/auth-navigation'
import { getAccessRoleLabel } from '../../lib/access-types'
import { useAccessSession } from './AccessSessionProvider'
import UtilityHeader from './UtilityHeader'

type Feedback = { tone: 'success' | 'error'; message: string }

async function responseError(response: Response): Promise<string> {
  const result: unknown = await response.json().catch(() => null)
  if (typeof result === 'object' && result !== null && 'message' in result && typeof result.message === 'string') {
    return result.message
  }
  if (typeof result === 'object' && result !== null && 'error' in result) {
    const error = result.error
    if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
      return error.message
    }
  }
  return 'Не удалось выполнить запрос. Проверьте данные и повторите попытку.'
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'дата не указана'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(date)
}

export default function AccountPage() {
  const { access, status, refresh } = useAccessSession()
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    setName(access?.name ?? '')
  }, [access?.name])

  async function updateName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName || nextName.length > 80) {
      setFeedback({ tone: 'error', message: 'Имя должно содержать от 1 до 80 символов.' })
      return
    }

    setSavingName(true)
    setFeedback(null)
    try {
      const response = await fetch('/api/auth/update-user', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      })
      if (!response.ok) throw new Error(await responseError(response))
      await refresh()
      setFeedback({ tone: 'success', message: 'Имя профиля сохранено.' })
    } catch (cause) {
      setFeedback({ tone: 'error', message: cause instanceof Error ? cause.message : 'Не удалось обновить имя.' })
    } finally {
      setSavingName(false)
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword.length < 12 || newPassword.length > 128) {
      setFeedback({ tone: 'error', message: 'Новый пароль должен содержать от 12 до 128 символов.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setFeedback({ tone: 'error', message: 'Новые пароли не совпадают.' })
      return
    }

    setSavingPassword(true)
    setFeedback(null)
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: true }),
      })
      if (!response.ok) throw new Error(await responseError(response))
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      await refresh()
      setFeedback({ tone: 'success', message: 'Пароль изменён. Другие активные сеансы завершены.' })
    } catch (cause) {
      setFeedback({ tone: 'error', message: cause instanceof Error ? cause.message : 'Не удалось изменить пароль.' })
    } finally {
      setSavingPassword(false)
    }
  }

  const expiresAt = access?.operatorExpiresAt
  const operatorExpired = expiresAt !== null && expiresAt !== undefined && new Date(expiresAt).getTime() <= Date.now()

  return (
    <div className="utility-page account-page">
      <UtilityHeader />
      <main className="account-page-content">
        <div className="account-page-heading">
          <span className="eyebrow">Профиль AirCheck</span>
          <h1>Личный кабинет</h1>
          <p>Данные учётной записи и доступ к функциям панели управления.</p>
        </div>

        {status === 'loading' ? <section className="account-card account-state-card" role="status">Проверяем учётную запись…</section> : null}
        {status === 'unavailable' ? (
          <section className="account-card account-state-card account-state-error" role="alert">
            <strong>Не удалось проверить доступ</strong>
            <p>Сведения о профиле и правах временно не загружены. Повторите проверку через несколько секунд.</p>
            <button className="account-button" type="button" onClick={() => void refresh()}>Повторить</button>
          </section>
        ) : null}
        {status === 'ready' && !access?.userId ? (
          <section className="account-card account-state-card">
            <span className="account-role-mark">Гость</span>
            <h2>Войдите, чтобы открыть профиль</h2>
            <p>Гость может просматривать панель и 3D-стенд. Войдите или создайте аккаунт для персонального профиля.</p>
            <a className="account-button account-button-primary" href={getLoginHref('/account')}>Войти или зарегистрироваться</a>
          </section>
        ) : null}

        {status === 'ready' && access?.userId ? (
          <>
            {feedback ? <p className={`account-feedback is-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.message}</p> : null}
            <section className="account-card account-profile-card" aria-labelledby="account-profile-title">
              <div className="account-card-heading">
                <div><span className="eyebrow">Учётная запись</span><h2 id="account-profile-title">Профиль</h2></div>
                <span className="account-role-mark">{getAccessRoleLabel(access.role)}</span>
              </div>
              <form className="account-form" onSubmit={(event) => void updateName(event)}>
                <label>
                  Имя
                  <input autoComplete="name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
                </label>
                <label>
                  Электронная почта
                  <input type="email" value={access.email ?? ''} readOnly aria-describedby="account-email-note" />
                  <small id="account-email-note">Изменение адреса отключено: почтовое подтверждение пока не настроено.</small>
                </label>
                <button className="account-button account-button-primary" type="submit" disabled={savingName || name.trim() === (access.name ?? '')}>
                  {savingName ? 'Сохраняем…' : 'Сохранить имя'}
                </button>
              </form>
              <div className="account-access-summary">
                <div><span>Уровень доступа</span><strong>{getAccessRoleLabel(access.role)}</strong></div>
                {expiresAt ? (
                  <div><span>Права оператора</span><strong>{operatorExpired ? `Истекли ${formatDate(expiresAt)}` : `Действуют до ${formatDate(expiresAt)}`}</strong></div>
                ) : access.role === 'operator' ? (
                  <div><span>Права оператора</span><strong>Без срока окончания</strong></div>
                ) : null}
                <p>{access.role === 'owner'
                  ? 'Полный доступ, включая управление учётными записями.'
                  : access.role === 'operator'
                    ? 'Можно управлять устройствами, настройками и демонстрационными сценариями.'
                    : 'Доступен просмотр панели, истории и 3D-стенда. Команды устройствам недоступны.'}</p>
              </div>
            </section>

            <section className="account-card" aria-labelledby="account-password-title">
              <div className="account-card-heading">
                <div><span className="eyebrow">Безопасность</span><h2 id="account-password-title">Сменить пароль</h2></div>
              </div>
              <form className="account-form" onSubmit={(event) => void changePassword(event)}>
                <label>
                  Текущий пароль
                  <input type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                </label>
                <div className="account-form-row">
                  <label>
                    Новый пароль
                    <input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                    <small>От 12 до 128 символов.</small>
                  </label>
                  <label>
                    Повторите новый пароль
                    <input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                  </label>
                </div>
                <button className="account-button" type="submit" disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}>
                  {savingPassword ? 'Меняем пароль…' : 'Изменить пароль'}
                </button>
              </form>
              <p className="account-security-note">После смены пароля остальные активные сеансы будут завершены. Если вы не помните текущий пароль, восстановление выполняет владелец установки.</p>
            </section>
          </>
        ) : null}
      </main>
    </div>
  )
}
