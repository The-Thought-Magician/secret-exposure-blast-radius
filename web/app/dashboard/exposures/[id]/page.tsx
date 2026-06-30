'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, severityTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'

type Json = Record<string, any>

function fmt(ts?: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts)
  return d.toLocaleString()
}

function durationMin(a?: string | null, b?: string | null): string {
  if (!a || !b) return '—'
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  if (Number.isNaN(da) || Number.isNaN(db)) return '—'
  const mins = Math.max(0, Math.round((db - da) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

export default function ExposureDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [data, setData] = useState<Json | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editStatus, setEditStatus] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.getExposure(id)
      setData(res)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load exposure')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const exposure: Json | null = data?.exposure ?? null
  const snapshot: Json | null = data?.snapshot ?? null
  const runbook: Json | null = data?.runbook ?? null
  const timeline: Json[] = useMemo(() => {
    const t = data?.timeline
    if (Array.isArray(t)) return t
    if (Array.isArray(t?.events)) return t.events
    return []
  }, [data])
  const evidence: Json[] = useMemo(() => {
    const ev = data?.evidence
    if (Array.isArray(ev)) return ev
    if (ev) return [ev]
    return []
  }, [data])

  const runbookTasks: Json[] = useMemo(() => {
    if (Array.isArray(runbook?.tasks)) return runbook!.tasks
    return []
  }, [runbook])

  const reachable: Json[] = useMemo(() => {
    const r = snapshot?.reachable_resources
    if (Array.isArray(r)) return r
    return []
  }, [snapshot])

  const graph: Json | null = snapshot?.graph ?? null
  const graphNodes: Json[] = Array.isArray(graph?.nodes) ? graph!.nodes : []
  const graphEdges: Json[] = Array.isArray(graph?.edges) ? graph!.edges : []

  const runAction = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    setNotice(null)
    setError(null)
    try {
      await fn()
      setNotice(ok)
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const openEdit = () => {
    setEditStatus(exposure?.status ?? '')
    setEditNotes(exposure?.notes ?? '')
    setEditOpen(true)
  }

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    await runAction('edit', () => api.updateExposure(id, { status: editStatus, notes: editNotes }), 'Exposure updated')
    setEditOpen(false)
  }

  if (loading) return <PageSpinner label="Loading exposure..." />

  if (error && !exposure) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          title="Could not load exposure"
          description={error}
          icon="⚠"
          action={
            <div className="flex gap-2">
              <Button onClick={() => void load()}>Retry</Button>
              <Link href="/dashboard/exposures"><Button variant="secondary">Back to exposures</Button></Link>
            </div>
          }
        />
      </div>
    )
  }

  if (!exposure) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          title="Exposure not found"
          icon="🔍"
          action={<Link href="/dashboard/exposures"><Button variant="secondary">Back to exposures</Button></Link>}
        />
      </div>
    )
  }

  const status = String(exposure.status ?? '').toLowerCase()
  const contained = !!exposure.contained_at || status === 'contained' || status === 'closed'
  const closed = !!exposure.closed_at || status === 'closed'
  const blastScore = Number(snapshot?.score ?? exposure.blast_radius_score ?? 0)
  const verified = Number(runbook?.verified_tasks ?? 0)
  const totalTasks = Number(runbook?.total_tasks ?? runbookTasks.length ?? 0)
  const progressPct = totalTasks > 0 ? Math.round((verified / totalTasks) * 100) : 0
  const reachableCount = Number(snapshot?.reachable_count ?? reachable.length)
  const crownJewels = Number(snapshot?.crown_jewel_count ?? 0)
  const maxDepth = Number(snapshot?.max_depth ?? 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-zinc-800 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
            <Link href="/dashboard/exposures" className="hover:text-zinc-300">Exposures</Link>
            <span>/</span>
            <span className="text-zinc-400">Detail</span>
          </div>
          <h1 className="text-xl font-bold text-zinc-100">{exposure.title ?? 'Untitled exposure'}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={severityTone(exposure.severity)}>{exposure.severity ?? 'unknown'} severity</Badge>
            <Badge tone={severityTone(exposure.status)}>{exposure.status ?? 'unknown'}</Badge>
            {exposure.vector && <Badge tone="zinc">vector: {exposure.vector}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={openEdit}>Edit</Button>
          {!contained && (
            <Button
              size="sm"
              onClick={() => void runAction('contain', () => api.containExposure(id!), 'Exposure contained')}
              disabled={busy === 'contain'}
            >
              {busy === 'contain' ? <Spinner /> : 'Contain'}
            </Button>
          )}
          {contained && !closed && (
            <Button
              size="sm"
              onClick={() => void runAction('close', () => api.closeExposure(id!), 'Exposure closed')}
              disabled={busy === 'close'}
            >
              {busy === 'close' ? <Spinner /> : 'Close'}
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300">{notice}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">{error}</div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Blast radius" value={blastScore.toFixed(1)} tone={blastScore >= 70 ? 'red' : blastScore >= 40 ? 'amber' : 'green'} hint={`${reachableCount} reachable`} />
        <Stat label="Crown jewels" value={crownJewels} tone={crownJewels > 0 ? 'red' : 'green'} hint={`max depth ${maxDepth}`} />
        <Stat label="Containment" value={`${progressPct}%`} tone={progressPct >= 100 ? 'green' : progressPct > 0 ? 'amber' : 'red'} hint={`${verified}/${totalTasks} tasks verified`} />
        <Stat label="MTTC" value={durationMin(exposure.detected_at, exposure.contained_at)} hint="detect → contain" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Left column: blast radius + timeline */}
        <div className="space-y-6 xl:col-span-2">
          {/* Blast radius */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Blast Radius</CardTitle>
              <span className="text-xs text-zinc-500">{reachableCount} resources reachable</span>
            </CardHeader>
            <CardBody className="space-y-4">
              {/* Reachability bar */}
              <div>
                <div className="mb-1 flex justify-between text-xs text-zinc-500">
                  <span>Severity score</span>
                  <span className="tabular-nums">{blastScore.toFixed(1)} / 100</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`h-full ${blastScore >= 70 ? 'bg-red-500' : blastScore >= 40 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, Math.max(2, blastScore))}%` }}
                  />
                </div>
              </div>

              {reachable.length === 0 ? (
                <EmptyState title="No reachable resources recorded" description="The blast-radius snapshot has no resource paths." />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Resource</TH>
                      <TH>Type</TH>
                      <TH>Sensitivity</TH>
                      <TH className="text-right">Depth</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {reachable.map((r, i) => {
                      const name = r.name ?? r.resource_name ?? r.id ?? `Resource ${i + 1}`
                      const sens = String(r.sensitivity ?? '').toLowerCase()
                      return (
                        <TR key={r.id ?? i}>
                          <TD className="font-medium text-zinc-200">{name}</TD>
                          <TD>{r.type ?? '—'}</TD>
                          <TD>
                            {r.sensitivity ? (
                              <Badge tone={sens === 'crown_jewel' || sens === 'critical' ? 'red' : sens === 'high' ? 'amber' : 'zinc'}>
                                {r.sensitivity}
                              </Badge>
                            ) : '—'}
                          </TD>
                          <TD className="text-right tabular-nums">{r.depth ?? r.path?.length ?? '—'}</TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}

              {(graphNodes.length > 0 || graphEdges.length > 0) && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Reachability graph</div>
                  <div className="flex flex-wrap gap-2">
                    {graphNodes.map((n, i) => {
                      const kind = String(n.kind ?? n.type ?? '').toLowerCase()
                      const isSecret = kind.includes('secret')
                      return (
                        <span
                          key={n.id ?? i}
                          className={`inline-flex items-center rounded-md border px-2 py-1 text-xs ${
                            isSecret ? 'border-red-900/60 bg-red-950/40 text-red-300' : 'border-zinc-700 bg-zinc-800 text-zinc-300'
                          }`}
                        >
                          {isSecret ? '🔑 ' : '◆ '}
                          {n.label ?? n.name ?? n.id}
                        </span>
                      )
                    })}
                  </div>
                  <div className="mt-2 text-xs text-zinc-600">{graphNodes.length} nodes · {graphEdges.length} edges</div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Incident Timeline</CardTitle>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void runAction('reconstruct', () => api.reconstructTimeline(id!), 'Timeline reconstructed from access logs')}
                disabled={busy === 'reconstruct'}
              >
                {busy === 'reconstruct' ? <Spinner /> : 'Reconstruct'}
              </Button>
            </CardHeader>
            <CardBody>
              {timeline.length === 0 ? (
                <EmptyState
                  title="No timeline events"
                  description="Run reconstruct to pull access-log activity within the exposure window."
                />
              ) : (
                <ol className="relative space-y-4 border-l border-zinc-800 pl-5">
                  {timeline.map((ev, i) => (
                    <li key={ev.id ?? i} className="relative">
                      <span
                        className={`absolute -left-[1.42rem] top-1 h-2.5 w-2.5 rounded-full ${
                          ev.anomalous ? 'bg-red-500 ring-2 ring-red-900/60' : 'bg-zinc-600'
                        }`}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-zinc-200">{ev.kind ?? 'event'}</span>
                        {ev.anomalous && <Badge tone="red">anomalous</Badge>}
                        <span className="text-xs text-zinc-500">{fmt(ev.occurred_at ?? ev.created_at)}</span>
                      </div>
                      {ev.description && <p className="mt-0.5 text-sm text-zinc-400">{ev.description}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right column: runbook + evidence + meta */}
        <div className="space-y-6">
          {/* Runbook */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Runbook</CardTitle>
              {runbook?.status && <Badge tone={severityTone(runbook.status)}>{runbook.status}</Badge>}
            </CardHeader>
            <CardBody>
              {!runbook ? (
                <EmptyState title="No runbook" description="A runbook is generated when an exposure is declared." />
              ) : (
                <>
                  <div className="mb-3">
                    <div className="mb-1 flex justify-between text-xs text-zinc-500">
                      <span>Verified tasks</span>
                      <span className="tabular-nums">{verified}/{totalTasks}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full bg-emerald-500" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                  {runbookTasks.length === 0 ? (
                    <p className="text-sm text-zinc-500">No tasks in this runbook.</p>
                  ) : (
                    <ul className="space-y-2">
                      {runbookTasks.map((t, i) => {
                        const st = String(t.status ?? '').toLowerCase()
                        return (
                          <li key={t.id ?? i} className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                            <span className="mt-0.5">
                              {st === 'verified' || st === 'done' ? '✅' : st === 'in_progress' ? '🟡' : '⬜'}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-zinc-200">{t.description ?? t.kind ?? 'Task'}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                {t.kind && <span>{t.kind}</span>}
                                <Badge tone={severityTone(t.status)}>{t.status ?? 'pending'}</Badge>
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <div className="mt-3">
                    <Link href="/dashboard/runbooks" className="text-xs text-red-400 hover:text-red-300">Open runbooks →</Link>
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          {/* Evidence */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Evidence</CardTitle>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void runAction('evidence', () => api.generateEvidence(id!), 'Signed evidence record generated')}
                disabled={busy === 'evidence' || !contained}
                title={!contained ? 'Contain the exposure first' : undefined}
              >
                {busy === 'evidence' ? <Spinner /> : 'Generate'}
              </Button>
            </CardHeader>
            <CardBody>
              {!contained && (
                <p className="mb-3 text-xs text-amber-400">Evidence can be generated once the exposure is contained.</p>
              )}
              {evidence.length === 0 ? (
                <EmptyState title="No evidence records" description="Generate a signed evidence bundle for insurers and auditors." />
              ) : (
                <ul className="space-y-2">
                  {evidence.map((ev, i) => (
                    <li key={ev.id ?? i} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-200">Evidence #{String(ev.id ?? i + 1).slice(0, 8)}</span>
                        <Badge tone="green">{Number(ev.completeness_pct ?? 0).toFixed(0)}% complete</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                        <span>MTTC: {ev.mttc_minutes != null ? `${ev.mttc_minutes}m` : '—'}</span>
                        <span>Signed: {fmt(ev.signed_at)}</span>
                      </div>
                      {ev.content_hash && (
                        <div className="mt-1 truncate font-mono text-[11px] text-zinc-600" title={ev.content_hash}>
                          {ev.content_hash}
                        </div>
                      )}
                      <Link href="/dashboard/evidence" className="mt-1 inline-block text-xs text-red-400 hover:text-red-300">View all evidence →</Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Meta */}
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardBody>
              <dl className="space-y-2 text-sm">
                {[
                  ['Exposed since', fmt(exposure.exposed_since)],
                  ['Detected', fmt(exposure.detected_at)],
                  ['Contained', fmt(exposure.contained_at)],
                  ['Closed', fmt(exposure.closed_at)],
                  ['Created', fmt(exposure.created_at)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-zinc-500">{k}</dt>
                    <dd className="text-right text-zinc-300">{v}</dd>
                  </div>
                ))}
              </dl>
              {exposure.notes && (
                <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-300">
                  {exposure.notes}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Update exposure"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={submitEdit} disabled={busy === 'edit'}>{busy === 'edit' ? <Spinner /> : 'Save'}</Button>
          </>
        }
      >
        <form onSubmit={submitEdit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Status</label>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
            >
              {['detected', 'analyzing', 'contained', 'closed'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Notes</label>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
              placeholder="Investigation notes..."
            />
          </div>
        </form>
      </Modal>
    </div>
  )
}
