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

interface HistoryPoint {
  id?: string
  exposure_id?: string
  title?: string
  severity?: string
  status?: string
  detected_at?: string
  contained_at?: string | null
  closed_at?: string | null
  mttc_minutes?: number | null
  blast_radius_score?: number | null
}

interface MttcTrendPoint {
  period?: string
  bucket?: string
  date?: string
  mttc_minutes?: number | null
  avg_mttc_minutes?: number | null
  count?: number
}

interface ExposureHistory {
  history?: HistoryPoint[]
  mttc_trend?: MttcTrendPoint[]
}

interface DebtTrendPoint {
  period?: string
  bucket?: string
  date?: string
  total_score?: number | null
  score?: number | null
  open_count?: number | null
  resolved_count?: number | null
}

interface DebtTrend {
  trend?: DebtTrendPoint[]
}

interface CrownJewel {
  id?: string
  resource_id?: string
  name?: string
  type?: string
  sensitivity?: string
  environment?: string
  reachable_count?: number | null
  exposure_count?: number | null
  blast_radius_score?: number | null
  score?: number | null
}

interface CrownJewels {
  resources?: CrownJewel[]
}

interface Posture {
  overall_score?: number | null
  grade?: string
  open_exposures?: number | null
  total_exposures?: number | null
  contained_exposures?: number | null
  mttc_minutes?: number | null
  avg_mttc_minutes?: number | null
  debt_score?: number | null
  open_debt?: number | null
  reuse_clusters?: number | null
  reuse_risk?: number | null
  crown_jewel_count?: number | null
  evidence_count?: number | null
  completeness_pct?: number | null
  rotation_coverage_pct?: number | null
  recommendations?: string[]
  findings?: Array<{ label?: string; detail?: string; severity?: string }>
  [key: string]: unknown
}

interface PostureReport {
  posture?: Posture
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function fmtMinutes(m?: number | null) {
  if (m == null || Number.isNaN(m)) return '—'
  if (m < 60) return `${Math.round(m)}m`
  const h = m / 60
  if (h < 24) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}

function periodLabel(p: { period?: string; bucket?: string; date?: string }) {
  const raw = p.period ?? p.bucket ?? p.date ?? ''
  const d = new Date(raw)
  if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return raw || '—'
}

/** Minimal dependency-free line chart over a series of numeric points. */
function LineChart({
  points,
  color = '#ef4444',
  height = 140,
  formatValue,
}: {
  points: Array<{ label: string; value: number }>
  color?: string
  height?: number
  formatValue?: (n: number) => string
}) {
  if (points.length === 0) {
    return <div className="py-8 text-center text-sm text-zinc-600">No data points</div>
  }
  const w = 600
  const h = height
  const pad = 8
  const max = Math.max(1, ...points.map((p) => p.value))
  const min = Math.min(0, ...points.map((p) => p.value))
  const span = max - min || 1
  const n = points.length
  const x = (i: number) => (n === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (n - 1))
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ')
  const area = `${path} L ${x(n - 1).toFixed(1)} ${h - pad} L ${x(0).toFixed(1)} ${h - pad} Z`
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full min-w-[420px]" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lc-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#lc-grad)" stroke="none" />
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r="3" fill={color} />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-zinc-600">
        {points.map((p, i) => (
          <span key={i} className="flex-1 text-center">
            {i === 0 || i === n - 1 || n <= 6 ? p.label : ''}
          </span>
        ))}
      </div>
      {formatValue && (
        <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
          <span>min {formatValue(min)}</span>
          <span>max {formatValue(max)}</span>
        </div>
      )}
    </div>
  )
}

export default function ReportsPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [history, setHistory] = useState<ExposureHistory | null>(null)
  const [debtTrend, setDebtTrend] = useState<DebtTrend | null>(null)
  const [crownJewels, setCrownJewels] = useState<CrownJewels | null>(null)
  const [posture, setPosture] = useState<Posture | null>(null)

  const [severityFilter, setSeverityFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    let active = true
    authClient
      .getSession()
      .then((session) => {
        if (!active) return
        if (!session?.data) {
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
      const [hist, debt, cj, post] = await Promise.all([
        api.getExposureHistory(),
        api.getDebtTrend(),
        api.getCrownJewels(),
        api.getPostureReport(),
      ])
      setHistory(hist ?? null)
      setDebtTrend(debt ?? null)
      setCrownJewels(cj ?? null)
      setPosture((post?.posture ?? post) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authed) load()
  }, [authed, load])

  const historyRows = useMemo(() => history?.history ?? [], [history])
  const mttcTrend = useMemo(() => history?.mttc_trend ?? [], [history])
  const debtPoints = useMemo(() => debtTrend?.trend ?? [], [debtTrend])
  const jewels = useMemo(() => crownJewels?.resources ?? [], [crownJewels])

  const visibleHistory = useMemo(() => {
    return historyRows.filter((h) => {
      if (severityFilter && (h.severity ?? '').toLowerCase() !== severityFilter.toLowerCase()) return false
      if (statusFilter && (h.status ?? '').toLowerCase() !== statusFilter.toLowerCase()) return false
      return true
    })
  }, [historyRows, severityFilter, statusFilter])

  const severities = useMemo(() => {
    const s = new Set<string>()
    historyRows.forEach((h) => h.severity && s.add(h.severity))
    return Array.from(s).sort()
  }, [historyRows])

  const statuses = useMemo(() => {
    const s = new Set<string>()
    historyRows.forEach((h) => h.status && s.add(h.status))
    return Array.from(s).sort()
  }, [historyRows])

  const mttcChart = useMemo(
    () =>
      mttcTrend.map((p) => ({
        label: periodLabel(p),
        value: Number(p.avg_mttc_minutes ?? p.mttc_minutes ?? 0),
      })),
    [mttcTrend],
  )

  const debtChart = useMemo(
    () =>
      debtPoints.map((p) => ({
        label: periodLabel(p),
        value: Number(p.total_score ?? p.score ?? 0),
      })),
    [debtPoints],
  )

  const totalExposures = posture?.total_exposures ?? historyRows.length
  const openExposures = posture?.open_exposures ?? historyRows.filter((h) => !h.closed_at && !h.contained_at).length
  const avgMttc =
    posture?.avg_mttc_minutes ??
    posture?.mttc_minutes ??
    (() => {
      const vals = historyRows.map((h) => h.mttc_minutes).filter((v): v is number => v != null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    })()
  const grade = posture?.grade ?? null
  const overallScore = posture?.overall_score ?? null
  const maxJewel = Math.max(1, ...jewels.map((j) => Number(j.blast_radius_score ?? j.score ?? j.reachable_count ?? 0)))

  if (!authed) return <PageSpinner label="Authenticating..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Reports & Analytics</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Exposure history, mean-time-to-contain trend, rotation-debt trajectory, crown-jewel exposure, and your
            insurer-renewal posture.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          {loading ? <Spinner label="Refreshing..." /> : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner label="Loading reports..." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label="Posture grade"
              value={grade ?? (overallScore != null ? Math.round(Number(overallScore)) : '—')}
              tone={
                grade
                  ? ['A', 'B'].includes(grade.toUpperCase().charAt(0))
                    ? 'green'
                    : grade.toUpperCase().charAt(0) === 'C'
                      ? 'amber'
                      : 'red'
                  : 'default'
              }
              hint={overallScore != null ? `Score ${Math.round(Number(overallScore))}` : 'Insurer-renewal readiness'}
            />
            <Stat
              label="Open exposures"
              value={openExposures}
              tone={Number(openExposures) ? 'red' : 'green'}
              hint={`${totalExposures} total`}
            />
            <Stat label="Avg MTTC" value={fmtMinutes(avgMttc)} tone={avgMttc != null && Number(avgMttc) > 1440 ? 'amber' : 'default'} hint="Mean time to contain" />
            <Stat
              label="Crown jewels at risk"
              value={posture?.crown_jewel_count ?? jewels.length}
              tone={jewels.length ? 'amber' : 'green'}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>MTTC trend</CardTitle>
              </CardHeader>
              <CardBody>
                <LineChart points={mttcChart} color="#f59e0b" formatValue={(n) => fmtMinutes(n)} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Rotation-debt trend</CardTitle>
              </CardHeader>
              <CardBody>
                <LineChart points={debtChart} color="#ef4444" formatValue={(n) => String(Math.round(n))} />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Crown-jewel exposure</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              {jewels.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No crown jewels exposed"
                    description="No high-sensitivity resources are currently reachable through an exposed secret. Declare an exposure or compute blast radius to populate this view."
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Resource</TH>
                      <TH>Type</TH>
                      <TH>Sensitivity</TH>
                      <TH>Environment</TH>
                      <TH className="text-right">Reachable</TH>
                      <TH className="w-1/4">Blast radius</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {jewels.map((j, i) => {
                      const score = Number(j.blast_radius_score ?? j.score ?? 0)
                      return (
                        <TR key={j.id ?? j.resource_id ?? i}>
                          <TD className="font-medium text-zinc-200">{j.name ?? (j.resource_id ?? '').slice(0, 8)}</TD>
                          <TD className="text-xs text-zinc-400">{j.type ?? '—'}</TD>
                          <TD>
                            <Badge tone={severityTone(j.sensitivity)}>{j.sensitivity ?? 'unknown'}</Badge>
                          </TD>
                          <TD className="text-xs text-zinc-400">{j.environment ?? '—'}</TD>
                          <TD className="text-right tabular-nums">{j.reachable_count ?? '—'}</TD>
                          <TD>
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                                <div
                                  className="h-full rounded-full bg-red-600"
                                  style={{ width: `${Math.min(100, (score / maxJewel) * 100)}%` }}
                                />
                              </div>
                              <span className="w-10 text-right text-xs tabular-nums text-red-400">{Math.round(score)}</span>
                            </div>
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          {posture && (posture.recommendations?.length || posture.findings?.length) ? (
            <Card>
              <CardHeader>
                <CardTitle>Posture findings</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {posture.rotation_coverage_pct != null && (
                    <Stat label="Rotation coverage" value={`${Math.round(Number(posture.rotation_coverage_pct))}%`} />
                  )}
                  {posture.completeness_pct != null && (
                    <Stat label="Evidence completeness" value={`${Math.round(Number(posture.completeness_pct))}%`} />
                  )}
                  {posture.reuse_clusters != null && <Stat label="Reuse clusters" value={posture.reuse_clusters} />}
                  {posture.evidence_count != null && <Stat label="Evidence records" value={posture.evidence_count} />}
                </div>
                {posture.findings?.length ? (
                  <ul className="space-y-2">
                    {posture.findings.map((f, i) => (
                      <li key={i} className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
                        <Badge tone={severityTone(f.severity)}>{f.severity ?? 'info'}</Badge>
                        <div>
                          <div className="text-sm font-medium text-zinc-200">{f.label}</div>
                          {f.detail && <div className="text-xs text-zinc-500">{f.detail}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {posture.recommendations?.length ? (
                  <ul className="list-inside list-disc space-y-1 text-sm text-zinc-400">
                    {posture.recommendations.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Exposure history</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 focus:border-red-500 focus:outline-none"
                >
                  <option value="">All severities</option>
                  {severities.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 focus:border-red-500 focus:outline-none"
                >
                  <option value="">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {visibleHistory.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No exposure history"
                    description="Once you declare and resolve exposures, they will appear here with their containment timing and blast radius."
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Exposure</TH>
                      <TH>Severity</TH>
                      <TH>Status</TH>
                      <TH>Detected</TH>
                      <TH>Contained</TH>
                      <TH>Closed</TH>
                      <TH className="text-right">MTTC</TH>
                      <TH className="text-right">Blast radius</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {visibleHistory.map((h, i) => (
                      <TR key={h.id ?? h.exposure_id ?? i}>
                        <TD className="font-medium text-zinc-200">{h.title ?? (h.exposure_id ?? '').slice(0, 8)}</TD>
                        <TD>
                          <Badge tone={severityTone(h.severity)}>{h.severity ?? '—'}</Badge>
                        </TD>
                        <TD>
                          <Badge tone={severityTone(h.status)}>{h.status ?? '—'}</Badge>
                        </TD>
                        <TD className="text-xs text-zinc-500">{fmtDate(h.detected_at)}</TD>
                        <TD className="text-xs text-zinc-500">{fmtDate(h.contained_at)}</TD>
                        <TD className="text-xs text-zinc-500">{fmtDate(h.closed_at)}</TD>
                        <TD className="text-right tabular-nums text-zinc-300">{fmtMinutes(h.mttc_minutes)}</TD>
                        <TD className="text-right font-semibold tabular-nums text-red-400">
                          {h.blast_radius_score != null ? Math.round(Number(h.blast_radius_score)) : '—'}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
