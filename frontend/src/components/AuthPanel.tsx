'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { getSafeReturnPath } from '../lib/auth-navigation'
import { useAccessSession } from './auth/AccessSessionProvider'
import UtilityHeader from './auth/UtilityHeader'

type AuthMode = 'signin' | 'signup'

export default function AuthPanel() {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const router = useRouter()
  const { refresh } = useAccessSession()

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const path = mode === 'signin' ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email'
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'signin' ? { email, password } : { email, password, name }),
      })
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message = typeof result === 'object' && result !== null && 'message' in result && typeof result.message === 'string'
          ? result.message
          : 'Не удалось выполнить вход. Проверьте данные и повторите попытку.'
        throw new Error(message)
      }
      await refresh()
      const returnTo = new URLSearchParams(window.location.search).get('returnTo')
      router.replace(getSafeReturnPath(returnTo))
      router.refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось выполнить вход')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="utility-page auth-layout">
      <UtilityHeader />
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-title">
          <a className="auth-back" href="/">← К панели AirCheck</a>
          <span className="eyebrow">AirCheck · локальная установка</span>
          <h1 id="auth-title">{mode === 'signin' ? 'Вход в панель' : 'Создать аккаунт'}</h1>
          <p className="auth-intro">
            {mode === 'signin'
              ? 'После входа вы вернётесь к выбранному разделу панели.'
              : 'Новый аккаунт получает доступ только к просмотру. Права оператора выдаёт владелец установки.'}
          </p>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {mode === 'signup' ? (
              <label>
                Имя
                <input autoComplete="name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            ) : null}
            <label>
              Электронная почта
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Пароль
              <input
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {mode === 'signup' ? <span className="auth-field-note">Не менее 12 символов.</span> : null}
            </label>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button className="button-primary auth-submit" type="submit" disabled={pending}>
              {pending ? 'Подождите…' : mode === 'signin' ? 'Войти' : 'Зарегистрироваться'}
            </button>
          </form>
          <p className="auth-switch">
            {mode === 'signin' ? 'Первый вход?' : 'Уже есть аккаунт?'}{' '}
            <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}>
              {mode === 'signin' ? 'Создать аккаунт' : 'Войти'}
            </button>
          </p>
          <p className="auth-recovery">Восстановление доступа выполняет владелец установки через локальную административную команду.</p>
        </section>
      </main>
    </div>
  )
}
