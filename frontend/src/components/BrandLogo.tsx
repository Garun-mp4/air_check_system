import Image from 'next/image'

type BrandLogoProps = {
  className?: string
  width: number
  height: number
  priority?: boolean
}

export default function BrandLogo({ className, width, height, priority = false }: BrandLogoProps) {
  return (
    <Image
      src="/aircheck-logo.png"
      alt=""
      aria-hidden="true"
      className={className}
      width={width}
      height={height}
      priority={priority}
      unoptimized
    />
  )
}
