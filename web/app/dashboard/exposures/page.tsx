'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { Badge, severityTone } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Card, CardBody } from '@/components/ui/card'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Exposure {
  id: string
  secret_id?: string
  title: string
  vector?: string
  severity?: string
  status?: string
  exposed_since?: string
  detected_at?: string
  contained_at?: string | null
  closed_at?: string | null
  blast_radius_score?: number
  notes?: string
  created_at?: string
}

const SEVERITIES = ['critical', 'high', 'medium', 'low']
const STATUSES = ['detected', 'analyzing', 'contained', 'closed']

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function scoreTone(score?: number): 'red' | 'amber' | 'green' {
  const s = score ?? 0
  if (s >= 70) return 'red'
  if (s >= 40) return 'amber'
  return 'green'
}

const scoreTextClass: Record<'red' | 'amber' | 'green', string> = {
  red: 'text-red-400',
  amber: 'text-amber-400',
  green: 'text-emerald-400',
}

export default function ExposuresPage() {
  const [exposures, setExposures] = useState<Exposure[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [severity, setSeverity] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')

  const load = useMemo(
    () => async (filters?: { severity?: string; status?: string }) => {
      try {
        setLoading(true)
        setError(null)
        const params: Record<string, string> = {}
        if (filters?.severity) params.severity = filters.severity
        if (filters?.status) params.status = filters.status
        const res = await api.getExposures(Object.keys(params).length ? params : undefined)
        const list: Exposure[] = Array.isArray(res) ? res : res?.exposures ?? []
        setExposures(list)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load exposures')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    load({ severity, status })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity, status])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return exposures
    return exposures.filter(
      (e) =>
        e.title?.toLowerCase().includes(q) ||
        e.vector?.toLowerCase().includes(q) ||
        e.notes?.toLowerCase().includes(q),
    )
  }, [exposures, search])

  const stats = useMemo(() => {
    const open = exposures.filter((e) => e.status !== 'closed').length
    const critical = exposures.filter((e) => (e.severity ?? '').toLowerCase() === 'critical').length
    const contained = exposures.filter((e) => e.status === 'contained' || e.status === 'closed').length
    const avgScore =
      exposures.length === 0
        ? 0
        : Math.round(exposures.reduce((a, e) => a + (e.blast_radius_score ?? 0), 0) / exposures.length)
    return { open, critical, contained, avgScore, total: exposures.length }
  }, [exposures])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Exposures</h1>
          <p className="mt-1 text-sm text-zinc-500">Active and historical secret-exposure incidents.</p>
        </div>
        <Link href="/dashboard/exposures/new">
          <Button>Declare Exposure</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Open" value={stats.open} tone={stats.open > 0 ? 'red' : 'green'} />
        <Stat label="Critical" value={stats.critical} tone={stats.critical > 0 ? 'red' : 'default'} />
        <Stat label="Contained / Closed" value={stats.contained} tone="green" />
        <Stat label="Avg Blast Score" value={stats.avgScore} tone={scoreTone(stats.avgScore)} />
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, vector, notes..."
            className="min-w-[200px] flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-red-700 focus:outline-none"
          />
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
          >
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          {(severity || status || search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSeverity('')
                setStatus('')
                setSearch('')
              }}
            >
              Clear
            </Button>
          )}
        </CardBody>
      </Card>

      {loading ? (
        <PageSpinner label="Loading exposures..." />
      ) : error ? (
        <EmptyState
          title="Could not load exposures"
          description={error}
          action={
            <Button variant="secondary" onClick={() => load({ severity, status })}>
              Retry
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={exposures.length === 0 ? 'No exposures declared' : 'No exposures match your filters'}
          description={
            exposures.length === 0
              ? 'When a secret leaks, declare an exposure to compute its blast radius and spin up a runbook.'
              : 'Adjust or clear the filters above.'
          }
          action={
            exposures.length === 0 ? (
              <Link href="/dashboard/exposures/new">
                <Button>Declare Exposure</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>Vector</TH>
              <TH>Severity</TH>
              <TH>Status</TH>
              <TH>Blast</TH>
              <TH>Exposed Since</TH>
              <TH>Detected</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {filtered.map((e) => (
              <TR key={e.id}>
                <TD>
                  <Link href={`/dashboard/exposures/${e.id}`} className="font-medium text-zinc-100 hover:text-red-400">
                    {e.title}
                  </Link>
                </TD>
                <TD>{e.vector ?? '—'}</TD>
                <TD>{e.severity ? <Badge tone={severityTone(e.severity)}>{e.severity}</Badge> : '—'}</TD>
                <TD>{e.status ? <Badge tone={severityTone(e.status)}>{e.status}</Badge> : '—'}</TD>
                <TD>
                  <span className={`font-semibold tabular-nums ${scoreTextClass[scoreTone(e.blast_radius_score)]}`}>
                    {e.blast_radius_score != null ? Math.round(e.blast_radius_score) : '—'}
                  </span>
                </TD>
                <TD className="whitespace-nowrap text-xs">{fmtDate(e.exposed_since)}</TD>
                <TD className="whitespace-nowrap text-xs">{fmtDate(e.detected_at)}</TD>
                <TD>
                  <Link href={`/dashboard/exposures/${e.id}`}>
                    <Button variant="ghost" size="sm">
                      View
                    </Button>
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
