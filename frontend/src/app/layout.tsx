import type { Metadata } from 'next'

import '../../css/styles.css'

export const metadata: Metadata = {
  title: 'AirCheck — панель управления воздухом',
  description: 'Мониторинг CO₂, прогноз и рекомендации по проветриванию.',
  icons: {
    icon: [
      {
        url: '/aircheck-favicon-32.png',
        sizes: '32x32',
        type: 'image/png',
      },
      {
        url: '/aircheck-favicon-48.png',
        sizes: '48x48',
        type: 'image/png',
      },
      {
        url: '/aircheck-favicon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        url: '/aircheck-favicon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    apple: [
      {
        url: '/aircheck-favicon-180.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  },
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
