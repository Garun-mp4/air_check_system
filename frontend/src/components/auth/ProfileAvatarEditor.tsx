'use client'

import { useEffect, useRef, useState } from 'react'

import {
  AVATAR_IMAGE_HEADER_BYTES,
  AVATAR_INPUT_TYPES,
  parseImageDimensions,
  validateAvatarSource,
} from '../../lib/avatar-image'
import { useAccessSession } from './AccessSessionProvider'
import AvatarCropDialog from './AvatarCropDialog'
import type { AvatarSourceImage } from './AvatarCropDialog'
import UserAvatar from './UserAvatar'

type Feedback = { tone: 'success' | 'error'; message: string }

async function responseError(response: Response): Promise<string> {
  const result: unknown = await response.json().catch(() => null)
  if (typeof result === 'object' && result !== null && 'error' in result) {
    const error = result.error
    if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
      return error.message
    }
  }
  return 'Не удалось установить аватар. Проверьте соединение и повторите попытку.'
}

function loadImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new window.Image()
    image.decoding = 'async'
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Не удалось открыть изображение. Выберите другой файл.'))
    image.src = url
  })
}

export default function ProfileAvatarEditor({ image, name }: { image: string | null; name: string }) {
  const { refresh } = useAccessSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const sourceUrlRef = useRef<string | null>(null)
  const selectionSequence = useRef(0)
  const [source, setSource] = useState<AvatarSourceImage | null>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => () => {
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current)
  }, [])

  function clearSource() {
    selectionSequence.current += 1
    const currentUrl = sourceUrlRef.current
    sourceUrlRef.current = null
    setSource(null)
    if (currentUrl) URL.revokeObjectURL(currentUrl)
  }

  async function selectImage(file: File) {
    setFeedback(null)
    const sequence = ++selectionSequence.current
    const basicError = validateAvatarSource(file, { width: 1, height: 1 })
    if (basicError) {
      setFeedback({ tone: 'error', message: basicError })
      return
    }

    let objectUrl: string | null = null
    try {
      const header = new Uint8Array(await file.slice(0, AVATAR_IMAGE_HEADER_BYTES).arrayBuffer())
      const dimensions = parseImageDimensions(header, file.type)
      const headerError = validateAvatarSource(file, dimensions)
      if (headerError) throw new Error(headerError)

      objectUrl = URL.createObjectURL(file)
      const decodedDimensions = await loadImage(objectUrl)
      if (sequence !== selectionSequence.current) {
        URL.revokeObjectURL(objectUrl)
        return
      }
      const decodedError = validateAvatarSource(file, decodedDimensions)
      if (decodedError) throw new Error(decodedError)

      const previousUrl = sourceUrlRef.current
      const activeUrl = objectUrl
      sourceUrlRef.current = activeUrl
      objectUrl = null
      setSource({ ...decodedDimensions, url: activeUrl, fileName: file.name })
      if (previousUrl) URL.revokeObjectURL(previousUrl)
    } catch (error) {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (sequence === selectionSequence.current) {
        setFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Не удалось прочитать изображение.' })
      }
    }
  }

  async function installAvatar(preparedImage: Blob) {
    setSaving(true)
    setFeedback(null)
    try {
      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': preparedImage.type },
        body: preparedImage,
      })
      if (!response.ok) throw new Error(await responseError(response))

      const refreshed = await refresh()
      setFeedback({
        tone: 'success',
        message: refreshed
          ? 'Аватар установлен и отображается в шапке профиля.'
          : 'Аватар сохранён. Если фото ещё не появилось в шапке, обновите страницу.',
      })
      clearSource()
    } catch (error) {
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Не удалось установить аватар.' })
    } finally {
      setSaving(false)
    }
  }

  const initials = name.trim() || 'Пользователь AirCheck'

  return (
    <>
      <section className="account-avatar-settings" aria-label="Фото профиля">
        <UserAvatar image={image} name={initials} size={88} className="account-profile-avatar" decorative={false} />
        <div className="account-avatar-copy">
          <h3>Фото профиля</h3>
          <p>Оно будет видно в шапке панели и 3D-стенда. Подойдут JPG, PNG или WebP до 15 МБ.</p>
          <div className="account-avatar-actions">
            <button className="account-button" type="button" onClick={() => inputRef.current?.click()}>
              {image ? 'Заменить фото' : 'Загрузить фото'}
            </button>
            <span className="account-avatar-hint">Квадратный кадр, WebP 512 × 512</span>
          </div>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept={AVATAR_INPUT_TYPES.join(',')}
            aria-label="Выберите фото профиля"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void selectImage(file)
            }}
          />
          {feedback ? (
            <p className={`account-feedback is-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
              {feedback.message}
            </p>
          ) : null}
        </div>
      </section>
      {source ? <AvatarCropDialog source={source} busy={saving} onCancel={clearSource} onSave={installAvatar} /> : null}
    </>
  )
}
