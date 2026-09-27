'use client'

import { useEffect, useState } from 'react'
import type { InputHTMLAttributes } from 'react'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> & {
  id: string
}

export default function PasswordInput({ id, value, disabled, ...inputProps }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (value === '') setVisible(false)
  }, [value])

  return (
    <div className="password-input-shell">
      <input
        {...inputProps}
        id={id}
        value={value}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        className="password-visibility-toggle"
        type="button"
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-controls={id}
        title={visible ? 'Скрыть пароль' : 'Показать пароль'}
        disabled={disabled}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setVisible((wasVisible) => !wasVisible)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {visible ? (
            <>
              <path d="M3 3 21 21" />
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5.7 0 9.5 7 9.5 7a16 16 0 0 1-3 3.8" />
              <path d="M6.2 6.2C3.9 7.8 2.5 12 2.5 12s3.8 7 9.5 7a10 10 0 0 0 3.2-.5" />
            </>
          ) : (
            <>
              <path d="M2.5 12s3.8-7 9.5-7 9.5 7 9.5 7-3.8 7-9.5 7-9.5-7-9.5-7Z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  )
}
