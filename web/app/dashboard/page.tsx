'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Stat } from '@/components/ui/Stat'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card'
import { Badge, severityTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface DashboardData {
  open_exposures?: number
  exposures_by_severity?: Record<string, number>
  mttc_minutes?: number | null
  containment?: { total?: number; contained?: number; closed?: number; open?: number; progress_pct?: number }
  debt?: { total_entries?: number; unresolved?: number; total_score?: number; by_severity?: Record<string, number> }
  crown_jewels?: {
    exposure_id?: string
    secret_id?: string
    secret_name?: string
    title?: string
    score?: number
    reachable_count?: number
    crown_jewel_count?: number
  } | null
  reuse_risk?: { clusters?: number; reused_secrets?: number; high_risk?: number; top_score?: number }
  recent?: Array<{ id: string; kind?: string; title?: string; body?: string; severity?: string; status?: string; created_at?: string }>
}

function fmtMinutes(mins?: number | null): string {
  if (mins == null) return '—'
  if (mins < 60) return `${Math.round(mins)}m`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (h < 24) return `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

function ProgressBar({ pct, tone = 'red' }: { pct: number; tone?: 'red' | 'amber' | 'green' }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const color = tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${clamped}%` }} />
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d = await api.getDashboard()
      setData(d ?? {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSeed = async () => {
    setSeeding(true)
    setSeedMsg('')
    try {
      const res = await api.seedSampleData()
      const counts = res?.counts ? Object.values(res.counts).reduce((a: number, b) => a + Number(b || 0), 0) : 0
      setSeedMsg(counts ? `Seeded ${counts} sample records.` : 'Sample data seeded.')
      await load()
    } catch (e) {
      setSeedMsg(e instanceof Error ? e.message : 'Failed to seed data')
    } finally {
      setSeeding(false)
    }
  }

  if (loading) return <PageSpinner label="Loading posture overview..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <Card className="border-red-900/60">
          <CardBody>
            <h2 className="text-sm font-semibold text-red-300">Could not load dashboard</h2>
            <p className="mt-1 text-sm text-zinc-400">{error}</p>
            <Button className="mt-4" onClick={load}>Retry</Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  const d = data ?? {}
  const containment = d.containment ?? {}
  const debt = d.debt ?? {}
  const reuse = d.reuse_risk ?? {}
  const cj = d.crown_jewels ?? null
  const progressPct = containment.progress_pct ?? (
    containment.total ? Math.round((((containment.contained ?? 0) + (containment.closed ?? 0)) / containment.total) * 100) : 0
  )
  const severities = d.exposures_by_severity ?? {}
  const recent = d.recent ?? []
  const isEmpty = !d.open_exposures && !containment.total && !debt.total_entries && !reuse.clusters && recent.length === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Posture Overview</h1>
          <p className="mt-1 text-sm text-zinc-500">Live secret-exposure blast-radius posture for your environment.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button variant="secondary" onClick={handleSeed} disabled={seeding}>
            {seeding ? 'Seeding...' : 'Seed sample data'}
          </Button>
          {seedMsg && <span className="text-xs text-zinc-500">{seedMsg}</span>}
        </div>
      </div>

      {isEmpty ? (
        <EmptyState
          title="No posture data yet"
          description="Seed sample data to populate secrets, stores, grants and a worked exposure, or start adding your own inventory."
          icon="🛡️"
          action={<Button onClick={handleSeed} disabled={seeding}>{seeding ? 'Seeding...' : 'Seed sample data'}</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label="Open exposures"
              value={d.open_exposures ?? 0}
              tone={(d.open_exposures ?? 0) > 0 ? 'red' : 'green'}
              hint={`${containment.total ?? 0} total incidents`}
            />
            <Stat
              label="Mean time to contain"
              value={fmtMinutes(d.mttc_minutes)}
              hint="Across contained exposures"
            />
            <Stat
              label="Rotation debt"
              value={debt.unresolved ?? debt.total_entries ?? 0}
              tone={(debt.unresolved ?? 0) > 0 ? 'amber' : 'green'}
              hint={`Score ${Math.round(debt.total_score ?? 0)}`}
            />
            <Stat
              label="Reused secrets"
              value={reuse.reused_secrets ?? 0}
              tone={(reuse.high_risk ?? 0) > 0 ? 'red' : 'default'}
              hint={`${reuse.clusters ?? 0} clusters, ${reuse.high_risk ?? 0} high-risk`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Containment progress</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="flex items-center justify-between text-sm text-zinc-400">
                  <span>{(containment.contained ?? 0) + (containment.closed ?? 0)} of {containment.total ?? 0} resolved</span>
                  <span className="font-semibold tabular-nums text-zinc-200">{progressPct}%</span>
                </div>
                <ProgressBar pct={progressPct} tone={progressPct >= 80 ? 'green' : progressPct >= 40 ? 'amber' : 'red'} />
                <div className="grid grid-cols-3 gap-3 pt-2 text-center">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 py-3">
                    <div className="text-xl font-bold tabular-nums text-red-400">{containment.open ?? d.open_exposures ?? 0}</div>
                    <div className="text-xs text-zinc-500">Open</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 py-3">
                    <div className="text-xl font-bold tabular-nums text-amber-400">{containment.contained ?? 0}</div>
                    <div className="text-xs text-zinc-500">Contained</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 py-3">
                    <div className="text-xl font-bold tabular-nums text-emerald-400">{containment.closed ?? 0}</div>
                    <div className="text-xs text-zinc-500">Closed</div>
                  </div>
                </div>
                {Object.keys(severities).length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Open by severity</div>
                    {Object.entries(severities).map(([sev, count]) => {
                      const max = Math.max(...Object.values(severities).map(Number), 1)
                      return (
                        <div key={sev} className="flex items-center gap-3">
                          <span className="w-20 shrink-0"><Badge tone={severityTone(sev)}>{sev}</Badge></span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                            <div className="h-full rounded-full bg-red-500/70" style={{ width: `${(Number(count) / max) * 100}%` }} />
                          </div>
                          <span className="w-8 text-right text-sm tabular-nums text-zinc-400">{Number(count)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Crown-jewel exposure</CardTitle>
              </CardHeader>
              <CardBody>
                {cj && (cj.secret_id || cj.exposure_id) ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500">Highest blast radius</div>
                      <div className="mt-1 text-lg font-semibold text-zinc-100">{cj.secret_name ?? cj.title ?? 'Secret'}</div>
                      {cj.title && cj.secret_name && <div className="text-sm text-zinc-500">{cj.title}</div>}
                    </div>
                    <div className="flex items-end gap-2">
                      <span className="text-4xl font-black tabular-nums text-red-400">{Math.round(cj.score ?? 0)}</span>
                      <span className="pb-1 text-xs text-zinc-500">blast score</span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge tone="amber">{cj.reachable_count ?? 0} reachable</Badge>
                      <Badge tone="red">{cj.crown_jewel_count ?? 0} crown jewels</Badge>
                    </div>
                    {cj.secret_id && (
                      <Link href={`/dashboard/secrets/${cj.secret_id}`} className="inline-block text-sm font-medium text-red-400 hover:text-red-300">
                        Inspect secret →
                      </Link>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No exposures with a computed blast radius yet.</p>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Rotation debt summary</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-zinc-400">Total debt score</span>
                  <span className="text-2xl font-bold tabular-nums text-amber-400">{Math.round(debt.total_score ?? 0)}</span>
                </div>
                <div className="space-y-2">
                  {Object.entries(debt.by_severity ?? {}).length > 0 ? (
                    Object.entries(debt.by_severity ?? {}).map(([sev, count]) => (
                      <div key={sev} className="flex items-center justify-between text-sm">
                        <Badge tone={severityTone(sev)}>{sev}</Badge>
                        <span className="tabular-nums text-zinc-300">{Number(count)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-zinc-500">No outstanding rotation debt.</p>
                  )}
                </div>
                <Link href="/dashboard/debt" className="inline-block text-sm font-medium text-red-400 hover:text-red-300">
                  View debt ledger →
                </Link>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Reuse risk</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                    <div className="text-xl font-bold tabular-nums text-zinc-100">{reuse.clusters ?? 0}</div>
                    <div className="text-xs text-zinc-500">Clusters</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                    <div className="text-xl font-bold tabular-nums text-red-400">{reuse.high_risk ?? 0}</div>
                    <div className="text-xs text-zinc-500">High risk</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                    <div className="text-xl font-bold tabular-nums text-amber-400">{reuse.reused_secrets ?? 0}</div>
                    <div className="text-xs text-zinc-500">Reused secrets</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                    <div className="text-xl font-bold tabular-nums text-zinc-100">{Math.round(reuse.top_score ?? 0)}</div>
                    <div className="text-xs text-zinc-500">Top score</div>
                  </div>
                </div>
                <Link href="/dashboard/reuse" className="inline-block text-sm font-medium text-red-400 hover:text-red-300">
                  Inspect reuse clusters →
                </Link>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
              </CardHeader>
              <CardBody>
                {recent.length === 0 ? (
                  <p className="text-sm text-zinc-500">No recent incidents or notifications.</p>
                ) : (
                  <ul className="space-y-3">
                    {recent.slice(0, 6).map((r) => (
                      <li key={r.id} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                        <div className="min-w-0">
                          <div className="truncate text-sm text-zinc-200">{r.title ?? r.kind ?? 'Event'}</div>
                          {(r.body || r.severity || r.status) && (
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                              {(r.severity || r.status) && (
                                <Badge tone={severityTone(r.severity ?? r.status)}>{r.severity ?? r.status}</Badge>
                              )}
                              {r.body && <span className="truncate">{r.body}</span>}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
