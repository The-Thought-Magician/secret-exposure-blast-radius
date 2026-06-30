'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { authClient } from '@/lib/auth/client'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge, severityTone } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface DebtEntry {
  id: string
  secret_id: string
  reason: string
  age_days: number
  severity: string
  score: number
  owner_id: string | null
  resolved: boolean
  created_at: string
}

interface DebtSummary {
  by_reason?: Array<{ reason: string; count: number; score: number }>
  by_owner?: Array<{ owner_id: string | null; owner_name?: string | null; count: number; score: number }>
  total_score?: number
}

function fmtDate(value?: string) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export default function DebtPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [entries, setEntries] = useState<DebtEntry[]>([])
  const [summary, setSummary] = useState<DebtSummary | null>(null)

  const [reasonFilter, setReasonFilter] = useState('')
  const [resolvedFilter, setResolvedFilter] = useState<'all' | 'open' | 'resolved'>('open')
  const [sortKey, setSortKey] = useState<'score' | 'age_days' | 'created_at'>('score')
  const [search, setSearch] = useState('')

  const [recomputing, setRecomputing] = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    authClient
      .getSession()
      .then((session) => {
        if (!active) return
        if (!(session as { data?: { user?: unknown } } | null)?.data?.user) {
          router.replace('/auth/sign-in')
          return
        }
        setAuthed(true)
      })
      .catch(() => {
        if (active) router.replace('/auth/sign-in')
      })
    return () => {
      active = false
    }
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = {}
      if (reasonFilter) params.reason = reasonFilter
      if (resolvedFilter !== 'all') params.resolved = resolvedFilter === 'resolved' ? 'true' : 'false'
      const [debt, sum] = await Promise.all([api.getDebt(params), api.getDebtSummary()])
      setEntries(Array.isArray(debt) ? debt : debt?.entries ?? [])
      setSummary(sum ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rotation debt')
    } finally {
      setLoading(false)
    }
  }, [reasonFilter, resolvedFilter])

  useEffect(() => {
    if (authed) load()
  }, [authed, load])

  const reasons = useMemo(() => {
    const set = new Set<string>()
    entries.forEach((e) => e.reason && set.add(e.reason))
    summary?.by_reason?.forEach((r) => r.reason && set.add(r.reason))
    return Array.from(set).sort()
  }, [entries, summary])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = entries.filter((e) => {
      if (!term) return true
      return (
        e.secret_id.toLowerCase().includes(term) ||
        e.reason.toLowerCase().includes(term) ||
        (e.owner_id ?? '').toLowerCase().includes(term)
      )
    })
    return [...filtered].sort((a, b) => {
      if (sortKey === 'created_at') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      return (b[sortKey] as number) - (a[sortKey] as number)
    })
  }, [entries, search, sortKey])

  const totalScore = summary?.total_score ?? entries.reduce((acc, e) => acc + (e.score || 0), 0)
  const openCount = entries.filter((e) => !e.resolved).length
  const criticalCount = entries.filter((e) => !e.resolved && e.severity?.toLowerCase() === 'critical').length
  const maxReasonScore = Math.max(1, ...(summary?.by_reason ?? []).map((r) => r.score || 0))

  async function recompute() {
    setRecomputing(true)
    setError(null)
    try {
      await api.recomputeDebt()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recompute failed')
    } finally {
      setRecomputing(false)
    }
  }

  async function resolve(id: string) {
    setResolvingId(id)
    setError(null)
    try {
      await api.resolveDebt(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve entry')
    } finally {
      setResolvingId(null)
    }
  }

  if (!authed) return <PageSpinner label="Authenticating..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Rotation Debt Ledger</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Outstanding rotation obligations across your secrets, scored by age, criticality, and exposure.
          </p>
        </div>
        <Button onClick={recompute} disabled={recomputing}>
          {recomputing ? <Spinner label="Recomputing..." /> : 'Recompute debt'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total debt score" value={Math.round(totalScore)} tone="red" hint="Sum of open entries" />
        <Stat label="Open entries" value={openCount} tone={openCount ? 'amber' : 'green'} />
        <Stat label="Critical" value={criticalCount} tone={criticalCount ? 'red' : 'green'} />
        <Stat label="Reasons tracked" value={reasons.length} />
      </div>

      {summary?.by_reason && summary.by_reason.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Debt by reason</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {summary.by_reason.map((r) => (
              <div key={r.reason} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300">{r.reason}</span>
                  <span className="tabular-nums text-zinc-500">
                    {r.count} · {Math.round(r.score)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-red-600"
                    style={{ width: `${Math.min(100, ((r.score || 0) / maxReasonScore) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {summary?.by_owner && summary.by_owner.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Debt by owner</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {summary.by_owner.map((o, i) => (
                <Badge key={`${o.owner_id ?? 'none'}-${i}`} tone={o.score > maxReasonScore / 2 ? 'red' : 'zinc'}>
                  {o.owner_name || o.owner_id || 'Unassigned'} · {o.count} · {Math.round(o.score)}
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Ledger entries</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search secret / owner..."
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-red-500 focus:outline-none"
            />
            <select
              value={reasonFilter}
              onChange={(e) => setReasonFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 focus:border-red-500 focus:outline-none"
            >
              <option value="">All reasons</option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select
              value={resolvedFilter}
              onChange={(e) => setResolvedFilter(e.target.value as 'all' | 'open' | 'resolved')}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 focus:border-red-500 focus:outline-none"
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as 'score' | 'age_days' | 'created_at')}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 focus:border-red-500 focus:outline-none"
            >
              <option value="score">Sort: score</option>
              <option value="age_days">Sort: age</option>
              <option value="created_at">Sort: newest</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <Spinner label="Loading ledger..." />
            </div>
          ) : visible.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No rotation debt"
                description="Either your secrets are fully rotated or no debt has been computed yet. Run a recompute to scan against your rotation policies."
                action={
                  <Button onClick={recompute} disabled={recomputing}>
                    Recompute debt
                  </Button>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Secret</TH>
                  <TH>Reason</TH>
                  <TH>Severity</TH>
                  <TH className="text-right">Age (d)</TH>
                  <TH className="text-right">Score</TH>
                  <TH>Owner</TH>
                  <TH>Detected</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((e) => (
                  <TR key={e.id}>
                    <TD className="font-mono text-xs text-zinc-400">{e.secret_id.slice(0, 8)}</TD>
                    <TD>{e.reason}</TD>
                    <TD>
                      <Badge tone={severityTone(e.severity)}>{e.severity}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">{e.age_days}</TD>
                    <TD className="text-right font-semibold tabular-nums text-red-400">{Math.round(e.score)}</TD>
                    <TD className="font-mono text-xs text-zinc-500">{e.owner_id ? e.owner_id.slice(0, 8) : '—'}</TD>
                    <TD className="text-xs text-zinc-500">{fmtDate(e.created_at)}</TD>
                    <TD className="text-right">
                      {e.resolved ? (
                        <Badge tone="green">Resolved</Badge>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => resolve(e.id)} disabled={resolvingId === e.id}>
                          {resolvingId === e.id ? '...' : 'Resolve'}
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
