import type { Metadata } from 'next'

import '../../css/styles.css'

export const metadata: Metadata = {
  title: 'AirCheck — панель управления воздухом',
  description: 'Мониторинг CO₂, прогноз и рекомендации по проветриванию.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
