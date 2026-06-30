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

interface Store {
  id: string
  name: string
  type: string
  location?: string | null
  owner_id?: string | null
  scan_cadence?: string | null
  last_scanned_at?: string | null
  secret_count?: number
  stale_copy_count?: number
  metadata?: Record<string, unknown> | null
  created_at?: string
}

const STORE_TYPES = [
  'vault',
  'aws-secrets-manager',
  'gcp-secret-manager',
  'azure-key-vault',
  'env-file',
  'ci-variable',
  'k8s-secret',
  'database',
  'config-repo',
  'other',
]

const CADENCES = ['hourly', 'daily', 'weekly', 'monthly', 'manual']

function fmtDate(v?: string | null): string {
  if (!v) return 'Never'
  const d = new Date(v)
  if (isNaN(d.getTime())) return 'Never'
  return d.toLocaleString()
}

function staleness(v?: string | null): { label: string; tone: 'green' | 'amber' | 'red' | 'zinc'; days: number } {
  if (!v) return { label: 'Never scanned', tone: 'red', days: Infinity }
  const d = new Date(v)
  if (isNaN(d.getTime())) return { label: 'Never scanned', tone: 'red', days: Infinity }
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 1) return { label: 'Fresh', tone: 'green', days }
  if (days <= 7) return { label: `${days}d ago`, tone: 'green', days }
  if (days <= 30) return { label: `${days}d ago`, tone: 'amber', days }
  return { label: `${days}d ago`, tone: 'red', days }
}

const emptyForm = {
  name: '',
  type: 'vault',
  location: '',
  scan_cadence: 'weekly',
}

export default function StoresPage() {
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [healthFilter, setHealthFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Store | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [scanning, setScanning] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await api.getStores()
      setStores(Array.isArray(data) ? data : data?.stores ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stores')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    return stores.filter((s) => {
      if (typeFilter !== 'all' && s.type !== typeFilter) return false
      if (search && !`${s.name} ${s.location ?? ''} ${s.type}`.toLowerCase().includes(search.toLowerCase())) return false
      if (healthFilter !== 'all') {
        const st = staleness(s.last_scanned_at)
        const stale = st.days > 7
        const hasStaleCopies = (s.stale_copy_count ?? 0) > 0
        if (healthFilter === 'stale' && !stale && !hasStaleCopies) return false
        if (healthFilter === 'healthy' && (stale || hasStaleCopies)) return false
      }
      return true
    })
  }, [stores, search, typeFilter, healthFilter])

  const totals = useMemo(() => {
    const totalSecrets = stores.reduce((a, s) => a + (s.secret_count ?? 0), 0)
    const totalStale = stores.reduce((a, s) => a + (s.stale_copy_count ?? 0), 0)
    const neverScanned = stores.filter((s) => !s.last_scanned_at).length
    const atRisk = stores.filter((s) => staleness(s.last_scanned_at).days > 7 || (s.stale_copy_count ?? 0) > 0).length
    return { totalSecrets, totalStale, neverScanned, atRisk }
  }, [stores])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(s: Store) {
    setEditing(s)
    setForm({
      name: s.name ?? '',
      type: s.type ?? 'vault',
      location: s.location ?? '',
      scan_cadence: s.scan_cadence ?? 'weekly',
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
      location: form.location.trim() || null,
      scan_cadence: form.scan_cadence,
    }
    try {
      if (editing) {
        await api.updateStore(editing.id, body)
      } else {
        await api.createStore(body)
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save store')
    } finally {
      setSaving(false)
    }
  }

  async function scan(s: Store) {
    setScanning(s.id)
    try {
      const updated = await api.scanStore(s.id)
      setStores((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...updated } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(null)
    }
  }

  async function remove(s: Store) {
    if (!confirm(`Delete store "${s.name}"? This cannot be undone.`)) return
    setDeleting(s.id)
    try {
      await api.deleteStore(s.id)
      setStores((prev) => prev.filter((x) => x.id !== s.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return <PageSpinner label="Loading store inventory..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Stores</h1>
          <p className="text-sm text-zinc-500">Where your secrets live, and how stale each store has become.</p>
        </div>
        <Button onClick={openCreate}>+ Add Store</Button>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <button onClick={load} className="text-red-200 underline">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Stores" value={stores.length} />
        <Stat label="Secrets held" value={totals.totalSecrets} />
        <Stat label="Stale copies" value={totals.totalStale} tone={totals.totalStale > 0 ? 'amber' : 'default'} />
        <Stat label="At risk" value={totals.atRisk} tone={totals.atRisk > 0 ? 'red' : 'green'} hint={`${totals.neverScanned} never scanned`} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <CardTitle className="mr-auto">Store inventory ({filtered.length})</CardTitle>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, location..."
            className="w-48 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-red-500 focus:outline-none"
          >
            <option value="all">All types</option>
            {STORE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            value={healthFilter}
            onChange={(e) => setHealthFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-red-500 focus:outline-none"
          >
            <option value="all">All health</option>
            <option value="healthy">Healthy</option>
            <option value="stale">Stale / at risk</option>
          </select>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={stores.length === 0 ? 'No stores yet' : 'No stores match your filters'}
                description={stores.length === 0 ? 'Register a secret store to start tracking where your credentials live and how often they get scanned.' : 'Try clearing the search or filters.'}
                icon="🗄️"
                action={stores.length === 0 ? <Button onClick={openCreate}>+ Add Store</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Store</TH>
                  <TH>Type</TH>
                  <TH>Location</TH>
                  <TH>Cadence</TH>
                  <TH>Secrets</TH>
                  <TH>Health</TH>
                  <TH>Last scanned</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => {
                  const st = staleness(s.last_scanned_at)
                  const staleCopies = s.stale_copy_count ?? 0
                  return (
                    <TR key={s.id}>
                      <TD className="font-medium text-zinc-100">{s.name}</TD>
                      <TD><Badge tone="zinc">{s.type}</Badge></TD>
                      <TD className="text-zinc-400">{s.location || '—'}</TD>
                      <TD className="text-zinc-400">{s.scan_cadence || '—'}</TD>
                      <TD>
                        <span className="tabular-nums">{s.secret_count ?? 0}</span>
                        {staleCopies > 0 && (
                          <Badge tone="amber" className="ml-2">{staleCopies} stale</Badge>
                        )}
                      </TD>
                      <TD><Badge tone={st.tone}>{st.tone === 'green' ? 'Healthy' : st.days === Infinity ? 'Never scanned' : 'Stale'}</Badge></TD>
                      <TD className="text-zinc-400">{st.days === Infinity ? 'Never' : st.label}<div className="text-xs text-zinc-600">{fmtDate(s.last_scanned_at)}</div></TD>
                      <TD>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="secondary" disabled={scanning === s.id} onClick={() => scan(s)}>
                            {scanning === s.id ? <Spinner /> : 'Scan'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>Edit</Button>
                          <Button size="sm" variant="danger" disabled={deleting === s.id} onClick={() => remove(s)}>
                            {deleting === s.id ? <Spinner /> : 'Delete'}
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
        title={editing ? 'Edit store' : 'Add store'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? <Spinner /> : editing ? 'Save changes' : 'Create store'}</Button>
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
              placeholder="prod-vault"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none"
              >
                {STORE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Scan cadence</label>
              <select
                value={form.scan_cadence}
                onChange={(e) => setForm({ ...form, scan_cadence: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none"
              >
                {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Location</label>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="us-east-1 / path/to/vault"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
