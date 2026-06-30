'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner, PageSpinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Grant {
  id: string
  secret_id: string
  resource_id: string
  permission: string
  scope?: string | null
  confidence?: number | null
  created_at?: string
}

interface Secret {
  id: string
  name: string
  type?: string
  environment?: string
  criticality?: string
}

interface Resource {
  id: string
  name: string
  type?: string
  sensitivity?: string
  environment?: string
}

const PERMISSIONS = ['read', 'write', 'admin', 'delete', 'list', 'full-access']

function confidenceTone(c: number): 'green' | 'amber' | 'red' | 'zinc' {
  if (c >= 0.8) return 'green'
  if (c >= 0.5) return 'amber'
  if (c > 0) return 'red'
  return 'zinc'
}

const emptyForm = {
  secret_id: '',
  resource_id: '',
  permission: 'read',
  scope: '',
  confidence: 1,
}

export default function GrantsPage() {
  const [grants, setGrants] = useState<Grant[]>([])
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [secretFilter, setSecretFilter] = useState('all')
  const [resourceFilter, setResourceFilter] = useState('all')
  const [permFilter, setPermFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Grant | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const secretMap = useMemo(() => new Map(secrets.map((s) => [s.id, s])), [secrets])
  const resourceMap = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [g, s, r] = await Promise.all([api.getGrants(), api.getSecrets(), api.getResources()])
      setGrants(Array.isArray(g) ? g : g?.grants ?? [])
      setSecrets(Array.isArray(s) ? s : s?.secrets ?? [])
      setResources(Array.isArray(r) ? r : r?.resources ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load grants')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    return grants.filter((g) => {
      if (secretFilter !== 'all' && g.secret_id !== secretFilter) return false
      if (resourceFilter !== 'all' && g.resource_id !== resourceFilter) return false
      if (permFilter !== 'all' && g.permission !== permFilter) return false
      if (search) {
        const sn = secretMap.get(g.secret_id)?.name ?? ''
        const rn = resourceMap.get(g.resource_id)?.name ?? ''
        if (!`${sn} ${rn} ${g.scope ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [grants, secretFilter, resourceFilter, permFilter, search, secretMap, resourceMap])

  const totals = useMemo(() => {
    const privileged = grants.filter((g) => ['admin', 'write', 'delete', 'full-access'].includes(g.permission)).length
    const lowConf = grants.filter((g) => (g.confidence ?? 1) < 0.5).length
    const connectedResources = new Set(grants.map((g) => g.resource_id)).size
    return { privileged, lowConf, connectedResources }
  }, [grants])

  // Per-secret fan-out (how many resources each secret reaches)
  const fanOut = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of grants) m.set(g.secret_id, (m.get(g.secret_id) ?? 0) + 1)
    return [...m.entries()]
      .map(([id, count]) => ({ id, name: secretMap.get(id)?.name ?? id.slice(0, 8), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  }, [grants, secretMap])
  const maxFan = Math.max(1, ...fanOut.map((f) => f.count))

  function openCreate() {
    setEditing(null)
    setForm({
      ...emptyForm,
      secret_id: secrets[0]?.id ?? '',
      resource_id: resources[0]?.id ?? '',
    })
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(g: Grant) {
    setEditing(g)
    setForm({
      secret_id: g.secret_id,
      resource_id: g.resource_id,
      permission: g.permission ?? 'read',
      scope: g.scope ?? '',
      confidence: g.confidence ?? 1,
    })
    setFormError('')
    setModalOpen(true)
  }

  async function submit() {
    if (!form.secret_id || !form.resource_id) {
      setFormError('Pick both a secret and a resource')
      return
    }
    setSaving(true)
    setFormError('')
    const body = {
      secret_id: form.secret_id,
      resource_id: form.resource_id,
      permission: form.permission,
      scope: form.scope.trim() || null,
      confidence: Number(form.confidence),
    }
    try {
      if (editing) {
        await api.updateGrant(editing.id, {
          permission: body.permission,
          scope: body.scope,
          confidence: body.confidence,
        })
      } else {
        await api.createGrant(body)
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save grant')
    } finally {
      setSaving(false)
    }
  }

  async function remove(g: Grant) {
    if (!confirm('Delete this grant edge?')) return
    setDeleting(g.id)
    try {
      await api.deleteGrant(g.id)
      setGrants((prev) => prev.filter((x) => x.id !== g.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return <PageSpinner label="Loading grant edges..." />

  const noInventory = secrets.length === 0 || resources.length === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Grants</h1>
          <p className="text-sm text-zinc-500">The edges that turn one leaked secret into a reachable set of resources.</p>
        </div>
        <Button onClick={openCreate} disabled={noInventory}>+ Add Grant Edge</Button>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <button onClick={load} className="text-red-200 underline">Retry</button>
        </div>
      )}

      {noInventory && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          You need at least one secret and one resource before you can connect them. Add them under Secrets and Resources first.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Grant edges" value={grants.length} />
        <Stat label="Privileged" value={totals.privileged} tone={totals.privileged > 0 ? 'red' : 'default'} hint="write/admin/delete" />
        <Stat label="Low confidence" value={totals.lowConf} tone={totals.lowConf > 0 ? 'amber' : 'default'} hint="< 50% certain" />
        <Stat label="Resources reached" value={totals.connectedResources} />
      </div>

      {fanOut.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Top secrets by reach</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            {fanOut.map((f) => (
              <div key={f.id} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-sm text-zinc-300" title={f.name}>{f.name}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full bg-red-500" style={{ width: `${(f.count / maxFan) * 100}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right text-sm tabular-nums text-zinc-400">{f.count} {f.count === 1 ? 'edge' : 'edges'}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <CardTitle className="mr-auto">Grant edges ({filtered.length})</CardTitle>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-40 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
          />
          <select value={secretFilter} onChange={(e) => setSecretFilter(e.target.value)} className="max-w-[12rem] rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-red-500 focus:outline-none">
            <option value="all">All secrets</option>
            {secrets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)} className="max-w-[12rem] rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-red-500 focus:outline-none">
            <option value="all">All resources</option>
            {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={permFilter} onChange={(e) => setPermFilter(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-red-500 focus:outline-none">
            <option value="all">All perms</option>
            {PERMISSIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={grants.length === 0 ? 'No grant edges yet' : 'No edges match your filters'}
                description={grants.length === 0 ? 'Connect a secret to a resource to start mapping what each credential can unlock.' : 'Try clearing the search or filters.'}
                icon="🔗"
                action={grants.length === 0 && !noInventory ? <Button onClick={openCreate}>+ Add Grant Edge</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Secret</TH>
                  <TH></TH>
                  <TH>Resource</TH>
                  <TH>Permission</TH>
                  <TH>Scope</TH>
                  <TH>Confidence</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((g) => {
                  const s = secretMap.get(g.secret_id)
                  const r = resourceMap.get(g.resource_id)
                  const conf = g.confidence ?? 1
                  const privileged = ['admin', 'write', 'delete', 'full-access'].includes(g.permission)
                  return (
                    <TR key={g.id}>
                      <TD className="font-medium text-zinc-100">
                        {s?.name ?? <span className="text-zinc-500">{g.secret_id.slice(0, 8)}</span>}
                        {s?.criticality && <Badge tone="zinc" className="ml-2">{s.criticality}</Badge>}
                      </TD>
                      <TD className="text-red-500">→</TD>
                      <TD className="font-medium text-zinc-100">
                        {r?.name ?? <span className="text-zinc-500">{g.resource_id.slice(0, 8)}</span>}
                        {r?.sensitivity === 'crown-jewel' && <Badge tone="purple" className="ml-2">crown jewel</Badge>}
                      </TD>
                      <TD><Badge tone={privileged ? 'red' : 'zinc'}>{g.permission}</Badge></TD>
                      <TD className="text-zinc-400">{g.scope || '*'}</TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 overflow-hidden rounded-full bg-zinc-800">
                            <div className={`h-full ${confidenceTone(conf) === 'green' ? 'bg-emerald-500' : confidenceTone(conf) === 'amber' ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.round(conf * 100)}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-zinc-400">{Math.round(conf * 100)}%</span>
                        </div>
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(g)}>Edit</Button>
                          <Button size="sm" variant="danger" disabled={deleting === g.id} onClick={() => remove(g)}>
                            {deleting === g.id ? <Spinner /> : 'Delete'}
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

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit grant edge' : 'Add grant edge'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? <Spinner /> : editing ? 'Save changes' : 'Create edge'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{formError}</div>}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Secret</label>
            <select
              value={form.secret_id}
              disabled={!!editing}
              onChange={(e) => setForm({ ...form, secret_id: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none disabled:opacity-60"
            >
              <option value="">Select a secret…</option>
              {secrets.map((s) => <option key={s.id} value={s.id}>{s.name}{s.environment ? ` (${s.environment})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Resource</label>
            <select
              value={form.resource_id}
              disabled={!!editing}
              onChange={(e) => setForm({ ...form, resource_id: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none disabled:opacity-60"
            >
              <option value="">Select a resource…</option>
              {resources.map((r) => <option key={r.id} value={r.id}>{r.name}{r.sensitivity ? ` (${r.sensitivity})` : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Permission</label>
              <select value={form.permission} onChange={(e) => setForm({ ...form, permission: e.target.value })} className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none">
                {PERMISSIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Confidence: {Math.round(Number(form.confidence) * 100)}%</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={form.confidence}
                onChange={(e) => setForm({ ...form, confidence: Number(e.target.value) })}
                className="w-full accent-red-500"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Scope</label>
            <input
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value })}
              placeholder="e.g. table:customers, prefix:exports/*"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
