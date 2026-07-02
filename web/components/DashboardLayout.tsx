'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Secrets', href: '/dashboard/secrets' },
      { label: 'Stores', href: '/dashboard/stores' },
      { label: 'Resources', href: '/dashboard/resources' },
      { label: 'Grants', href: '/dashboard/grants' },
      { label: 'Owners', href: '/dashboard/owners' },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { label: 'Blast Radius', href: '/dashboard/blast-radius' },
      { label: 'Reuse', href: '/dashboard/reuse' },
      { label: 'Copy Discovery', href: '/dashboard/copies' },
    ],
  },
  {
    title: 'Incidents',
    items: [
      { label: 'Exposures', href: '/dashboard/exposures' },
      { label: 'Timeline', href: '/dashboard/timeline' },
      { label: 'Runbooks', href: '/dashboard/runbooks' },
      { label: 'Access Logs', href: '/dashboard/access-logs' },
      { label: 'Evidence', href: '/dashboard/evidence' },
      { label: 'Simulations', href: '/dashboard/simulations' },
    ],
  },
  {
    title: 'Hygiene',
    items: [
      { label: 'Rotation Debt', href: '/dashboard/debt' },
      { label: 'Policies', href: '/dashboard/policies' },
    ],
  },
  {
    title: 'Insight',
    items: [
      { label: 'Reports', href: '/dashboard/reports' },
      { label: 'Audit Log', href: '/dashboard/audit' },
      { label: 'Notifications', href: '/dashboard/notifications' },
    ],
  },
  {
    title: 'Account',
    items: [{ label: 'Settings', href: '/dashboard/settings' }],
  },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [userLabel, setUserLabel] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await authClient.getSession()
      if (cancelled) return
      const user = (s as any)?.data?.user
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      setUserLabel(user.email ?? user.name ?? 'Account')
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [router])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <span className="inline-flex items-center gap-2 text-sm text-zinc-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-pink-500" />
          Loading workspace...
        </span>
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-6">
      <Link href="/dashboard" className="flex items-center gap-2 px-2" onClick={() => setOpen(false)}>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pink-600 text-sm font-black text-white">S</span>
        <span className="text-sm font-bold tracking-tight text-zinc-100">SecretExposure<span className="text-pink-500">BlastRadius</span></span>
      </Link>
      <div className="flex flex-col gap-5">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{section.title}</div>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-pink-600 font-medium text-white'
                        : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-zinc-800 bg-zinc-900 lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-zinc-800 bg-zinc-900">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpen(true)}
              className="rounded-md border border-zinc-800 px-2 py-1 text-zinc-400 hover:text-white lg:hidden"
              aria-label="Open menu"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-zinc-300">Incident Workspace</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-zinc-500 sm:inline">{userLabel}</span>
            <button
              onClick={signOut}
              className="rounded-full border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-pink-900/60 hover:bg-pink-950/30 hover:text-pink-300"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}
