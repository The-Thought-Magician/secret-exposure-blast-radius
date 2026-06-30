'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, severityTone } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner, PageSpinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Resource {
  id: string
  name: string
  type: string
  sensitivity: string
  environment: string
  owner_id?: string | null
  contains_secret_id?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string
}

const RESOURCE_TYPES = [
  'database',
  'bucket',
  's3',
  'service',
  'api',
  'queue',
  'cache',
  'host',
  'repo',
  'iam-role',
  'other',
]

const SENSITIVITIES = ['crown-jewel', 'high', 'medium', 'low']
const ENVIRONMENTS = ['production', 'staging', 'development', 'test']

function sensitivityTone(v: string): 'red' | 'amber' | 'green' | 'zinc' | 'purple' {
  switch (v) {
    case 'crown-jewel': return 'purple'
    case 'high': return 'red'
    case 'medium': return 'amber'
    case 'low': return 'green'
    default: return 'zinc'
  }
}

const emptyForm = {
  name: '',
  type: 'database',
  sensitivity: 'medium',
  environment: 'production',
}

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sensFilter, setSensFilter] = useState('all')
  const [envFilter, setEnvFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Resource | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await api.getResources()
      setResources(Array.isArray(data) ? data : data?.resources ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load resources')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    return resources.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (sensFilter !== 'all' && r.sensitivity !== sensFilter) return false
      if (envFilter !== 'all' && r.environment !== envFilter) return false
      if (search && !`${r.name} ${r.type}`.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [resources, search, typeFilter, sensFilter, envFilter])

  const totals = useMemo(() => {
    const crownJewels = resources.filter((r) => r.sensitivity === 'crown-jewel').length
    const high = resources.filter((r) => r.sensitivity === 'high').length
    const prod = resources.filter((r) => r.environment === 'production').length
    return { crownJewels, high, prod }
  }, [resources])

  const sensitivityBreakdown = useMemo(() => {
    const max = resources.length || 1
    return SENSITIVITIES.map((s) => {
      const count = resources.filter((r) => r.sensitivity === s).length
      return { sensitivity: s, count, pct: Math.round((count / max) * 100) }
    })
  }, [resources])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(r: Resource) {
    setEditing(r)
    setForm({
      name: r.name ?? '',
      type: r.type ?? 'database',
      sensitivity: r.sensitivity ?? 'medium',
      environment: r.environment ?? 'production',
    })
    setFormError('')
    setModalOpen(true)
  }

  async function submit() {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError('')
    const body = {
      name: form.name.trim(),
      type: form.type,
      sensitivity: form.sensitivity,
      environment: form.environment,
    }
    try {
      if (editing) {
        await api.updateResource(editing.id, body)
      } else {
        await api.createResource(body)
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save resource')
    } finally {
      setSaving(false)
    }
  }

  async function remove(r: Resource) {
    if (!confirm(`Delete resource "${r.name}"?`)) return
    setDeleting(r.id)
    try {
      await api.deleteResource(r.id)
      setResources((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return <PageSpinner label="Loading resource catalog..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Resources</h1>
          <p className="text-sm text-zinc-500">The catalog of protected resources a leaked secret could reach.</p>
        </div>
        <Button onClick={openCreate}>+ Add Resource</Button>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <button onClick={load} className="text-red-200 underline">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Resources" value={resources.length} />
        <Stat label="Crown jewels" value={totals.crownJewels} tone={totals.crownJewels > 0 ? 'red' : 'default'} />
        <Stat label="High sensitivity" value={totals.high} tone={totals.high > 0 ? 'amber' : 'default'} />
        <Stat label="In production" value={totals.prod} />
      </div>

      <Card>
        <CardHeader><CardTitle>Sensitivity distribution</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          {sensitivityBreakdown.map((b) => (
            <div key={b.sensitivity} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs uppercase tracking-wide text-zinc-500">{b.sensitivity}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full ${b.sensitivity === 'crown-jewel' ? 'bg-violet-500' : b.sensitivity === 'high' ? 'bg-red-500' : b.sensitivity === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${b.pct}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-sm tabular-nums text-zinc-300">{b.count}</span>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <CardTitle className="mr-auto">Catalog ({filtered.length})</CardTitle>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-40 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-red-500 focus:outline-none">
            <option value="all">All types</option>
            {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={sensFilter} onChange={(e) => setSensFilter(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-red-500 focus:outline-none">
            <option value="all">All sensitivity</option>
            {SENSITIVITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={envFilter} onChange={(e) => setEnvFilter(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-red-500 focus:outline-none">
            <option value="all">All envs</option>
            {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={resources.length === 0 ? 'No resources yet' : 'No resources match your filters'}
                description={resources.length === 0 ? 'Add the databases, buckets and services that secrets can unlock so blast radius can be computed.' : 'Try clearing the search or filters.'}
                icon="🛡️"
                action={resources.length === 0 ? <Button onClick={openCreate}>+ Add Resource</Button> : undefined}
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
                  <TH>Holds secret</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-zinc-100">{r.name}</TD>
                    <TD><Badge tone="zinc">{r.type}</Badge></TD>
                    <TD><Badge tone={sensitivityTone(r.sensitivity)}>{r.sensitivity}</Badge></TD>
                    <TD><Badge tone={severityTone(r.environment === 'production' ? 'high' : 'low')}>{r.environment}</Badge></TD>
                    <TD className="text-zinc-400">{r.contains_secret_id ? <Badge tone="amber">embedded secret</Badge> : '—'}</TD>
                    <TD>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                        <Button size="sm" variant="danger" disabled={deleting === r.id} onClick={() => remove(r)}>
                          {deleting === r.id ? <Spinner /> : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit resource' : 'Add resource'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? <Spinner /> : editing ? 'Save changes' : 'Create resource'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{formError}</div>}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="prod-customers-db"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none">
                {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Sensitivity</label>
              <select value={form.sensitivity} onChange={(e) => setForm({ ...form, sensitivity: e.target.value })} className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none">
                {SENSITIVITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Environment</label>
            <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none">
              {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>
      </Modal>
    </div>
  )
}
