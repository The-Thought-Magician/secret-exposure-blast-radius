'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
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

export default function AccessLogsPage() {
  const [logs, setLogs] = useState<Json[]>([])
  const [resources, setResources] = useState<Json[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // filters
  const [filterResource, setFilterResource] = useState('')
  const [filterPrincipal, setFilterPrincipal] = useState('')
  const [search, setSearch] = useState('')

  // single create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [cResource, setCResource] = useState('')
  const [cPrincipal, setCPrincipal] = useState('')
  const [cIp, setCIp] = useState('')
  const [cAction, setCAction] = useState('read')
  const [cWhen, setCWhen] = useState('')
  const [cAnom, setCAnom] = useState(false)

  // bulk modal
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkErr, setBulkErr] = useState<string | null>(null)

  const resourceName = useCallback(
    (rid?: string | null) => {
      if (!rid) return '—'
      const r = resources.find((x) => x.id === rid)
      return r?.name ?? String(rid).slice(0, 8)
    },
    [resources],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Json = {}
      if (filterResource) params.resource_id = filterResource
      if (filterPrincipal) params.principal = filterPrincipal
      const [logRes, resRes] = await Promise.all([
        api.getAccessLogs(Object.keys(params).length ? params : undefined),
        api.getResources(),
      ])
      setLogs(Array.isArray(logRes) ? logRes : logRes?.logs ?? [])
      setResources(Array.isArray(resRes) ? resRes : resRes?.resources ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load access logs')
    } finally {
      setLoading(false)
    }
  }, [filterResource, filterPrincipal])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return logs
    return logs.filter((l) =>
      [l.principal, l.ip, l.action, resourceName(l.resource_id)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [logs, search, resourceName])

  const anomalyCount = useMemo(() => logs.filter((l) => l.anomalous).length, [logs])
  const principalCount = useMemo(() => new Set(logs.map((l) => l.principal)).size, [logs])

  const refresh = async () => {
    await load()
  }

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('create')
    setNotice(null)
    setError(null)
    try {
      const body: Json = {
        resource_id: cResource || null,
        principal: cPrincipal,
        ip: cIp || null,
        action: cAction,
        anomalous: cAnom,
      }
      if (cWhen) body.occurred_at = new Date(cWhen).toISOString()
      await api.createAccessLog(body)
      setNotice('Access log ingested')
      setCreateOpen(false)
      setCPrincipal('')
      setCIp('')
      setCWhen('')
      setCAnom(false)
      await refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create access log')
    } finally {
      setBusy(null)
    }
  }

  const submitBulk = async (e: React.FormEvent) => {
    e.preventDefault()
    setBulkErr(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(bulkText)
    } catch {
      setBulkErr('Invalid JSON. Provide an array of access-log objects.')
      return
    }
    if (!Array.isArray(parsed)) {
      setBulkErr('Top-level value must be a JSON array.')
      return
    }
    setBusy('bulk')
    setNotice(null)
    try {
      const res = await api.bulkAccessLogs(parsed)
      const n = res?.inserted ?? parsed.length
      setNotice(`Ingested ${n} access log${n === 1 ? '' : 's'}`)
      setBulkOpen(false)
      setBulkText('')
      await refresh()
    } catch (e: any) {
      setBulkErr(e?.message ?? 'Bulk ingest failed')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (logId: string) => {
    setBusy(`del-${logId}`)
    setNotice(null)
    setError(null)
    try {
      await api.deleteAccessLog(logId)
      setLogs((cur) => cur.filter((l) => l.id !== logId))
      setNotice('Access log deleted')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <PageSpinner label="Loading access logs..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-zinc-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Access Logs</h1>
          <p className="mt-1 text-sm text-zinc-500">Ingest and search access activity used to reconstruct exposure timelines.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => { setBulkErr(null); setBulkOpen(true) }}>Bulk ingest</Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>Ingest entry</Button>
        </div>
      </div>

      {notice && <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300">{notice}</div>}
      {error && <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">{error}</div>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total entries" value={logs.length} />
        <Stat label="Anomalous" value={anomalyCount} tone={anomalyCount > 0 ? 'red' : 'green'} />
        <Stat label="Distinct principals" value={principalCount} />
        <Stat label="Resources" value={resources.length} />
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="principal, ip, action..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
            />
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Resource</label>
            <select
              value={filterResource}
              onChange={(e) => setFilterResource(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
            >
              <option value="">All resources</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>{r.name ?? r.id}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Principal</label>
            <input
              value={filterPrincipal}
              onChange={(e) => setFilterPrincipal(e.target.value)}
              placeholder="exact principal"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
            />
          </div>
          {(filterResource || filterPrincipal) && (
            <Button variant="ghost" size="sm" onClick={() => { setFilterResource(''); setFilterPrincipal('') }}>Clear</Button>
          )}
        </CardBody>
      </Card>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          title={logs.length === 0 ? 'No access logs yet' : 'No matching entries'}
          description={logs.length === 0 ? 'Ingest access activity to build a forensic trail.' : 'Try clearing filters or search.'}
          icon="📜"
          action={logs.length === 0 ? <Button onClick={() => setCreateOpen(true)}>Ingest entry</Button> : undefined}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Principal</TH>
              <TH>Resource</TH>
              <TH>Action</TH>
              <TH>IP</TH>
              <TH>Flag</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((l, i) => (
              <TR key={l.id ?? i} className={l.anomalous ? 'bg-red-950/10' : ''}>
                <TD className="whitespace-nowrap text-zinc-400">{fmt(l.occurred_at ?? l.created_at)}</TD>
                <TD className="font-medium text-zinc-200">{l.principal ?? '—'}</TD>
                <TD>{resourceName(l.resource_id)}</TD>
                <TD>{l.action ?? '—'}</TD>
                <TD className="font-mono text-xs text-zinc-400">{l.ip ?? '—'}</TD>
                <TD>{l.anomalous ? <Badge tone="red">anomalous</Badge> : <Badge tone="zinc">normal</Badge>}</TD>
                <TD className="text-right">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => l.id && void remove(l.id)}
                    disabled={busy === `del-${l.id}`}
                  >
                    {busy === `del-${l.id}` ? <Spinner /> : 'Delete'}
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Single create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Ingest access log entry"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={busy === 'create'}>{busy === 'create' ? <Spinner /> : 'Ingest'}</Button>
          </>
        }
      >
        <form onSubmit={submitCreate} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Resource</label>
            <select
              value={cResource}
              onChange={(e) => setCResource(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
            >
              <option value="">— none —</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>{r.name ?? r.id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Principal</label>
            <input
              value={cPrincipal}
              onChange={(e) => setCPrincipal(e.target.value)}
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
              placeholder="e.g. svc-billing@acme.iam"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Action</label>
              <input
                value={cAction}
                onChange={(e) => setCAction(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
                placeholder="read / write / list"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">IP</label>
              <input
                value={cIp}
                onChange={(e) => setCIp(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
                placeholder="203.0.113.5"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Occurred at</label>
            <input
              type="datetime-local"
              value={cWhen}
              onChange={(e) => setCWhen(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={cAnom} onChange={(e) => setCAnom(e.target.checked)} className="accent-red-500" />
            Flag as anomalous
          </label>
        </form>
      </Modal>

      {/* Bulk modal */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk ingest access logs"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={submitBulk} disabled={busy === 'bulk'}>{busy === 'bulk' ? <Spinner /> : 'Ingest array'}</Button>
          </>
        }
      >
        <form onSubmit={submitBulk} className="space-y-3">
          <p className="text-sm text-zinc-400">
            Paste a JSON array of access-log objects. Each may include <code className="text-zinc-300">resource_id</code>,{' '}
            <code className="text-zinc-300">principal</code>, <code className="text-zinc-300">ip</code>,{' '}
            <code className="text-zinc-300">action</code>, <code className="text-zinc-300">anomalous</code>,{' '}
            <code className="text-zinc-300">occurred_at</code>.
          </p>
          {bulkErr && <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{bulkErr}</div>}
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={12}
            spellCheck={false}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus:border-red-500 focus:outline-none"
            placeholder={'[\n  { "principal": "svc-a@acme.iam", "action": "read", "ip": "10.0.0.4" },\n  { "principal": "svc-b@acme.iam", "action": "list", "anomalous": true }\n]'}
          />
        </form>
      </Modal>
    </div>
  )
}
