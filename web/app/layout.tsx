import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SecretExposureBlastRadius',
  description: 'Post-leak incident response: compute a leaked secret\'s blast radius, drive rotation to completion, and produce insurer-grade containment evidence.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
