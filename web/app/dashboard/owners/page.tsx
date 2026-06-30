'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Owner {
  id: string
  name: string
  email?: string
  team?: string
  escalation_contact?: string
  open_task_count?: number
  created_at?: string
}

interface OwnerDetail {
  owner: Owner
  resources?: Array<{ id: string; name: string; type?: string; sensitivity?: string }>
  stores?: Array<{ id: string; name: string; type?: string }>
  tasks?: Array<{ id: string; description?: string; status?: string; kind?: string }>
}

interface Resource {
  id: string
  name: string
  type?: string
}

interface Store {
  id: string
  name: string
  type?: string
}

const EMPTY_FORM = { name: '', email: '', team: '', escalation_contact: '' }

export default function OwnersPage() {
  const [owners, setOwners] = useState<Owner[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [teamFilter, setTeamFilter] = useState('all')

  // create / edit
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Owner | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  // detail
  const [detail, setDetail] = useState<OwnerDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // assign
  const [assignFor, setAssignFor] = useState<Owner | null>(null)
  const [assignKind, setAssignKind] = useState<'resource' | 'store'>('resource')
  const [assignTarget, setAssignTarget] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignErr, setAssignErr] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [o, r, s] = await Promise.all([api.getOwners(), api.getResources(), api.getStores()])
      setOwners(Array.isArray(o) ? o : [])
      setResources(Array.isArray(r) ? r : [])
      setStores(Array.isArray(s) ? s : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load owners')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const teams = useMemo(() => {
    const set = new Set<string>()
    owners.forEach((o) => o.team && set.add(o.team))
    return Array.from(set).sort()
  }, [owners])

  const filtered = useMemo(() => {
    return owners.filter((o) => {
      if (teamFilter !== 'all' && (o.team ?? '') !== teamFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${o.name} ${o.email ?? ''} ${o.team ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [owners, search, teamFilter])

  const stats = useMemo(() => {
    const total = owners.length
    const openTasks = owners.reduce((a, o) => a + (o.open_task_count ?? 0), 0)
    const withTasks = owners.filter((o) => (o.open_task_count ?? 0) > 0).length
    return { total, openTasks, withTasks, teams: teams.length }
  }, [owners, teams])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormErr(null)
    setFormOpen(true)
  }

  function openEdit(o: Owner) {
    setEditing(o)
    setForm({
      name: o.name ?? '',
      email: o.email ?? '',
      team: o.team ?? '',
      escalation_contact: o.escalation_contact ?? '',
    })
    setFormErr(null)
    setFormOpen(true)
  }

  async function submitForm() {
    if (!form.name.trim()) {
      setFormErr('Name is required.')
      return
    }
    setSaving(true)
    setFormErr(null)
    const body = {
      name: form.name.trim(),
      email: form.email.trim() || undefined,
      team: form.team.trim() || undefined,
      escalation_contact: form.escalation_contact.trim() || undefined,
    }
    try {
      if (editing) await api.updateOwner(editing.id, body)
      else await api.createOwner(body)
      setFormOpen(false)
      await load()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to save owner')
    } finally {
      setSaving(false)
    }
  }

  async function openDetail(o: Owner) {
    setDetail({ owner: o })
    setDetailLoading(true)
    try {
      const full = await api.getOwner(o.id)
      if (full && typeof full === 'object') setDetail(full as OwnerDetail)
    } catch (e) {
      setDetail({ owner: o, resources: [], stores: [], tasks: [] })
    } finally {
      setDetailLoading(false)
    }
  }

  async function remove(o: Owner) {
    if (!confirm(`Delete owner "${o.name}"? Assignments referencing them may be affected.`)) return
    setBusyId(o.id)
    try {
      await api.deleteOwner(o.id)
      if (detail?.owner.id === o.id) setDetail(null)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete owner')
    } finally {
      setBusyId(null)
    }
  }

  function openAssign(o: Owner) {
    setAssignFor(o)
    setAssignKind('resource')
    setAssignTarget('')
    setAssignErr(null)
  }

  async function submitAssign() {
    if (!assignFor) return
    if (!assignTarget) {
      setAssignErr(`Pick a ${assignKind} to assign.`)
      return
    }
    setAssigning(true)
    setAssignErr(null)
    const body: Record<string, string> = { owner_id: assignFor.id }
    if (assignKind === 'resource') body.resource_id = assignTarget
    else body.store_id = assignTarget
    try {
      await api.assignOwner(body)
      setAssignFor(null)
      await load()
    } catch (e) {
      setAssignErr(e instanceof Error ? e.message : 'Failed to assign')
    } finally {
      setAssigning(false)
    }
  }

  if (loading) return <PageSpinner label="Loading owner directory..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Owner Directory</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            The people on the hook when a secret leaks. Keep contacts and escalation paths current so runbook tasks
            route to a real human at 2am.
          </p>
        </div>
        <Button onClick={openCreate}>+ New Owner</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error} <button className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Owners" value={stats.total} />
        <Stat label="Teams" value={stats.teams} />
        <Stat label="Open Tasks" value={stats.openTasks} tone={stats.openTasks ? 'amber' : 'default'} />
        <Stat label="Owners w/ Open Work" value={stats.withTasks} tone={stats.withTasks ? 'red' : 'green'} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Owners</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name / email / team..."
              className="w-56 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-700 focus:outline-none"
            />
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            >
              <option value="all">All teams</option>
              {teams.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={owners.length === 0 ? 'No owners yet' : 'No owners match your filters'}
                description={
                  owners.length === 0
                    ? 'Add the engineers and teams responsible for your secrets and resources.'
                    : 'Try clearing the search or team filter.'
                }
                action={owners.length === 0 ? <Button onClick={openCreate}>+ New Owner</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Team</TH>
                  <TH>Escalation</TH>
                  <TH>Open Tasks</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </THead>
              <TBody>
                {filtered.map((o) => (
                  <TR key={o.id} className="cursor-pointer" onClick={() => openDetail(o)}>
                    <TD className="font-medium text-zinc-100">{o.name}</TD>
                    <TD>{o.email ?? '—'}</TD>
                    <TD>{o.team ? <Badge tone="zinc">{o.team}</Badge> : '—'}</TD>
                    <TD className="text-zinc-500">{o.escalation_contact ?? '—'}</TD>
                    <TD>
                      {o.open_task_count != null ? (
                        <Badge tone={o.open_task_count > 0 ? 'amber' : 'green'}>{o.open_task_count}</Badge>
                      ) : '—'}
                    </TD>
                    <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openAssign(o)}>Assign</Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(o)}>Edit</Button>
                        <Button size="sm" variant="danger" disabled={busyId === o.id} onClick={() => remove(o)}>
                          {busyId === o.id ? '…' : 'Delete'}
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

      {/* Create / Edit modal */}
      <Modal
        open={formOpen}
        onClose={() => !saving && setFormOpen(false)}
        title={editing ? 'Edit Owner' : 'New Owner'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? <Spinner label="Saving..." /> : editing ? 'Save Changes' : 'Create Owner'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formErr && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{formErr}</div>
          )}
          {([
            { key: 'name', label: 'Name', placeholder: 'Jordan Lee', type: 'text' },
            { key: 'email', label: 'Email', placeholder: 'jordan@acme.com', type: 'email' },
            { key: 'team', label: 'Team', placeholder: 'Platform', type: 'text' },
            { key: 'escalation_contact', label: 'Escalation Contact', placeholder: '#sec-incidents / PagerDuty', type: 'text' },
          ] as const).map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">{f.label}</label>
              <input
                type={f.type}
                value={form[f.key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-700 focus:outline-none"
              />
            </div>
          ))}
        </div>
      </Modal>

      {/* Assign modal */}
      <Modal
        open={assignFor != null}
        onClose={() => !assigning && setAssignFor(null)}
        title={`Assign ${assignFor?.name ?? 'Owner'}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssignFor(null)} disabled={assigning}>Cancel</Button>
            <Button onClick={submitAssign} disabled={assigning}>
              {assigning ? <Spinner label="Assigning..." /> : 'Assign'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {assignErr && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{assignErr}</div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Assign to</label>
            <div className="flex gap-2">
              {(['resource', 'store'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setAssignKind(k)
                    setAssignTarget('')
                  }}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${assignKind === k ? 'border-red-700 bg-red-950/20 text-red-300' : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'}`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              {assignKind === 'resource' ? 'Resource' : 'Store'}
            </label>
            <select
              value={assignTarget}
              onChange={(e) => setAssignTarget(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            >
              <option value="">Select a {assignKind}...</option>
              {(assignKind === 'resource' ? resources : stores).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}{item.type ? ` · ${item.type}` : ''}
                </option>
              ))}
            </select>
            {(assignKind === 'resource' ? resources : stores).length === 0 && (
              <p className="mt-1 text-xs text-amber-400">No {assignKind}s available to assign yet.</p>
            )}
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal open={detail != null} onClose={() => setDetail(null)} title="Owner Detail" className="max-w-2xl">
        {detail && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-zinc-100">{detail.owner.name}</span>
              {detail.owner.team && <Badge tone="zinc">{detail.owner.team}</Badge>}
              {detailLoading && <Spinner />}
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Email</div>
                <div className="text-zinc-300">{detail.owner.email ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Escalation</div>
                <div className="text-zinc-300">{detail.owner.escalation_contact ?? '—'}</div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Assigned Resources ({detail.resources?.length ?? 0})
              </div>
              {detail.resources && detail.resources.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {detail.resources.map((r) => (
                    <Badge key={r.id} tone="blue">{r.name}{r.sensitivity ? ` · ${r.sensitivity}` : ''}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-600">None</p>
              )}
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Assigned Stores ({detail.stores?.length ?? 0})
              </div>
              {detail.stores && detail.stores.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {detail.stores.map((s) => (
                    <Badge key={s.id} tone="purple">{s.name}{s.type ? ` · ${s.type}` : ''}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-600">None</p>
              )}
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Open Tasks ({detail.tasks?.length ?? 0})
              </div>
              {detail.tasks && detail.tasks.length > 0 ? (
                <ul className="space-y-1">
                  {detail.tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
                      <span className="text-zinc-300">{t.description ?? t.kind ?? 'Task'}</span>
                      {t.status && <Badge tone="amber">{t.status}</Badge>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-zinc-600">No open tasks</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { const o = detail.owner; setDetail(null); openAssign(o) }}>Assign Work</Button>
              <Button variant="ghost" onClick={() => { const o = detail.owner; setDetail(null); openEdit(o) }}>Edit</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
