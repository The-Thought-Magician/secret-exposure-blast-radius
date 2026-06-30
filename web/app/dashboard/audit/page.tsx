'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { authClient } from '@/lib/auth/client'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface AuditEntry {
  id: string
  actor: string | null
  action: string
  entity_type: string
  entity_id: string | null
  detail: unknown
  created_at: string
}

function fmtDateTime(value?: string) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function actionTone(action: string): 'red' | 'amber' | 'green' | 'blue' | 'zinc' {
  const a = action.toLowerCase()
  if (a.includes('delete') || a.includes('remove') || a.includes('revoke')) return 'red'
  if (a.includes('create') || a.includes('declare') || a.includes('add')) return 'green'
  if (a.includes('update') || a.includes('rotate') || a.includes('contain') || a.includes('resolve')) return 'amber'
  if (a.includes('view') || a.includes('read') || a.includes('list') || a.includes('generate')) return 'blue'
  return 'zinc'
}

const PAGE_SIZE = 50

export default function AuditPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [entityFilter, setEntityFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState<AuditEntry | null>(null)

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
      const params: Record<string, string | number> = { limit: 500 }
      if (entityFilter) params.entity_type = entityFilter
      if (actionFilter) params.action = actionFilter
      const data = await api.getAuditLog(params)
      const list: AuditEntry[] = Array.isArray(data) ? data : (data?.entries ?? data?.items ?? [])
      setEntries(list)
      setPage(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [entityFilter, actionFilter])

  useEffect(() => {
    if (authed) load()
  }, [authed, load])

  const entityTypes = useMemo(() => {
    const s = new Set<string>()
    entries.forEach((e) => e.entity_type && s.add(e.entity_type))
    return Array.from(s).sort()
  }, [entries])

  const actions = useMemo(() => {
    const s = new Set<string>()
    entries.forEach((e) => e.action && s.add(e.action))
    return Array.from(s).sort()
  }, [entries])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (!term) return true
      return (
        (e.actor ?? '').toLowerCase().includes(term) ||
        e.action.toLowerCase().includes(term) ||
        e.entity_type.toLowerCase().includes(term) ||
        (e.entity_id ?? '').toLowerCase().includes(term)
      )
    })
  }, [entries, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  if (!authed) return <PageSpinner label="Authenticating..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Audit Log</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Immutable record of every action taken across your secrets, exposures, and incident-response workflow.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          {loading ? <Spinner label="Refreshing..." /> : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total events" value={entries.length} />
        <Stat label="Matching filter" value={filtered.length} />
        <Stat label="Entity types" value={entityTypes.length} />
        <Stat label="Distinct actions" value={actions.length} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Events</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
              placeholder="Search actor / entity..."
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-red-500 focus:outline-none"
            />
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 focus:border-red-500 focus:outline-none"
            >
              <option value="">All entities</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 focus:border-red-500 focus:outline-none"
            >
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <Spinner label="Loading audit log..." />
            </div>
          ) : visible.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No audit events"
                description="Actions you take across the platform will be recorded here. Adjust your filters or seed sample data to populate the log."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Time</TH>
                  <TH>Actor</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>Entity ID</TH>
                  <TH className="text-right">Detail</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap text-xs text-zinc-500">{fmtDateTime(e.created_at)}</TD>
                    <TD className="text-zinc-300">{e.actor ?? '—'}</TD>
                    <TD>
                      <Badge tone={actionTone(e.action)}>{e.action}</Badge>
                    </TD>
                    <TD className="text-xs text-zinc-400">{e.entity_type}</TD>
                    <TD className="font-mono text-xs text-zinc-500">{e.entity_id ? e.entity_id.slice(0, 8) : '—'}</TD>
                    <TD className="text-right">
                      {e.detail != null && (typeof e.detail !== 'object' || Object.keys(e.detail as object).length > 0) ? (
                        <Button size="sm" variant="ghost" onClick={() => setDetail(e)}>
                          View
                        </Button>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
        {!loading && filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">
            <span>
              Showing {safePage * PAGE_SIZE + 1}–{Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE)} of{' '}
              {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>
                Prev
              </Button>
              <span className="tabular-nums">
                {safePage + 1} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Modal open={detail != null} onClose={() => setDetail(null)} title="Audit event detail">
        {detail && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Action</div>
                <div className="text-zinc-200">{detail.action}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Entity</div>
                <div className="text-zinc-200">{detail.entity_type}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Actor</div>
                <div className="text-zinc-200">{detail.actor ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">When</div>
                <div className="text-zinc-200">{fmtDateTime(detail.created_at)}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs uppercase tracking-wide text-zinc-500">Entity ID</div>
                <div className="font-mono text-xs text-zinc-300">{detail.entity_id ?? '—'}</div>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Payload</div>
              <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                {JSON.stringify(detail.detail, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
