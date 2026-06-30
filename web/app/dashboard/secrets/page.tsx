'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
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

const TYPES = ['api_key', 'oauth_token', 'password', 'ssh_key', 'certificate', 'database_credential', 'webhook_secret', 'jwt_signing_key']
const ENVIRONMENTS = ['production', 'staging', 'development', 'test']
const CRITICALITIES = ['critical', 'high', 'medium', 'low']
const STATUSES = ['active', 'rotating', 'compromised', 'retired']

const inputCls = 'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none'
const labelCls = 'mb-1 block text-xs font-medium text-zinc-400'

function ageDays(iso?: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [fType, setFType] = useState('')
  const [fEnv, setFEnv] = useState('')
  const [fCrit, setFCrit] = useState('')
  const [fStatus, setFStatus] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    type: 'api_key',
    owning_service: '',
    environment: 'production',
    criticality: 'high',
    last_four: '',
    fingerprint: '',
    max_age_days: 90,
    tags: '',
    scopes: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params: Record<string, string> = {}
      if (fType) params.type = fType
      if (fEnv) params.env = fEnv
      if (fCrit) params.criticality = fCrit
      if (fStatus) params.status = fStatus
      const res = await api.getSecrets(Object.keys(params).length ? params : undefined)
      setSecrets(Array.isArray(res) ? res : res?.secrets ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load secrets')
    } finally {
      setLoading(false)
    }
  }, [fType, fEnv, fCrit, fStatus])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return secrets
    return secrets.filter((s) =>
      [s.name, s.owning_service, s.type, s.environment, s.last_four].some((v) => (v ?? '').toLowerCase().includes(q)),
    )
  }, [secrets, search])

  const resetForm = () =>
    setForm({
      name: '', type: 'api_key', owning_service: '', environment: 'production',
      criticality: 'high', last_four: '', fingerprint: '', max_age_days: 90, tags: '', scopes: '',
    })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setCreateErr('')
    try {
      await api.createSecret({
        name: form.name.trim(),
        type: form.type,
        owning_service: form.owning_service.trim() || null,
        environment: form.environment,
        criticality: form.criticality,
        last_four: form.last_four.trim() || null,
        fingerprint: form.fingerprint.trim() || null,
        max_age_days: Number(form.max_age_days) || null,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        scopes: form.scopes.split(',').map((t) => t.trim()).filter(Boolean),
      })
      setShowCreate(false)
      resetForm()
      await load()
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Failed to create secret')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this secret? Grants and copies referencing it may be affected.')) return
    setDeleting(id)
    try {
      await api.deleteSecret(id)
      setSecrets((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete secret')
    } finally {
      setDeleting(null)
    }
  }

  const clearFilters = () => { setFType(''); setFEnv(''); setFCrit(''); setFStatus(''); setSearch('') }
  const hasFilters = !!(fType || fEnv || fCrit || fStatus || search)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Secret Registry</h1>
          <p className="mt-1 text-sm text-zinc-500">Every credential under management, with criticality, age and reuse linkage.</p>
        </div>
        <Button onClick={() => { resetForm(); setCreateErr(''); setShowCreate(true) }}>+ New secret</Button>
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className={labelCls}>Search</label>
            <input className={inputCls} placeholder="Name, service, last four..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select className={inputCls} value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="">All</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Environment</label>
            <select className={inputCls} value={fEnv} onChange={(e) => setFEnv(e.target.value)}>
              <option value="">All</option>
              {ENVIRONMENTS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Criticality</label>
            <select className={inputCls} value={fCrit} onChange={(e) => setFCrit(e.target.value)}>
              <option value="">All</option>
              {CRITICALITIES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {hasFilters && <Button variant="ghost" onClick={clearFilters}>Clear</Button>}
        </CardBody>
      </Card>

      {loading ? (
        <PageSpinner label="Loading secrets..." />
      ) : error ? (
        <Card className="border-red-900/60">
          <CardBody>
            <h2 className="text-sm font-semibold text-red-300">Could not load secrets</h2>
            <p className="mt-1 text-sm text-zinc-400">{error}</p>
            <Button className="mt-4" onClick={load}>Retry</Button>
          </CardBody>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'No secrets match these filters' : 'No secrets yet'}
          description={hasFilters ? 'Try clearing filters or adjusting your search.' : 'Register your first credential to start mapping its blast radius.'}
          icon="🔑"
          action={hasFilters ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : <Button onClick={() => setShowCreate(true)}>+ New secret</Button>}
        />
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-zinc-500">{filtered.length} secret{filtered.length === 1 ? '' : 's'}</div>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>Env</TH>
                <TH>Criticality</TH>
                <TH>Status</TH>
                <TH>Age</TH>
                <TH>Reuse</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((s) => {
                const age = ageDays(s.last_rotated_at)
                const stale = age != null && s.max_age_days != null && age > s.max_age_days
                return (
                  <TR key={s.id}>
                    <TD>
                      <Link href={`/dashboard/secrets/${s.id}`} className="font-medium text-zinc-100 hover:text-red-400">
                        {s.name}
                      </Link>
                      {s.owning_service && <div className="text-xs text-zinc-500">{s.owning_service}</div>}
                      {s.last_four && <span className="ml-0 text-xs text-zinc-600">····{s.last_four}</span>}
                    </TD>
                    <TD><span className="text-zinc-400">{s.type ?? '—'}</span></TD>
                    <TD>{s.environment ? <Badge tone={s.environment === 'production' ? 'red' : 'zinc'}>{s.environment}</Badge> : '—'}</TD>
                    <TD>{s.criticality ? <Badge tone={severityTone(s.criticality)}>{s.criticality}</Badge> : '—'}</TD>
                    <TD>{s.status ? <Badge tone={severityTone(s.status)}>{s.status}</Badge> : '—'}</TD>
                    <TD>
                      {age == null ? <span className="text-zinc-600">never</span> : (
                        <span className={stale ? 'text-red-400' : 'text-zinc-400'}>{age}d{stale ? ' ⚠' : ''}</span>
                      )}
                    </TD>
                    <TD>{s.reuse_cluster_id ? <Badge tone="amber">reused</Badge> : <span className="text-zinc-600">—</span>}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/dashboard/secrets/${s.id}`}><Button size="sm" variant="secondary">View</Button></Link>
                        <Button size="sm" variant="danger" disabled={deleting === s.id} onClick={() => handleDelete(s.id)}>
                          {deleting === s.id ? '...' : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => !creating && setShowCreate(false)}
        title="Register a secret"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</Button>
            <Button form="create-secret-form" type="submit" disabled={creating}>
              {creating ? <Spinner label="Creating..." /> : 'Create secret'}
            </Button>
          </>
        }
      >
        <form id="create-secret-form" onSubmit={handleCreate} className="space-y-3">
          {createErr && <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-2 text-sm text-red-300">{createErr}</div>}
          <div>
            <label className={labelCls}>Name *</label>
            <input required className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="stripe-live-key" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Type</label>
              <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Owning service</label>
              <input className={inputCls} value={form.owning_service} onChange={(e) => setForm({ ...form, owning_service: e.target.value })} placeholder="billing-api" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Environment</label>
              <select className={inputCls} value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
                {ENVIRONMENTS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Criticality</label>
              <select className={inputCls} value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })}>
                {CRITICALITIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Last four</label>
              <input className={inputCls} maxLength={8} value={form.last_four} onChange={(e) => setForm({ ...form, last_four: e.target.value })} placeholder="a1b2" />
            </div>
            <div>
              <label className={labelCls}>Max age (days)</label>
              <input type="number" min={1} className={inputCls} value={form.max_age_days} onChange={(e) => setForm({ ...form, max_age_days: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Fingerprint (optional, used for reuse detection)</label>
            <input className={inputCls} value={form.fingerprint} onChange={(e) => setForm({ ...form, fingerprint: e.target.value })} placeholder="sha256:..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tags (comma separated)</label>
              <input className={inputCls} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="pci, customer-data" />
            </div>
            <div>
              <label className={labelCls}>Scopes (comma separated)</label>
              <input className={inputCls} value={form.scopes} onChange={(e) => setForm({ ...form, scopes: e.target.value })} placeholder="read, write" />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
