'use client'

import { useEffect, useRef } from 'react'
import type { SyntheticEvent } from 'react'

export default function AccountSignOutDialog({
  open,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return

    if (!dialog.open) dialog.showModal()
    cancelButtonRef.current?.focus()

    return () => {
      if (dialog.open) dialog.close()
    }
  }, [open])

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault()
    if (!busy) onCancel()
  }

  return open ? (
    <dialog
      ref={dialogRef}
      className="account-signout-dialog"
      aria-modal="true"
      aria-labelledby="account-signout-title"
      aria-describedby="account-signout-description"
      aria-busy={busy}
      onCancel={handleCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div className="account-signout-dialog-content">
        <span className="eyebrow">Завершение сеанса</span>
        <h2 id="account-signout-title">Выйти из аккаунта?</h2>
        <p id="account-signout-description">Вы точно хотите выйти из аккаунта AirCheck? Для продолжения работы потребуется снова войти.</p>
        {error ? <p className="account-feedback is-error account-signout-error" role="alert">{error}</p> : null}
        <div className="account-signout-actions">
          <button ref={cancelButtonRef} className="account-button" type="button" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button className="account-button account-button-danger" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Выходим…' : 'Выйти'}
          </button>
        </div>
      </div>
    </dialog>
  ) : null
}
