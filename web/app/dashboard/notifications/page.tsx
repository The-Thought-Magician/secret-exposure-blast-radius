'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Notification {
  id: string
  kind?: string
  title?: string
  body?: string
  link?: string
  read?: boolean
  created_at?: string
}

function fmtRelative(d?: string) {
  if (!d) return ''
  const t = new Date(d).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString()
}

function kindTone(kind?: string) {
  switch ((kind ?? '').toLowerCase()) {
    case 'exposure':
    case 'critical':
    case 'alert':
      return 'red'
    case 'rotation':
    case 'debt':
    case 'warning':
      return 'amber'
    case 'contained':
    case 'resolved':
    case 'success':
      return 'green'
    default:
      return 'zinc'
  }
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const n = await api.getNotifications()
      setItems(Array.isArray(n) ? n : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const kinds = useMemo(() => {
    const set = new Set<string>()
    items.forEach((n) => n.kind && set.add(n.kind))
    return Array.from(set).sort()
  }, [items])

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items])

  const filtered = useMemo(() => {
    return items
      .filter((n) => (tab === 'unread' ? !n.read : true))
      .filter((n) => (kindFilter === 'all' ? true : (n.kind ?? '') === kindFilter))
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
  }, [items, tab, kindFilter])

  async function markRead(n: Notification) {
    if (n.read) return
    setBusyId(n.id)
    // optimistic
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    try {
      await api.markNotificationRead(n.id)
    } catch (e) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: false } : x)))
      alert(e instanceof Error ? e.message : 'Failed to mark read')
    } finally {
      setBusyId(null)
    }
  }

  async function markAll() {
    if (unreadCount === 0) return
    setMarkingAll(true)
    const snapshot = items
    setItems((prev) => prev.map((x) => ({ ...x, read: true })))
    try {
      await api.markAllNotificationsRead()
    } catch (e) {
      setItems(snapshot)
      alert(e instanceof Error ? e.message : 'Failed to mark all read')
    } finally {
      setMarkingAll(false)
    }
  }

  if (loading) return <PageSpinner label="Loading notifications..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Notifications</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Real-time signals from your secret estate: new exposures, rotation debt crossing thresholds, and
            containment milestones.
          </p>
        </div>
        <Button variant="secondary" onClick={markAll} disabled={markingAll || unreadCount === 0}>
          {markingAll ? <Spinner label="Marking..." /> : `Mark all read${unreadCount ? ` (${unreadCount})` : ''}`}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error} <button className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Total" value={items.length} />
        <Stat label="Unread" value={unreadCount} tone={unreadCount ? 'red' : 'green'} />
        <Stat label="Kinds" value={kinds.length} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            {(['all', 'unread'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-sm capitalize ${tab === t ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'}`}
              >
                {t}{t === 'unread' && unreadCount ? ` (${unreadCount})` : ''}
              </button>
            ))}
          </div>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
          >
            <option value="all">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={items.length === 0 ? 'No notifications' : tab === 'unread' ? 'All caught up' : 'Nothing matches'}
                description={
                  items.length === 0
                    ? 'When an exposure is declared or debt crosses a threshold, it will surface here.'
                    : tab === 'unread'
                      ? 'You have read everything in this view.'
                      : 'Try a different kind filter.'
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {filtered.map((n) => {
                const inner = (
                  <div className="flex items-start gap-3 px-5 py-4">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-zinc-700' : 'bg-red-500'}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {n.kind && <Badge tone={kindTone(n.kind)}>{n.kind}</Badge>}
                        <span className={`text-sm font-medium ${n.read ? 'text-zinc-400' : 'text-zinc-100'}`}>
                          {n.title ?? 'Notification'}
                        </span>
                        <span className="text-xs text-zinc-600">{fmtRelative(n.created_at)}</span>
                      </div>
                      {n.body && <p className="mt-1 text-sm text-zinc-500">{n.body}</p>}
                      {n.link && (
                        <Link
                          href={n.link}
                          className="mt-1 inline-block text-xs font-medium text-red-400 hover:text-red-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          View details →
                        </Link>
                      )}
                    </div>
                    {!n.read && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === n.id}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          markRead(n)
                        }}
                      >
                        {busyId === n.id ? '…' : 'Mark read'}
                      </Button>
                    )}
                  </div>
                )
                return (
                  <li
                    key={n.id}
                    className={`cursor-pointer transition-colors hover:bg-zinc-900/60 ${n.read ? '' : 'bg-zinc-900/30'}`}
                    onClick={() => markRead(n)}
                  >
                    {inner}
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
