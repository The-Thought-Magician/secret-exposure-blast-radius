'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, severityTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Secret {
  id: string
  name: string
  type?: string
  environment?: string
  criticality?: string
}

interface Simulation {
  id: string
  secret_id?: string
  template?: string
  status?: string
  blast_radius_score?: number | null
  time_to_contain_minutes?: number | null
  tasks_completed?: number | null
  total_tasks?: number | null
  score?: number | null
  result?: Record<string, unknown> | null
  created_at?: string
}

const TEMPLATES = [
  { value: 'cloud-key-leak', label: 'Cloud Key Leak', blurb: 'IAM/cloud credential pushed to a public repo.' },
  { value: 'ci-token-exposure', label: 'CI Token Exposure', blurb: 'Pipeline token printed to build logs.' },
  { value: 'db-credential-dump', label: 'DB Credential Dump', blurb: 'Database password found in a config backup.' },
  { value: 'oauth-app-compromise', label: 'OAuth App Compromise', blurb: 'Third-party OAuth client secret reused.' },
  { value: 'webhook-signing-key', label: 'Webhook Signing Key', blurb: 'Signing secret committed to a gist.' },
]

function fmtDate(d?: string) {
  if (!d) return '—'
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString()
}

function scoreTone(score?: number | null): 'red' | 'amber' | 'green' {
  const s = score ?? 0
  if (s >= 70) return 'red'
  if (s >= 40) return 'amber'
  return 'green'
}

export default function SimulationsPage() {
  const [sims, setSims] = useState<Simulation[]>([])
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  // create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [formSecret, setFormSecret] = useState('')
  const [formTemplate, setFormTemplate] = useState(TEMPLATES[0].value)
  const [formError, setFormError] = useState<string | null>(null)

  // detail drawer
  const [detail, setDetail] = useState<Simulation | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // score modal
  const [scoreFor, setScoreFor] = useState<Simulation | null>(null)
  const [scoreTtc, setScoreTtc] = useState('')
  const [scoreTasks, setScoreTasks] = useState('')
  const [scoring, setScoring] = useState(false)
  const [scoreErr, setScoreErr] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [s, sec] = await Promise.all([api.getSimulations(), api.getSecrets()])
      setSims(Array.isArray(s) ? s : [])
      setSecrets(Array.isArray(sec) ? sec : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load simulations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const secretName = useMemo(() => {
    const map = new Map<string, string>()
    secrets.forEach((s) => map.set(s.id, s.name))
    return (id?: string) => (id ? map.get(id) ?? id.slice(0, 8) : '—')
  }, [secrets])

  const filtered = useMemo(() => {
    return sims.filter((s) => {
      if (statusFilter !== 'all' && (s.status ?? '') !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${s.template ?? ''} ${secretName(s.secret_id)} ${s.status ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [sims, statusFilter, search, secretName])

  const stats = useMemo(() => {
    const total = sims.length
    const scored = sims.filter((s) => s.score != null)
    const avgScore = scored.length
      ? Math.round(scored.reduce((a, s) => a + (s.score ?? 0), 0) / scored.length)
      : 0
    const ttcVals = sims.map((s) => s.time_to_contain_minutes).filter((v): v is number => v != null)
    const avgTtc = ttcVals.length ? Math.round(ttcVals.reduce((a, v) => a + v, 0) / ttcVals.length) : 0
    const pending = sims.filter((s) => (s.status ?? '') !== 'scored' && (s.status ?? '') !== 'complete').length
    return { total, avgScore, avgTtc, pending }
  }, [sims])

  const statuses = useMemo(() => {
    const set = new Set<string>()
    sims.forEach((s) => s.status && set.add(s.status))
    return Array.from(set).sort()
  }, [sims])

  async function submitCreate() {
    if (!formSecret) {
      setFormError('Pick a secret to drill against.')
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      await api.createSimulation({ secret_id: formSecret, template: formTemplate })
      setCreateOpen(false)
      setFormSecret('')
      setFormTemplate(TEMPLATES[0].value)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to start simulation')
    } finally {
      setCreating(false)
    }
  }

  async function openDetail(sim: Simulation) {
    setDetail(sim)
    setDetailLoading(true)
    try {
      const full = await api.getSimulation(sim.id)
      if (full && typeof full === 'object') setDetail(full as Simulation)
    } catch {
      // keep the row-level data we already have
    } finally {
      setDetailLoading(false)
    }
  }

  async function submitScore() {
    if (!scoreFor) return
    setScoring(true)
    setScoreErr(null)
    try {
      const body: Record<string, number> = {}
      if (scoreTtc !== '') body.time_to_contain_minutes = Number(scoreTtc)
      if (scoreTasks !== '') body.tasks_completed = Number(scoreTasks)
      await api.scoreSimulation(scoreFor.id, body)
      setScoreFor(null)
      setScoreTtc('')
      setScoreTasks('')
      await load()
    } catch (e) {
      setScoreErr(e instanceof Error ? e.message : 'Failed to score run')
    } finally {
      setScoring(false)
    }
  }

  async function remove(sim: Simulation) {
    if (!confirm('Delete this simulation run?')) return
    setBusyId(sim.id)
    try {
      await api.deleteSimulation(sim.id)
      if (detail?.id === sim.id) setDetail(null)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading tabletop simulations..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Tabletop Simulator</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Rehearse a credential-leak incident end to end. Pick a secret, run a scenario template against a sandboxed
            blast radius, then score how fast the team contained it.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={secrets.length === 0}>
          + New Simulation
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error} <button className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total Runs" value={stats.total} />
        <Stat label="Pending Score" value={stats.pending} tone={stats.pending ? 'amber' : 'default'} />
        <Stat label="Avg Score" value={`${stats.avgScore}`} tone={stats.avgScore >= 70 ? 'green' : stats.avgScore >= 40 ? 'amber' : 'red'} hint="0–100, higher is better" />
        <Stat label="Avg Time to Contain" value={`${stats.avgTtc}m`} hint="across scored runs" />
      </div>

      {secrets.length === 0 && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          You have no secrets registered yet. Add a secret in the registry before running a tabletop drill.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Simulation Runs</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search template / secret..."
              className="w-52 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-700 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={sims.length === 0 ? 'No simulations yet' : 'No runs match your filters'}
                description={
                  sims.length === 0
                    ? 'Start your first tabletop drill to practice containment under pressure.'
                    : 'Try clearing the search or status filter.'
                }
                action={
                  sims.length === 0 && secrets.length > 0 ? (
                    <Button onClick={() => setCreateOpen(true)}>+ New Simulation</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Scenario</TH>
                  <TH>Secret</TH>
                  <TH>Status</TH>
                  <TH>Blast Radius</TH>
                  <TH>Tasks</TH>
                  <TH>TTC</TH>
                  <TH>Score</TH>
                  <TH>Started</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </THead>
              <TBody>
                {filtered.map((sim) => {
                  const tmpl = TEMPLATES.find((t) => t.value === sim.template)
                  const taskTotal = sim.total_tasks ?? 0
                  const done = sim.tasks_completed ?? 0
                  const pct = taskTotal ? Math.round((done / taskTotal) * 100) : 0
                  return (
                    <TR key={sim.id} className="cursor-pointer" onClick={() => openDetail(sim)}>
                      <TD className="font-medium text-zinc-100">{tmpl?.label ?? sim.template ?? 'Scenario'}</TD>
                      <TD>{secretName(sim.secret_id)}</TD>
                      <TD>
                        <Badge tone={severityTone(sim.status)}>{sim.status ?? 'pending'}</Badge>
                      </TD>
                      <TD>
                        {sim.blast_radius_score != null ? (
                          <Badge tone={scoreTone(sim.blast_radius_score)}>{Math.round(sim.blast_radius_score)}</Badge>
                        ) : '—'}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
                            <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-zinc-500">{done}/{taskTotal}</span>
                        </div>
                      </TD>
                      <TD>{sim.time_to_contain_minutes != null ? `${sim.time_to_contain_minutes}m` : '—'}</TD>
                      <TD>
                        {sim.score != null ? (
                          <span className={`font-semibold ${scoreTone(sim.score) === 'red' ? 'text-red-400' : scoreTone(sim.score) === 'amber' ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {Math.round(sim.score)}
                          </span>
                        ) : '—'}
                      </TD>
                      <TD className="text-zinc-500">{fmtDate(sim.created_at)}</TD>
                      <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setScoreFor(sim)
                              setScoreTtc(sim.time_to_contain_minutes != null ? String(sim.time_to_contain_minutes) : '')
                              setScoreTasks(sim.tasks_completed != null ? String(sim.tasks_completed) : '')
                              setScoreErr(null)
                            }}
                          >
                            Score
                          </Button>
                          <Button size="sm" variant="danger" disabled={busyId === sim.id} onClick={() => remove(sim)}>
                            {busyId === sim.id ? '…' : 'Delete'}
                          </Button>
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

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="New Tabletop Simulation"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={submitCreate} disabled={creating}>
              {creating ? <Spinner label="Running..." /> : 'Run Simulation'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{formError}</div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Secret under drill</label>
            <select
              value={formSecret}
              onChange={(e) => setFormSecret(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            >
              <option value="">Select a secret...</option>
              {secrets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.environment ? ` · ${s.environment}` : ''}{s.criticality ? ` · ${s.criticality}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Scenario template</label>
            <div className="space-y-2">
              {TEMPLATES.map((t) => (
                <label
                  key={t.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${formTemplate === t.value ? 'border-red-700 bg-red-950/20' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}`}
                >
                  <input
                    type="radio"
                    name="template"
                    checked={formTemplate === t.value}
                    onChange={() => setFormTemplate(t.value)}
                    className="mt-1 accent-red-600"
                  />
                  <span>
                    <span className="block text-sm font-medium text-zinc-200">{t.label}</span>
                    <span className="block text-xs text-zinc-500">{t.blurb}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Score modal */}
      <Modal
        open={scoreFor != null}
        onClose={() => !scoring && setScoreFor(null)}
        title="Score Simulation Run"
        footer={
          <>
            <Button variant="ghost" onClick={() => setScoreFor(null)} disabled={scoring}>Cancel</Button>
            <Button onClick={submitScore} disabled={scoring}>
              {scoring ? <Spinner label="Scoring..." /> : 'Submit Score'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {scoreErr && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{scoreErr}</div>
          )}
          <p className="text-sm text-zinc-500">
            Record how the drill went. The backend converts time-to-contain and tasks completed into a 0–100 grade.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Time to contain (minutes)</label>
            <input
              type="number"
              min={0}
              value={scoreTtc}
              onChange={(e) => setScoreTtc(e.target.value)}
              placeholder="e.g. 45"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Tasks completed{scoreFor?.total_tasks != null ? ` (of ${scoreFor.total_tasks})` : ''}
            </label>
            <input
              type="number"
              min={0}
              max={scoreFor?.total_tasks ?? undefined}
              value={scoreTasks}
              onChange={(e) => setScoreTasks(e.target.value)}
              placeholder="e.g. 6"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal open={detail != null} onClose={() => setDetail(null)} title="Simulation Detail" className="max-w-2xl">
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={severityTone(detail.status)}>{detail.status ?? 'pending'}</Badge>
              <span className="text-sm font-medium text-zinc-200">
                {TEMPLATES.find((t) => t.value === detail.template)?.label ?? detail.template}
              </span>
              <span className="text-xs text-zinc-500">· {secretName(detail.secret_id)}</span>
              {detailLoading && <Spinner />}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Blast Radius" value={detail.blast_radius_score != null ? Math.round(detail.blast_radius_score) : '—'} tone={scoreTone(detail.blast_radius_score)} />
              <Stat label="Score" value={detail.score != null ? Math.round(detail.score) : '—'} tone={scoreTone(detail.score)} />
              <Stat label="TTC" value={detail.time_to_contain_minutes != null ? `${detail.time_to_contain_minutes}m` : '—'} />
              <Stat label="Tasks" value={`${detail.tasks_completed ?? 0}/${detail.total_tasks ?? 0}`} />
            </div>
            {detail.result != null && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Result payload</div>
                <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                  {JSON.stringify(detail.result, null, 2)}
                </pre>
              </div>
            )}
            <div className="text-xs text-zinc-600">Started {fmtDate(detail.created_at)}</div>
          </div>
        )}
      </Modal>
    </div>
  )
}
