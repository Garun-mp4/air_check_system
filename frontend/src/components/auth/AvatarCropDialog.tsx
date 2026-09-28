'use client'

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'

import {
  AVATAR_MAX_ZOOM,
  AVATAR_OUTPUT_SIZE,
  calculateCropFrame,
} from '../../lib/avatar-image'

export interface AvatarSourceImage {
  url: string
  width: number
  height: number
  fileName: string
}

export default function AvatarCropDialog({
  source,
  busy,
  onCancel,
  onSave,
}: {
  source: AvatarSourceImage
  busy: boolean
  onCancel: () => void
  onSave: (image: Blob) => Promise<void>
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef(onCancel)
  const busyRef = useRef(busy)
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const [viewportSize, setViewportSize] = useState(280)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [cropError, setCropError] = useState<string | null>(null)

  cancelRef.current = onCancel
  busyRef.current = busy

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        cancelRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
      ))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    setZoom(1)
    setOffset(null)
    setImageLoaded(false)
    setCropError(null)
  }, [source.url])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const updateSize = () => {
      const size = stage.clientWidth
      if (size > 0) setViewportSize(size)
    }
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [source.url])

  const frame = calculateCropFrame(source.width, source.height, viewportSize, zoom, offset ?? undefined)

  function moveCrop(deltaX: number, deltaY: number) {
    const next = calculateCropFrame(source.width, source.height, viewportSize, zoom, {
      x: frame.offsetX + deltaX,
      y: frame.offsetY + deltaY,
    })
    setOffset({ x: next.offsetX, y: next.offsetY })
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || busy) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: frame.offsetX,
      offsetY: frame.offsetY,
    }
  }

  function continueDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const next = calculateCropFrame(source.width, source.height, viewportSize, zoom, {
      x: drag.offsetX + event.clientX - drag.x,
      y: drag.offsetY + event.clientY - drag.y,
    })
    setOffset({ x: next.offsetX, y: next.offsetY })
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  function handleStageKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const movement = event.shiftKey ? 32 : 12
    if (event.key === 'ArrowLeft') moveCrop(movement, 0)
    else if (event.key === 'ArrowRight') moveCrop(-movement, 0)
    else if (event.key === 'ArrowUp') moveCrop(0, movement)
    else if (event.key === 'ArrowDown') moveCrop(0, -movement)
    else return
    event.preventDefault()
  }

  function updateZoom(value: number) {
    const scaleAtCenter = (viewportSize / 2 - frame.offsetX) / frame.scale
    const verticalAtCenter = (viewportSize / 2 - frame.offsetY) / frame.scale
    const baseScale = Math.max(viewportSize / source.width, viewportSize / source.height)
    const next = calculateCropFrame(source.width, source.height, viewportSize, value, {
      x: viewportSize / 2 - scaleAtCenter * baseScale * value,
      y: viewportSize / 2 - verticalAtCenter * baseScale * value,
    })
    setZoom(value)
    setOffset({ x: next.offsetX, y: next.offsetY })
  }

  async function saveCrop() {
    const image = imageRef.current
    if (!image || !imageLoaded || busy) return
    setCropError(null)

    try {
      const canvas = document.createElement('canvas')
      canvas.width = AVATAR_OUTPUT_SIZE
      canvas.height = AVATAR_OUTPUT_SIZE
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Редактор изображения недоступен в этом браузере.')
      context.drawImage(image, frame.sourceX, frame.sourceY, frame.sourceSize, frame.sourceSize, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (!result) reject(new Error('Не удалось подготовить изображение. Попробуйте другой файл.'))
          else resolve(result)
        }, 'image/webp', 0.86)
      })
      if (blob.type !== 'image/webp') throw new Error('Браузер не смог подготовить изображение WebP. Обновите браузер и попробуйте снова.')
      await onSave(blob)
    } catch (error) {
      setCropError(error instanceof Error ? error.message : 'Не удалось подготовить изображение.')
    }
  }

  return (
    <div className="avatar-editor-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}>
      <section
        ref={dialogRef}
        className="avatar-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-editor-title"
        aria-describedby="avatar-editor-description"
        tabIndex={-1}
      >
        <div className="avatar-editor-heading">
          <div>
            <span className="eyebrow">Настройка изображения</span>
            <h2 id="avatar-editor-title">Кадрирование аватара</h2>
          </div>
          <button className="account-button avatar-editor-close" type="button" onClick={onCancel} disabled={busy} aria-label="Отмена">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <p id="avatar-editor-description" className="avatar-editor-description">
          Переместите изображение внутри квадрата и настройте масштаб. В шапке профиля фото будет показано круглым.
        </p>
        <div
          ref={stageRef}
          className="avatar-crop-stage"
          role="group"
          aria-label="Область кадрирования. Перетаскивайте изображение или используйте клавиши со стрелками."
          tabIndex={0}
          onPointerDown={beginDrag}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={handleStageKeyDown}
        >
          <img
            ref={imageRef}
            src={source.url}
            alt=""
            draggable={false}
            onLoad={() => setImageLoaded(true)}
            onError={() => setCropError('Не удалось открыть изображение. Выберите другой файл.')}
            style={{
              width: frame.renderedWidth,
              height: frame.renderedHeight,
              left: frame.offsetX,
              top: frame.offsetY,
            }}
          />
          <span className="avatar-crop-frame" aria-hidden="true" />
        </div>
        <label className="avatar-zoom-control">
          <span>Масштаб</span>
          <input
            type="range"
            min="1"
            max={AVATAR_MAX_ZOOM}
            step="0.01"
            value={zoom}
            aria-label="Масштаб изображения"
            onChange={(event) => updateZoom(Number(event.currentTarget.value))}
          />
          <output>{zoom.toFixed(1)}×</output>
        </label>
        <p className="avatar-editor-file-name" title={source.fileName}>{source.fileName}</p>
        {cropError ? <p className="account-feedback is-error" role="alert">{cropError}</p> : null}
        <div className="avatar-editor-actions">
          <button className="account-button" type="button" onClick={onCancel} disabled={busy}>Отмена</button>
          <button className="account-button account-button-primary" type="button" onClick={() => void saveCrop()} disabled={!imageLoaded || busy}>
            {busy ? 'Устанавливаем…' : 'Установить аватар'}
          </button>
        </div>
      </section>
    </div>
  )
}
