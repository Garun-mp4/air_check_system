import Image from 'next/image'

const AVATAR_PATH_PATTERN = /^\/api\/profile\/avatar\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default function UserAvatar({
  image,
  name,
  size,
  className = '',
  decorative = true,
}: {
  image: string | null | undefined
  name: string
  size: number
  className?: string
  decorative?: boolean
}) {
  const initials = Array.from(name.trim() || 'A')[0]?.toLocaleUpperCase('ru-RU') ?? 'A'
  const source = image && AVATAR_PATH_PATTERN.test(image) ? image : null

  return (
    <span
      className={`user-avatar ${className}`.trim()}
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : `Фото профиля: ${name}`}
    >
      {source ? (
        <Image className="user-avatar-image" src={source} alt="" width={size} height={size} unoptimized />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  )
}
