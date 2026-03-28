import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FormBoost — フォームURL自動検出',
  description: '会社名からお問い合わせフォームURLを自動検出するツール',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
