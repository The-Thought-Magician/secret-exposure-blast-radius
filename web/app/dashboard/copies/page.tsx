'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Secret {
  id: string
  name: string
  type: string | null
  owning_service: string | null
  environment: string | null
  last_four: string | null
}

interface Copy {
  id: string
  secret_id: string
  store_id: string
  rotated: boolean
  last_seen_at: string | null
  created_at: string
  // joined display fields (best-effort, optional)
  secret_name?: string | null
  store_name?: string | null
  store_type?: string | null
}

interface DiscoverGap {
  store_id?: string
  store_name?: string | null
  reason?: string
  [k: string]: unknown
}

interface DiscoverResult {
  copies: Copy[]
  unrotated: Copy[]
  gaps: DiscoverGap[]
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString()
}

export default function CopiesPage() {
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [copies, setCopies] = useState<Copy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [secretFilter, setSecretFilter] = useState<string>('all')
  const [rotatedFilter, setRotatedFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [form, setForm] = useState({ secret_id: '', store_id: '', rotated: false })

  const [busyDelete, setBusyDelete] = useState<string | null>(null)

  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [discoverSecret, setDiscoverSecret] = useState<string>('')
  const [discoverBusy, setDiscoverBusy] = useState(false)
  const [discoverErr, setDiscoverErr] = useState<string | null>(null)
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [s, c] = await Promise.all([api.getSecrets(), api.getCopies()])
      setSecrets(Array.isArray(s) ? s : [])
      setCopies(Array.isArray(c) ? c : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load copies')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const secretName = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of secrets) m.set(s.id, s.name)
    return m
  }, [secrets])

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.secret_id || !form.store_id.trim()) return
    setCreateBusy(true)
    setCreateErr(null)
    try {
      await api.createCopy({
        secret_id: form.secret_id,
        store_id: form.store_id.trim(),
        rotated: form.rotated,
      })
      setCreateOpen(false)
      setForm({ secret_id: '', store_id: '', rotated: false })
      await loadAll()
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Failed to register copy')
    } finally {
      setCreateBusy(false)
    }
  }

  async function removeCopy(id: string) {
    if (!confirm('Remove this copy record?')) return
    setBusyDelete(id)
    try {
      await api.deleteCopy(id)
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete copy')
    } finally {
      setBusyDelete(null)
    }
  }

  async function runDiscover() {
    if (!discoverSecret) return
    setDiscoverBusy(true)
    setDiscoverErr(null)
    setDiscoverResult(null)
    try {
      const res = await api.discoverCopies(discoverSecret)
      setDiscoverResult({
        copies: Array.isArray(res?.copies) ? res.copies : [],
        unrotated: Array.isArray(res?.unrotated) ? res.unrotated : [],
        gaps: Array.isArray(res?.gaps) ? res.gaps : [],
      })
    } catch (e) {
      setDiscoverErr(e instanceof Error ? e.message : 'Discovery failed')
    } finally {
      setDiscoverBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return copies.filter((c) => {
      if (secretFilter !== 'all' && c.secret_id !== secretFilter) return false
      if (rotatedFilter === 'rotated' && !c.rotated) return false
      if (rotatedFilter === 'unrotated' && c.rotated) return false
      if (q) {
        const name = (c.secret_name ?? secretName.get(c.secret_id) ?? '').toLowerCase()
        const store = (c.store_name ?? c.store_id ?? '').toLowerCase()
        if (!name.includes(q) && !store.includes(q)) return false
      }
      return true
    })
  }, [copies, secretFilter, rotatedFilter, search, secretName])

  const stats = useMemo(() => {
    const total = copies.length
    const unrotated = copies.filter((c) => !c.rotated).length
    const stores = new Set(copies.map((c) => c.store_id)).size
    const spreadSecrets = new Set(copies.map((c) => c.secret_id)).size
    return { total, unrotated, stores, spreadSecrets }
  }, [copies])

  if (loading) return <PageSpinner label="Loading copies..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Copy Discovery</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Every place a secret value lives. Unrotated copies after a leak are the silent re-exposure path.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => { setDiscoverOpen(true); setDiscoverResult(null); setDiscoverErr(null) }}>
            Run Discovery
          </Button>
          <Button onClick={() => { setCreateOpen(true); setCreateErr(null) }}>+ Register Copy</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Copies Tracked" value={stats.total} />
        <Stat label="Unrotated" value={stats.unrotated} tone={stats.unrotated > 0 ? 'red' : 'green'} hint="re-exposure risk" />
        <Stat label="Distinct Stores" value={stats.stores} />
        <Stat label="Spread Secrets" value={stats.spreadSecrets} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Registered Copies</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search secret or store..."
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-700 focus:outline-none"
            />
            <select
              value={secretFilter}
              onChange={(e) => setSecretFilter(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            >
              <option value="all">All secrets</option>
              {secrets.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              value={rotatedFilter}
              onChange={(e) => setRotatedFilter(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="unrotated">Unrotated</option>
              <option value="rotated">Rotated</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {error ? (
            <div className="px-5 py-6 text-sm text-red-400">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={copies.length === 0 ? 'No copies registered' : 'No copies match'}
                description={
                  copies.length === 0
                    ? 'Register where each secret value is copied (vaults, CI, env files). Or run discovery against a secret to find live copies and gaps.'
                    : 'Adjust filters to see registered copies.'
                }
                action={copies.length === 0 ? <Button size="sm" onClick={() => setCreateOpen(true)}>+ Register Copy</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Secret</TH>
                  <TH>Store</TH>
                  <TH>Rotated</TH>
                  <TH>Last Seen</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {filtered.map((c) => (
                  <TR key={c.id}>
                    <TD className="text-zinc-200">{c.secret_name ?? secretName.get(c.secret_id) ?? c.secret_id}</TD>
                    <TD>
                      {c.store_name ?? c.store_id}
                      {c.store_type && <span className="ml-2 text-xs text-zinc-500">{c.store_type}</span>}
                    </TD>
                    <TD>
                      <Badge tone={c.rotated ? 'green' : 'red'}>{c.rotated ? 'rotated' : 'unrotated'}</Badge>
                    </TD>
                    <TD className="text-xs text-zinc-400">{fmtDate(c.last_seen_at)}</TD>
                    <TD className="text-right">
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busyDelete === c.id}
                        onClick={() => removeCopy(c.id)}
                      >
                        {busyDelete === c.id ? <Spinner /> : 'Remove'}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Register copy modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Register Copy"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={createBusy}>Cancel</Button>
            <Button onClick={submitCreate} disabled={createBusy || !form.secret_id || !form.store_id.trim()}>
              {createBusy ? <Spinner /> : 'Register'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitCreate} className="space-y-4">
          {createErr && <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{createErr}</div>}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Secret</label>
            <select
              value={form.secret_id}
              onChange={(e) => setForm((f) => ({ ...f, secret_id: e.target.value }))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            >
              <option value="">Select a secret…</option>
              {secrets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.owning_service ? ` (${s.owning_service})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Store ID</label>
            <input
              value={form.store_id}
              onChange={(e) => setForm((f) => ({ ...f, store_id: e.target.value }))}
              placeholder="Store UUID where the value is held"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-700 focus:outline-none"
            />
            <p className="mt-1 text-xs text-zinc-600">Find store IDs under Inventory → Stores.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.rotated}
              onChange={(e) => setForm((f) => ({ ...f, rotated: e.target.checked }))}
              className="accent-red-600"
            />
            Already rotated in this store
          </label>
        </form>
      </Modal>

      {/* Discovery modal */}
      <Modal
        open={discoverOpen}
        onClose={() => setDiscoverOpen(false)}
        title="Copy Discovery"
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Secret to trace</label>
              <select
                value={discoverSecret}
                onChange={(e) => setDiscoverSecret(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
              >
                <option value="">Select a secret…</option>
                {secrets.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <Button onClick={runDiscover} disabled={discoverBusy || !discoverSecret}>
              {discoverBusy ? <Spinner /> : 'Discover'}
            </Button>
          </div>

          {discoverErr && <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{discoverErr}</div>}

          {discoverResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Live Copies" value={discoverResult.copies.length} />
                <Stat label="Unrotated" value={discoverResult.unrotated.length} tone={discoverResult.unrotated.length > 0 ? 'red' : 'green'} />
                <Stat label="Gaps" value={discoverResult.gaps.length} tone={discoverResult.gaps.length > 0 ? 'amber' : 'default'} />
              </div>

              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Live Copies</div>
                {discoverResult.copies.length === 0 ? (
                  <p className="text-sm text-zinc-500">No live copies found.</p>
                ) : (
                  <ul className="space-y-1">
                    {discoverResult.copies.map((c) => (
                      <li key={c.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
                        <span className="text-zinc-300">{c.store_name ?? c.store_id}</span>
                        <Badge tone={c.rotated ? 'green' : 'red'}>{c.rotated ? 'rotated' : 'unrotated'}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {discoverResult.unrotated.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-red-400">Unrotated (must rotate)</div>
                  <ul className="space-y-1">
                    {discoverResult.unrotated.map((c) => (
                      <li key={c.id} className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">
                        {c.store_name ?? c.store_id}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {discoverResult.gaps.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-400">Coverage Gaps</div>
                  <ul className="space-y-1">
                    {discoverResult.gaps.map((g, i) => (
                      <li key={i} className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">
                        {g.store_name ?? g.store_id ?? 'Unknown store'}
                        {g.reason ? <span className="text-amber-300/70"> — {g.reason}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
