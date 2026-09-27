import { describe, expect, it } from 'vitest'

import { getAuthErrorMessage } from './auth-errors'

describe('authentication error messages', () => {
  it('explains a rejected origin in Russian', () => {
    expect(getAuthErrorMessage({ code: 'INVALID_ORIGIN', message: 'Invalid origin' }, 'signin').toLocaleLowerCase()).toContain('адрес')
    expect(getAuthErrorMessage({ code: 'INVALID_ORIGIN', message: 'Invalid origin' }, 'signin')).not.toContain('Invalid origin')
  })

  it('uses a generic credential error that does not reveal whether an account exists', () => {
    expect(getAuthErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 'signin')).toBe('Неверная почта или пароль.')
  })

  it('uses a Russian fallback for unrecognized errors', () => {
    expect(getAuthErrorMessage({ message: 'Internal Server Error' }, 'signup')).toContain('создать аккаунт')
  })
})
