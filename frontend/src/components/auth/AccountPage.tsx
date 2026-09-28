'use client'

import { useEffect, useRef, useState } from 'react'

import passwordPolicy from '../../../password-policy.json'
import { getLoginHref } from '../../lib/auth-navigation'
import { getAccessRoleLabel } from '../../lib/access-types'
import ProfileAvatarEditor from './ProfileAvatarEditor'
import PasswordInput from './PasswordInput'
import { useAccessSession } from './AccessSessionProvider'
import UtilityHeader from './UtilityHeader'

type Feedback = { tone: 'success' | 'error'; message: string }
type AccountSection = 'profile' | 'access' | 'security'
type TabOrientation = 'horizontal' | 'vertical'

const accountSections: AccountSection[] = ['profile', 'access', 'security']
const accountSectionLabels: Record<AccountSection, string> = {
  profile: 'Профиль',
  access: 'Доступ',
  security: 'Безопасность',
}

const legacyAccountSections: Record<string, AccountSection> = {
  '#account-profile': 'profile',
  '#account-access': 'access',
  '#account-security': 'security',
}

function readAccountSectionFromLocation(): AccountSection {
  const url = new URL(window.location.href)
  const querySection = url.searchParams.get('section')
  if (accountSections.includes(querySection as AccountSection)) return querySection as AccountSection

  const legacySection = legacyAccountSections[url.hash]
  const section = legacySection ?? 'profile'
  if (legacySection || querySection) {
    url.searchParams.set('section', section)
    if (legacySection) url.hash = ''
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  return section
}

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
  const [activeSection, setActiveSection] = useState<AccountSection>('profile')
  const [tabOrientation, setTabOrientation] = useState<TabOrientation>('vertical')
  const tabRefs = useRef<Partial<Record<AccountSection, HTMLButtonElement>>>({})

  useEffect(() => {
    setName(access?.name ?? '')
  }, [access?.name])

  useEffect(() => {
    setActiveSection(readAccountSectionFromLocation())

    function handlePopState() {
      setActiveSection(readAccountSectionFromLocation())
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const breakpoint = window.matchMedia('(max-width: 900px)')
    const updateOrientation = () => setTabOrientation(breakpoint.matches ? 'horizontal' : 'vertical')
    updateOrientation()
    breakpoint.addEventListener('change', updateOrientation)
    return () => breakpoint.removeEventListener('change', updateOrientation)
  }, [])

  function selectSection(section: AccountSection) {
    if (section === activeSection) return

    const url = new URL(window.location.href)
    url.searchParams.set('section', section)
    url.hash = ''
    window.history.pushState(window.history.state, '', `${url.pathname}${url.search}`)
    setActiveSection(section)
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, section: AccountSection) {
    const currentIndex = accountSections.indexOf(section)
    let nextIndex = currentIndex

    if (tabOrientation === 'vertical' && event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % accountSections.length
    else if (tabOrientation === 'vertical' && event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + accountSections.length) % accountSections.length
    else if (tabOrientation === 'horizontal' && event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % accountSections.length
    else if (tabOrientation === 'horizontal' && event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + accountSections.length) % accountSections.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = accountSections.length - 1
    else return

    event.preventDefault()
    const nextSection = accountSections[nextIndex]
    tabRefs.current[nextSection]?.focus()
    selectSection(nextSection)
  }

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
            <div className="account-settings-nav" role="tablist" aria-label="Разделы настроек аккаунта" aria-orientation={tabOrientation}>
              {accountSections.map((section) => {
                return (
                  <button
                    key={section}
                    ref={(element) => {
                      if (element) tabRefs.current[section] = element
                      else delete tabRefs.current[section]
                    }}
                    className="account-settings-tab"
                    type="button"
                    role="tab"
                    id={`account-tab-${section}`}
                    aria-controls={`account-${section}`}
                    aria-selected={activeSection === section}
                    tabIndex={activeSection === section ? 0 : -1}
                    onClick={() => selectSection(section)}
                    onKeyDown={(event) => handleTabKeyDown(event, section)}
                  >
                    {accountSectionLabels[section]}
                  </button>
                )
              })}
            </div>

            <div className="account-settings-stack">
              <section
                className="account-card account-profile-card account-settings-panel"
                id="account-profile"
                role="tabpanel"
                aria-labelledby="account-tab-profile"
                tabIndex={activeSection === 'profile' ? 0 : -1}
                hidden={activeSection !== 'profile'}
              >
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

              <section
                className="account-card account-access-card account-settings-panel"
                id="account-access"
                role="tabpanel"
                aria-labelledby="account-tab-access"
                tabIndex={activeSection === 'access' ? 0 : -1}
                hidden={activeSection !== 'access'}
              >
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

              <section
                className="account-card account-settings-panel"
                id="account-security"
                role="tabpanel"
                aria-labelledby="account-tab-security"
                tabIndex={activeSection === 'security' ? 0 : -1}
                hidden={activeSection !== 'security'}
              >
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
