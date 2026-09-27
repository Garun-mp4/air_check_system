type AuthMode = 'signin' | 'signup'

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_ORIGIN: 'Адрес страницы не разрешён для входа. Откройте AirCheck по настроенному адресу или проверьте список разрешённых источников.',
  INVALID_EMAIL_OR_PASSWORD: 'Неверная почта или пароль.',
  PASSWORD_TOO_SHORT: 'Пароль слишком короткий. Используйте не менее 12 символов.',
  USER_ALREADY_EXISTS: 'Аккаунт с такой почтой уже существует. Войдите или укажите другой адрес.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Аккаунт с такой почтой уже существует. Войдите или укажите другой адрес.',
}

export function getAuthErrorMessage(result: unknown, mode: AuthMode): string {
  if (typeof result === 'object' && result !== null && 'code' in result && typeof result.code === 'string') {
    const message = AUTH_ERROR_MESSAGES[result.code]
    if (message) return message
  }

  return mode === 'signin'
    ? 'Не удалось выполнить вход. Проверьте данные и повторите попытку.'
    : 'Не удалось создать аккаунт. Проверьте данные и повторите попытку.'
}
