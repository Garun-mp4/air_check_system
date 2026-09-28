'use client'

import { useEffect, useState } from 'react'

import passwordPolicy from '../../../password-policy.json'
import { getLoginHref } from '../../lib/auth-navigation'
import { getAccessRoleLabel } from '../../lib/access-types'
import ProfileAvatarEditor from './ProfileAvatarEditor'
import PasswordInput from './PasswordInput'
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

function FeedbackMessage({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null
  return (
    <p className={`account-feedback is-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
      {feedback.message}
    </p>
  )
}

export default function AccountPage() {
  const { access, status, refresh } = useAccessSession()
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [profileFeedback, setProfileFeedback] = useState<Feedback | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    setName(access?.name ?? '')
  }, [access?.name])

  async function updateName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName || nextName.length > 80) {
      setProfileFeedback({ tone: 'error', message: 'Имя должно содержать от 1 до 80 символов.' })
      return
    }

    setSavingName(true)
    setProfileFeedback(null)
    try {
      const response = await fetch('/api/auth/update-user', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      })
      if (!response.ok) throw new Error(await responseError(response))
      await refresh()
      setProfileFeedback({ tone: 'success', message: 'Имя профиля сохранено.' })
    } catch (cause) {
      setProfileFeedback({ tone: 'error', message: cause instanceof Error ? cause.message : 'Не удалось обновить имя.' })
    } finally {
      setSavingName(false)
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword.length < passwordPolicy.minimumLength || newPassword.length > passwordPolicy.maximumLength) {
      setPasswordFeedback({
        tone: 'error',
        message: `Новый пароль должен содержать от ${passwordPolicy.minimumLength} до ${passwordPolicy.maximumLength} символов.`,
      })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ tone: 'error', message: 'Новые пароли не совпадают.' })
      return
    }

    setSavingPassword(true)
    setPasswordFeedback(null)
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
      setPasswordFeedback({ tone: 'success', message: 'Пароль изменён. Другие активные сеансы завершены.' })
    } catch (cause) {
      setPasswordFeedback({ tone: 'error', message: cause instanceof Error ? cause.message : 'Не удалось изменить пароль.' })
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
          <h1>Настройки аккаунта</h1>
          <p>Управляйте профилем, доступом и безопасностью учётной записи.</p>
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
            <h2>Войдите, чтобы открыть настройки</h2>
            <p>Гость может просматривать панель и 3D-стенд. Войдите или создайте аккаунт для персональных настроек.</p>
            <a className="account-button account-button-primary" href={getLoginHref('/account')}>Войти или зарегистрироваться</a>
          </section>
        ) : null}

        {status === 'ready' && access?.userId ? (
          <div className="account-settings-layout">
            <nav className="account-settings-nav" aria-label="Разделы настроек аккаунта">
              <a href="#account-profile">Профиль</a>
              <a href="#account-access">Доступ</a>
              <a href="#account-security">Безопасность</a>
            </nav>

            <div className="account-settings-stack">
              <div className="account-profile-overview">
                <section className="account-card account-profile-card" id="account-profile" aria-labelledby="account-profile-title">
                  <div className="account-card-heading">
                    <div><span className="eyebrow">Личные данные</span><h2 id="account-profile-title">Профиль</h2></div>
                  </div>
                  <ProfileAvatarEditor image={access.image} name={access.name?.trim() || access.email || 'Пользователь AirCheck'} />
                  <form className="account-form" onSubmit={(event) => void updateName(event)}>
                    <label>
                      Имя
                      <input autoComplete="name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
                    </label>
                    <div className="account-email-field">
                      <span className="account-field-label">Электронная почта</span>
                      <div className="account-email-value">{access.email || 'Адрес не указан'}</div>
                      <small>Изменение появится после настройки почтового подтверждения.</small>
                    </div>
                    <button className="account-button account-button-primary" type="submit" disabled={savingName || name.trim() === (access.name ?? '')}>
                      {savingName ? 'Сохраняем…' : 'Сохранить имя'}
                    </button>
                    <FeedbackMessage feedback={profileFeedback} />
                  </form>
                </section>

                <section className="account-card account-access-card" id="account-access" aria-labelledby="account-access-title">
                  <div className="account-card-heading">
                    <div><span className="eyebrow">Права учётной записи</span><h2 id="account-access-title">Доступ</h2></div>
                  </div>
                  <p className="account-access-role">{access.role === 'owner' ? 'Владелец' : getAccessRoleLabel(access.role)}</p>
                  <p className="account-access-description">Роль применяется в текущей системе AirCheck.</p>
                  {expiresAt ? (
                    <p className="account-access-expiry">
                      {operatorExpired ? `Права оператора истекли ${formatDate(expiresAt)}.` : `Права оператора действуют до ${formatDate(expiresAt)}.`}
                    </p>
                  ) : access.role === 'operator' ? (
                    <p className="account-access-expiry">Права оператора без срока окончания.</p>
                  ) : null}
                  <p className="account-access-permissions">
                    {access.role === 'owner'
                      ? 'Полный доступ, включая управление учётными записями.'
                      : access.role === 'operator'
                        ? 'Можно управлять устройствами, настройками и демонстрационными сценариями.'
                        : 'Доступен просмотр панели, истории и 3D-стенда. Команды устройствам недоступны.'}
                  </p>
                </section>
              </div>

              <section className="account-card" id="account-security" aria-labelledby="account-password-title">
                <div className="account-card-heading">
                  <div><span className="eyebrow">Защита учётной записи</span><h2 id="account-password-title">Пароль</h2></div>
                </div>
                <p className="account-section-intro">Для смены пароля потребуется подтвердить текущий.</p>
                <form className="account-form" onSubmit={(event) => void changePassword(event)}>
                  <div className="account-password-field">
                    <label htmlFor="account-current-password">Текущий пароль</label>
                    <PasswordInput
                      id="account-current-password"
                      autoComplete="current-password"
                      required
                      maxLength={passwordPolicy.maximumLength}
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                  </div>
                  <div className="account-form-row">
                    <div className="account-password-field">
                      <label htmlFor="account-new-password">Новый пароль</label>
                      <PasswordInput
                        id="account-new-password"
                        autoComplete="new-password"
                        aria-describedby="account-new-password-note"
                        required
                        minLength={passwordPolicy.minimumLength}
                        maxLength={passwordPolicy.maximumLength}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                      />
                      <small id="account-new-password-note">От {passwordPolicy.minimumLength} до {passwordPolicy.maximumLength} символов. Можно использовать пробелы и вставку из менеджера паролей.</small>
                    </div>
                    <div className="account-password-field">
                      <label htmlFor="account-confirm-password">Повторите новый пароль</label>
                      <PasswordInput
                        id="account-confirm-password"
                        autoComplete="new-password"
                        required
                        minLength={passwordPolicy.minimumLength}
                        maxLength={passwordPolicy.maximumLength}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                      />
                    </div>
                  </div>
                  <button className="account-button account-button-primary" type="submit" disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}>
                    {savingPassword ? 'Меняем пароль…' : 'Изменить пароль'}
                  </button>
                  <FeedbackMessage feedback={passwordFeedback} />
                </form>
                <div className="account-security-note">
                  <p>После смены пароля остальные активные сеансы будут завершены.</p>
                  <p>Сброс пароля по электронной почте пока недоступен: почтовый сервис не подключён.</p>
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}
