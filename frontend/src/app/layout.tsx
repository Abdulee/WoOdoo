import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { QueryProvider } from '@/providers/QueryProvider'
import { WebSocketProvider } from '@/lib/websocket'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { SetupGuard } from '@/components/SetupGuard'

const geist = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'WoOdoo — Odoo ↔ WooCommerce Sync',
  description: 'Bidirectional product and order sync between Odoo 18 and WooCommerce',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${geist.variable} antialiased`} style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
        <QueryProvider>
          <WebSocketProvider>
            <div className="flex min-h-screen" style={{ background: 'transparent' }}>
              <Sidebar />
              <div className="flex flex-col flex-1 overflow-hidden">
                <Header />
                <main className="flex-1 overflow-auto">
                  <SetupGuard>
                    {children}
                  </SetupGuard>
                </main>
              </div>
            </div>
          </WebSocketProvider>
        </QueryProvider>
      </body>
    </html>
  )
}
