'use client'

import { usePathname } from 'next/navigation'
import Image from 'next/image'

import AccountMenu from './AccountMenu'

const links = [
  { href: '/', label: 'Панель' },
  { href: '/simulator', label: '3D-стенд' },
]

export default function UtilityHeader() {
  const pathname = usePathname()

  return (
    <header className="utility-topbar">
      <a className="utility-brand" href="/" aria-label="AirCheck — панель управления">
        <Image src="/aircheck-logo.png" alt="" width={38} height={30} priority />
        <span>AirCheck</span>
      </a>
      <nav className="utility-primary-nav" aria-label="Основная навигация">
        {links.map((link) => (
          <a key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>
            {link.label}
          </a>
        ))}
      </nav>
      <AccountMenu variant="utility" />
    </header>
  )
}
