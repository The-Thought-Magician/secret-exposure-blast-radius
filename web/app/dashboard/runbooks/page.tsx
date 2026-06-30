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

interface Runbook {
  id: string
  exposure_id: string | null
  title: string
  status: string
  total_tasks: number
  verified_tasks: number
  created_at: string
}

interface RunbookTask {
  id: string
  runbook_id: string
  kind: string | null
  description: string
  store_id: string | null
  resource_id: string | null
  owner_id: string | null
  status: string
  due_at: string | null
  completed_at: string | null
  verified_at: string | null
  created_at: string
}

const TASK_COLUMNS: { key: string; label: string; tone: 'zinc' | 'amber' | 'blue' | 'green' }[] = [
  { key: 'pending', label: 'Pending', tone: 'zinc' },
  { key: 'in_progress', label: 'In Progress', tone: 'amber' },
  { key: 'done', label: 'Done', tone: 'blue' },
  { key: 'verified', label: 'Verified', tone: 'green' },
]

const TASK_KINDS = ['rotate', 'revoke', 'notify', 'investigate', 'verify', 'contain', 'other']

function columnTone(status: string) {
  return TASK_COLUMNS.find((c) => c.key === status)?.tone ?? 'zinc'
}

function nextStatus(status: string): string | null {
  const idx = TASK_COLUMNS.findIndex((c) => c.key === status)
  if (idx < 0 || idx >= TASK_COLUMNS.length - 1) return null
  return TASK_COLUMNS[idx + 1].key
}

function prevStatus(status: string): string | null {
  const idx = TASK_COLUMNS.findIndex((c) => c.key === status)
  if (idx <= 0) return null
  return TASK_COLUMNS[idx - 1].key
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString()
}

export default function RunbooksPage() {
  const [runbooks, setRunbooks] = useState<Runbook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ runbook: Runbook; tasks: RunbookTask[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addBusy, setAddBusy] = useState(false)
  const [addForm, setAddForm] = useState({ kind: 'rotate', description: '', due_at: '' })

  async function loadRunbooks() {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = {}
      if (statusFilter !== 'all') params.status = statusFilter
      const data = await api.getRunbooks(params)
      setRunbooks(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load runbooks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRunbooks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  async function openRunbook(id: string) {
    setSelectedId(id)
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    try {
      const data = await api.getRunbook(id)
      setDetail(data)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load runbook')
    } finally {
      setDetailLoading(false)
    }
  }

  async function reloadDetail() {
    if (!selectedId) return
    try {
      const data = await api.getRunbook(selectedId)
      setDetail(data)
    } catch {
      /* keep current */
    }
  }

  async function transition(task: RunbookTask, status: string) {
    setBusyTaskId(task.id)
    try {
      await api.updateRunbookTask(task.id, { status })
      await Promise.all([reloadDetail(), loadRunbooks()])
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to update task')
    } finally {
      setBusyTaskId(null)
    }
  }

  async function removeTask(task: RunbookTask) {
    if (!confirm('Delete this task?')) return
    setBusyTaskId(task.id)
    try {
      await api.deleteRunbookTask(task.id)
      await Promise.all([reloadDetail(), loadRunbooks()])
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to delete task')
    } finally {
      setBusyTaskId(null)
    }
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId || !addForm.description.trim()) return
    setAddBusy(true)
    try {
      const body: Record<string, unknown> = {
        kind: addForm.kind,
        description: addForm.description.trim(),
      }
      if (addForm.due_at) body.due_at = new Date(addForm.due_at).toISOString()
      await api.addRunbookTask(selectedId, body)
      setAddOpen(false)
      setAddForm({ kind: 'rotate', description: '', due_at: '' })
      await Promise.all([reloadDetail(), loadRunbooks()])
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to add task')
    } finally {
      setAddBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return runbooks
    return runbooks.filter((r) => r.title.toLowerCase().includes(q))
  }, [runbooks, search])

  const stats = useMemo(() => {
    const total = runbooks.length
    const open = runbooks.filter((r) => !['complete', 'closed', 'done'].includes((r.status ?? '').toLowerCase())).length
    const totalTasks = runbooks.reduce((s, r) => s + (r.total_tasks || 0), 0)
    const verifiedTasks = runbooks.reduce((s, r) => s + (r.verified_tasks || 0), 0)
    return { total, open, totalTasks, verifiedTasks }
  }, [runbooks])

  const tasksByStatus = useMemo(() => {
    const map: Record<string, RunbookTask[]> = {}
    for (const c of TASK_COLUMNS) map[c.key] = []
    if (detail) {
      for (const t of detail.tasks) {
        if (!map[t.status]) map[t.status] = []
        map[t.status].push(t)
      }
    }
    return map
  }, [detail])

  if (loading) return <PageSpinner label="Loading runbooks..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Runbooks</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Containment runbooks and their task boards. Drive each task from pending through verified.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={loadRunbooks}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Runbooks" value={stats.total} />
        <Stat label="Open" value={stats.open} tone={stats.open > 0 ? 'amber' : 'green'} />
        <Stat label="Total Tasks" value={stats.totalTasks} />
        <Stat
          label="Verified Tasks"
          value={`${stats.verifiedTasks}/${stats.totalTasks}`}
          tone={stats.totalTasks > 0 && stats.verifiedTasks === stats.totalTasks ? 'green' : 'default'}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>All Runbooks</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title..."
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-700 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="complete">Complete</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {error ? (
            <div className="px-5 py-6 text-sm text-red-400">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No runbooks"
                description="Runbooks are auto-generated when an exposure is declared. Declare an exposure to produce a containment runbook."
              />
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {filtered.map((r) => {
                const pct = r.total_tasks > 0 ? Math.round((r.verified_tasks / r.total_tasks) * 100) : 0
                const active = r.id === selectedId
                return (
                  <li
                    key={r.id}
                    className={`cursor-pointer px-5 py-4 transition-colors hover:bg-zinc-900/60 ${active ? 'bg-zinc-900/80' : ''}`}
                    onClick={() => openRunbook(r.id)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-zinc-100">{r.title}</span>
                          <Badge tone={['complete', 'closed', 'done'].includes((r.status ?? '').toLowerCase()) ? 'green' : 'amber'}>
                            {r.status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          Created {fmtDate(r.created_at)}
                          {r.exposure_id ? ` · exposure ${r.exposure_id.slice(0, 8)}` : ''}
                        </div>
                      </div>
                      <div className="flex w-44 shrink-0 flex-col gap-1">
                        <div className="flex justify-between text-xs text-zinc-400">
                          <span>{r.verified_tasks}/{r.total_tasks} verified</span>
                          <span className="tabular-nums">{pct}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className={`h-full ${pct === 100 ? 'bg-emerald-500' : 'bg-red-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {selectedId && (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{detail ? `Task Board — ${detail.runbook.title}` : 'Task Board'}</CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => setAddOpen(true)} disabled={!detail}>
                + Add Task
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setSelectedId(null); setDetail(null) }}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardBody>
            {detailLoading ? (
              <div className="py-10 text-center"><Spinner label="Loading tasks..." /></div>
            ) : detailError ? (
              <div className="text-sm text-red-400">{detailError}</div>
            ) : detail && detail.tasks.length === 0 ? (
              <EmptyState
                title="No tasks yet"
                description="Add the first containment task to this runbook."
                action={<Button size="sm" onClick={() => setAddOpen(true)}>+ Add Task</Button>}
              />
            ) : detail ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {TASK_COLUMNS.map((col) => (
                  <div key={col.key} className="rounded-xl border border-zinc-800 bg-zinc-950/40">
                    <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{col.label}</span>
                      <Badge tone={col.tone}>{tasksByStatus[col.key]?.length ?? 0}</Badge>
                    </div>
                    <div className="space-y-2 p-3">
                      {(tasksByStatus[col.key] ?? []).length === 0 ? (
                        <p className="py-4 text-center text-xs text-zinc-600">No tasks</p>
                      ) : (
                        (tasksByStatus[col.key] ?? []).map((t) => {
                          const np = nextStatus(t.status)
                          const pv = prevStatus(t.status)
                          const busy = busyTaskId === t.id
                          return (
                            <div key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm text-zinc-200">{t.description}</p>
                                {t.kind && <Badge tone="zinc">{t.kind}</Badge>}
                              </div>
                              {t.due_at && (
                                <p className="mt-1 text-xs text-zinc-500">Due {fmtDate(t.due_at)}</p>
                              )}
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {pv && (
                                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => transition(t, pv)}>
                                    ← {TASK_COLUMNS.find((c) => c.key === pv)?.label}
                                  </Button>
                                )}
                                {np && (
                                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => transition(t, np)}>
                                    {TASK_COLUMNS.find((c) => c.key === np)?.label} →
                                  </Button>
                                )}
                                <Button size="sm" variant="danger" disabled={busy} onClick={() => removeTask(t)}>
                                  Delete
                                </Button>
                                {busy && <Spinner />}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Runbook Task"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addBusy}>
              Cancel
            </Button>
            <Button onClick={submitAdd} disabled={addBusy || !addForm.description.trim()}>
              {addBusy ? <Spinner /> : 'Add Task'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitAdd} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Kind</label>
            <select
              value={addForm.kind}
              onChange={(e) => setAddForm((f) => ({ ...f, kind: e.target.value }))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            >
              {TASK_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Description</label>
            <textarea
              value={addForm.description}
              onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="e.g. Rotate the leaked API key in AWS Secrets Manager"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-700 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Due (optional)</label>
            <input
              type="datetime-local"
              value={addForm.due_at}
              onChange={(e) => setAddForm((f) => ({ ...f, due_at: e.target.value }))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            />
          </div>
        </form>
      </Modal>
    </div>
  )
}
