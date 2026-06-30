'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge, severityTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Secret {
  id: string
  name: string
  type?: string
  owning_service?: string
  environment?: string
  criticality?: string
  fingerprint?: string
  last_four?: string
  status?: string
  max_age_days?: number
  last_rotated_at?: string | null
  reuse_cluster_id?: string | null
  tags?: string[]
  scopes?: string[]
  created_at?: string
}
interface Grant { id: string; resource_id: string; resource_name?: string; permission?: string; scope?: string; confidence?: number }
interface Copy { id: string; store_id: string; store_name?: string; rotated?: boolean; last_seen_at?: string | null }
interface ReuseInfo { id?: string; fingerprint?: string; secret_count?: number; risk_score?: number; secrets?: Array<{ id: string; name: string }> }
interface BlastNode { id: string; label?: string; name?: string; type?: string; sensitivity?: string; depth?: number; crown_jewel?: boolean }
interface BlastEdge { from?: string; to?: string; source?: string; target?: string; permission?: string }
interface BlastRadius {
  score?: number
  reachable_count?: number
  crown_jewel_count?: number
  max_depth?: number
  reachable_resources?: Array<{ id: string; name?: string; type?: string; sensitivity?: string; depth?: number; path?: string[]; crown_jewel?: boolean }>
  graph?: { nodes?: BlastNode[]; edges?: BlastEdge[] }
}
interface Discovery {
  copies?: Copy[]
  unrotated?: Copy[]
  gaps?: Array<{ store_id?: string; store_name?: string; reason?: string }>
}

const STATUSES = ['active', 'rotating', 'compromised', 'retired']
const CRITICALITIES = ['critical', 'high', 'medium', 'low']
const inputCls = 'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none'
const labelCls = 'mb-1 block text-xs font-medium text-zinc-400'

function ageDays(iso?: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

// Simple radial SVG graph: secret at center, resources placed on rings by depth.
function BlastGraph({ graph, secretName }: { graph?: { nodes?: BlastNode[]; edges?: BlastEdge[] }; secretName: string }) {
  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  if (nodes.length === 0) {
    return <p className="text-sm text-zinc-500">No reachability graph available. Add grant edges from this secret to resources.</p>
  }
  const W = 640
  const H = 420
  const cx = W / 2
  const cy = H / 2
  const maxDepth = Math.max(1, ...nodes.map((n) => n.depth ?? 1))
  const byDepth: Record<number, BlastNode[]> = {}
  for (const n of nodes) {
    const d = Math.max(1, n.depth ?? 1)
    ;(byDepth[d] ??= []).push(n)
  }
  const pos: Record<string, { x: number; y: number; node: BlastNode }> = {}
  for (const [dStr, list] of Object.entries(byDepth)) {
    const d = Number(dStr)
    const r = (Math.min(W, H) / 2 - 50) * (d / maxDepth)
    list.forEach((n, i) => {
      const angle = (i / list.length) * Math.PI * 2 - Math.PI / 2
      pos[n.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), node: n }
    })
  }
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px]" role="img" aria-label="Blast radius graph">
        {[...Array(maxDepth)].map((_, i) => {
          const r = (Math.min(W, H) / 2 - 50) * ((i + 1) / maxDepth)
          return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke="#27272a" strokeDasharray="3 4" />
        })}
        {edges.map((e, i) => {
          const a = pos[(e.from ?? e.source) ?? '']
          const b = pos[(e.to ?? e.target) ?? '']
          const from = a ?? { x: cx, y: cy }
          if (!b) return null
          return <line key={i} x1={from.x} y1={from.y} x2={b.x} y2={b.y} stroke="#3f3f46" strokeWidth={1} />
        })}
        {Object.values(pos).map(({ x, y, node }) => (
          <g key={node.id}>
            <circle cx={x} cy={y} r={node.crown_jewel ? 9 : 6} fill={node.crown_jewel ? '#ef4444' : '#71717a'} stroke="#18181b" strokeWidth={2} />
            <text x={x} y={y - 12} textAnchor="middle" className="fill-zinc-400" fontSize={10}>
              {(node.label ?? node.name ?? node.id).slice(0, 18)}
            </text>
          </g>
        ))}
        <circle cx={cx} cy={cy} r={14} fill="#dc2626" stroke="#18181b" strokeWidth={3} />
        <text x={cx} y={cy + 30} textAnchor="middle" className="fill-zinc-200" fontSize={11} fontWeight="bold">
          {secretName.slice(0, 22)}
        </text>
      </svg>
    </div>
  )
}

export default function SecretDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = String(params?.id ?? '')

  const [secret, setSecret] = useState<Secret | null>(null)
  const [grants, setGrants] = useState<Grant[]>([])
  const [copies, setCopies] = useState<Copy[]>([])
  const [reuse, setReuse] = useState<ReuseInfo | null>(null)
  const [blast, setBlast] = useState<BlastRadius | null>(null)
  const [discovery, setDiscovery] = useState<Discovery | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [blastLoading, setBlastLoading] = useState(false)
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editErr, setEditErr] = useState('')

  const [form, setForm] = useState({ name: '', status: 'active', criticality: 'high', max_age_days: 90, owning_service: '' })

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const res = await api.getSecret(id)
      const sec: Secret = res?.secret ?? res
      setSecret(sec)
      setGrants(res?.grants ?? [])
      setCopies(res?.copies ?? [])
      setReuse(res?.reuse ?? null)
      setForm({
        name: sec?.name ?? '',
        status: sec?.status ?? 'active',
        criticality: sec?.criticality ?? 'high',
        max_age_days: sec?.max_age_days ?? 90,
        owning_service: sec?.owning_service ?? '',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load secret')
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadBlast = useCallback(async () => {
    if (!id) return
    setBlastLoading(true)
    try {
      const res = await api.getBlastRadius(id)
      setBlast(res ?? null)
    } catch {
      setBlast(null)
    } finally {
      setBlastLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
    void loadBlast()
  }, [load, loadBlast])

  const handleRotate = async () => {
    if (!confirm('Mark this secret as rotated? This stamps last_rotated_at and resets rotation debt.')) return
    setRotating(true)
    try {
      const updated = await api.rotateSecret(id)
      setSecret((prev) => ({ ...(prev ?? {} as Secret), ...(updated?.secret ?? updated) }))
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to rotate secret')
    } finally {
      setRotating(false)
    }
  }

  const handleDiscover = async () => {
    setDiscoverLoading(true)
    try {
      const res = await api.discoverCopies(id)
      setDiscovery(res ?? null)
      if (Array.isArray(res?.copies)) setCopies(res.copies)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Copy discovery failed')
    } finally {
      setDiscoverLoading(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setEditErr('')
    try {
      await api.updateSecret(id, {
        name: form.name.trim(),
        status: form.status,
        criticality: form.criticality,
        max_age_days: Number(form.max_age_days) || null,
        owning_service: form.owning_service.trim() || null,
      })
      setShowEdit(false)
      await load()
    } catch (err) {
      setEditErr(err instanceof Error ? err.message : 'Failed to update secret')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSpinner label="Loading secret..." />

  if (error || !secret) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <Card className="border-red-900/60">
          <CardBody>
            <h2 className="text-sm font-semibold text-red-300">Could not load secret</h2>
            <p className="mt-1 text-sm text-zinc-400">{error || 'Secret not found.'}</p>
            <div className="mt-4 flex gap-2">
              <Button onClick={load}>Retry</Button>
              <Link href="/dashboard/secrets"><Button variant="secondary">Back to registry</Button></Link>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  const age = ageDays(secret.last_rotated_at)
  const stale = age != null && secret.max_age_days != null && age > secret.max_age_days

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/secrets" className="text-sm text-zinc-500 hover:text-red-400">← Secret registry</Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-100">{secret.name}</h1>
            {secret.status && <Badge tone={severityTone(secret.status)}>{secret.status}</Badge>}
            {secret.criticality && <Badge tone={severityTone(secret.criticality)}>{secret.criticality}</Badge>}
            {secret.environment && <Badge tone={secret.environment === 'production' ? 'red' : 'zinc'}>{secret.environment}</Badge>}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {secret.type ?? 'secret'}{secret.owning_service ? ` · ${secret.owning_service}` : ''}{secret.last_four ? ` · ····${secret.last_four}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setEditErr(''); setShowEdit(true) }}>Edit</Button>
          <Button onClick={handleRotate} disabled={rotating}>{rotating ? 'Rotating...' : 'Rotate secret'}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Blast score" value={blastLoading ? '…' : Math.round(blast?.score ?? 0)} tone={(blast?.score ?? 0) > 50 ? 'red' : 'default'} />
        <Stat label="Reachable resources" value={blastLoading ? '…' : blast?.reachable_count ?? grants.length} />
        <Stat label="Crown jewels" value={blastLoading ? '…' : blast?.crown_jewel_count ?? 0} tone={(blast?.crown_jewel_count ?? 0) > 0 ? 'red' : 'default'} />
        <Stat
          label="Last rotated"
          value={age == null ? 'never' : `${age}d`}
          tone={stale ? 'red' : age == null ? 'amber' : 'green'}
          hint={`Max age ${secret.max_age_days ?? '—'}d`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Blast radius</CardTitle>
            <Button size="sm" variant="ghost" onClick={loadBlast} disabled={blastLoading}>{blastLoading ? 'Computing...' : 'Recompute'}</Button>
          </CardHeader>
          <CardBody className="space-y-5">
            <BlastGraph graph={blast?.graph} secretName={secret.name} />
            {blast?.reachable_resources && blast.reachable_resources.length > 0 ? (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Reachable resources & paths</div>
                <Table>
                  <THead>
                    <TR><TH>Resource</TH><TH>Type</TH><TH>Sensitivity</TH><TH>Depth</TH><TH>Path</TH></TR>
                  </THead>
                  <TBody>
                    {blast.reachable_resources.map((r) => (
                      <TR key={r.id}>
                        <TD>
                          <span className="font-medium text-zinc-200">{r.name ?? r.id}</span>
                          {r.crown_jewel && <Badge tone="red" className="ml-2">crown jewel</Badge>}
                        </TD>
                        <TD>{r.type ?? '—'}</TD>
                        <TD>{r.sensitivity ? <Badge tone={severityTone(r.sensitivity)}>{r.sensitivity}</Badge> : '—'}</TD>
                        <TD className="tabular-nums">{r.depth ?? '—'}</TD>
                        <TD className="text-xs text-zinc-500">{Array.isArray(r.path) ? r.path.join(' → ') : '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            ) : !blastLoading ? (
              <p className="text-sm text-zinc-500">Nothing reachable from this secret yet.</p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Grants ({grants.length})</CardTitle></CardHeader>
          <CardBody>
            {grants.length === 0 ? (
              <p className="text-sm text-zinc-500">No grant edges. This secret has no direct resource access wired in.</p>
            ) : (
              <Table>
                <THead>
                  <TR><TH>Resource</TH><TH>Permission</TH><TH>Confidence</TH></TR>
                </THead>
                <TBody>
                  {grants.map((g) => (
                    <TR key={g.id}>
                      <TD>
                        <Link href={`/dashboard/resources`} className="text-zinc-200 hover:text-red-400">{g.resource_name ?? g.resource_id}</Link>
                        {g.scope && <div className="text-xs text-zinc-500">{g.scope}</div>}
                      </TD>
                      <TD>{g.permission ? <Badge tone="zinc">{g.permission}</Badge> : '—'}</TD>
                      <TD className="tabular-nums text-zinc-400">{g.confidence != null ? `${Math.round(g.confidence * 100)}%` : '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Copies ({copies.length})</CardTitle>
            <Button size="sm" variant="ghost" onClick={handleDiscover} disabled={discoverLoading}>
              {discoverLoading ? 'Discovering...' : 'Discover copies'}
            </Button>
          </CardHeader>
          <CardBody className="space-y-4">
            {copies.length === 0 ? (
              <p className="text-sm text-zinc-500">No copies registered. Run discovery to find this secret across stores.</p>
            ) : (
              <Table>
                <THead>
                  <TR><TH>Store</TH><TH>Rotated</TH><TH>Last seen</TH></TR>
                </THead>
                <TBody>
                  {copies.map((c) => (
                    <TR key={c.id}>
                      <TD className="text-zinc-200">{c.store_name ?? c.store_id}</TD>
                      <TD>{c.rotated ? <Badge tone="green">rotated</Badge> : <Badge tone="red">stale</Badge>}</TD>
                      <TD className="text-zinc-400">{fmtDate(c.last_seen_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {discovery && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
                <div className="font-medium text-zinc-200">Discovery result</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge tone="zinc">{discovery.copies?.length ?? 0} live copies</Badge>
                  <Badge tone="red">{discovery.unrotated?.length ?? 0} unrotated</Badge>
                  <Badge tone="amber">{discovery.gaps?.length ?? 0} gaps</Badge>
                </div>
                {discovery.gaps && discovery.gaps.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-xs text-zinc-500">
                    {discovery.gaps.map((g, i) => <li key={i}>{g.store_name ?? g.store_id ?? 'store'}: {g.reason ?? 'gap detected'}</li>)}
                  </ul>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Reuse cluster</CardTitle></CardHeader>
          <CardBody>
            {reuse && (reuse.id || reuse.fingerprint) ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone="amber">{reuse.secret_count ?? reuse.secrets?.length ?? 0} secrets share this fingerprint</Badge>
                  {reuse.risk_score != null && <Badge tone="red">risk {Math.round(reuse.risk_score)}</Badge>}
                  {reuse.fingerprint && <span className="font-mono text-xs text-zinc-500">{reuse.fingerprint.slice(0, 32)}</span>}
                </div>
                {reuse.secrets && reuse.secrets.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {reuse.secrets.map((s) => (
                      <Link key={s.id} href={`/dashboard/secrets/${s.id}`}>
                        <Badge tone={s.id === secret.id ? 'red' : 'zinc'}>{s.name}</Badge>
                      </Link>
                    ))}
                  </div>
                )}
                <Link href="/dashboard/reuse" className="inline-block text-sm font-medium text-red-400 hover:text-red-300">View all reuse clusters →</Link>
              </div>
            ) : (
              <EmptyState title="Not reused" description="This secret's fingerprint is unique. No other managed secret shares it." className="py-8" />
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        open={showEdit}
        onClose={() => !saving && setShowEdit(false)}
        title="Edit secret"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowEdit(false)} disabled={saving}>Cancel</Button>
            <Button form="edit-secret-form" type="submit" disabled={saving}>{saving ? <Spinner label="Saving..." /> : 'Save changes'}</Button>
          </>
        }
      >
        <form id="edit-secret-form" onSubmit={handleSave} className="space-y-3">
          {editErr && <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-2 text-sm text-red-300">{editErr}</div>}
          <div>
            <label className={labelCls}>Name</label>
            <input required className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Owning service</label>
            <input className={inputCls} value={form.owning_service} onChange={(e) => setForm({ ...form, owning_service: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Status</label>
              <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Criticality</label>
              <select className={inputCls} value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })}>
                {CRITICALITIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Max age (days)</label>
            <input type="number" min={1} className={inputCls} value={form.max_age_days} onChange={(e) => setForm({ ...form, max_age_days: Number(e.target.value) })} />
          </div>
        </form>
      </Modal>
    </div>
  )
}
