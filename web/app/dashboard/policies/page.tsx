'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { authClient } from '@/lib/auth/client'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge, severityTone } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface Policy {
  id: string
  name: string
  applies_to_type: string | null
  applies_to_criticality: string | null
  max_age_days: number
  grace_days: number
  escalation_days: number
  created_at: string
}

const SECRET_TYPES = ['', 'api_key', 'oauth_token', 'database_credential', 'ssh_key', 'certificate', 'webhook_secret']
const CRITICALITIES = ['', 'critical', 'high', 'medium', 'low']

const emptyForm = {
  name: '',
  applies_to_type: '',
  applies_to_criticality: '',
  max_age_days: 90,
  grace_days: 14,
  escalation_days: 7,
}

type FormState = typeof emptyForm

export default function PoliciesPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [policies, setPolicies] = useState<Policy[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Policy | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    authClient
      .getSession()
      .then((session) => {
        if (!active) return
        if (!(session as { data?: { user?: unknown } } | null)?.data?.user) {
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
      const data = await api.getPolicies()
      setPolicies(Array.isArray(data) ? data : data?.policies ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load policies')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authed) load()
  }, [authed, load])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(p: Policy) {
    setEditing(p)
    setForm({
      name: p.name,
      applies_to_type: p.applies_to_type ?? '',
      applies_to_criticality: p.applies_to_criticality ?? '',
      max_age_days: p.max_age_days,
      grace_days: p.grace_days,
      escalation_days: p.escalation_days,
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function save() {
    if (!form.name.trim()) {
      setFormError('Policy name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    const body = {
      name: form.name.trim(),
      applies_to_type: form.applies_to_type || null,
      applies_to_criticality: form.applies_to_criticality || null,
      max_age_days: Number(form.max_age_days),
      grace_days: Number(form.grace_days),
      escalation_days: Number(form.escalation_days),
    }
    try {
      if (editing) {
        await api.updatePolicy(editing.id, body)
      } else {
        await api.createPolicy(body)
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(p: Policy) {
    if (!confirm(`Delete policy "${p.name}"? This cannot be undone.`)) return
    setDeletingId(p.id)
    setError(null)
    try {
      await api.deletePolicy(p.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  const avgMaxAge = policies.length
    ? Math.round(policies.reduce((acc, p) => acc + (p.max_age_days || 0), 0) / policies.length)
    : 0
  const strictest = policies.reduce<number | null>(
    (min, p) => (min === null ? p.max_age_days : Math.min(min, p.max_age_days)),
    null,
  )

  if (!authed) return <PageSpinner label="Authenticating..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Rotation Policies</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Define max-age, grace, and escalation windows that drive rotation-debt scoring across your secret inventory.
          </p>
        </div>
        <Button onClick={openCreate}>New policy</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Policies" value={policies.length} />
        <Stat label="Avg max age (d)" value={avgMaxAge} tone="amber" />
        <Stat label="Strictest (d)" value={strictest ?? '—'} tone={strictest && strictest <= 30 ? 'red' : 'default'} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Policy set</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <Spinner label="Loading policies..." />
            </div>
          ) : policies.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No rotation policies yet"
                description="Create a policy to define how long secrets of a given type or criticality may live before they accrue rotation debt."
                action={<Button onClick={openCreate}>New policy</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Applies to type</TH>
                  <TH>Criticality</TH>
                  <TH className="text-right">Max age (d)</TH>
                  <TH className="text-right">Grace (d)</TH>
                  <TH className="text-right">Escalation (d)</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {policies.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium text-zinc-100">{p.name}</TD>
                    <TD>{p.applies_to_type ? <Badge tone="blue">{p.applies_to_type}</Badge> : <span className="text-zinc-600">Any</span>}</TD>
                    <TD>
                      {p.applies_to_criticality ? (
                        <Badge tone={severityTone(p.applies_to_criticality)}>{p.applies_to_criticality}</Badge>
                      ) : (
                        <span className="text-zinc-600">Any</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{p.max_age_days}</TD>
                    <TD className="text-right tabular-nums text-zinc-400">{p.grace_days}</TD>
                    <TD className="text-right tabular-nums text-zinc-400">{p.escalation_days}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => remove(p)} disabled={deletingId === p.id}>
                          {deletingId === p.id ? '...' : 'Delete'}
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
        title={editing ? 'Edit policy' : 'New rotation policy'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Spinner label="Saving..." /> : editing ? 'Save changes' : 'Create policy'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{formError}</div>
          )}
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Critical API keys — 30 day"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-red-500 focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Applies to type">
              <select
                value={form.applies_to_type}
                onChange={(e) => setForm((f) => ({ ...f, applies_to_type: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
              >
                {SECRET_TYPES.map((t) => (
                  <option key={t || 'any'} value={t}>
                    {t || 'Any type'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Applies to criticality">
              <select
                value={form.applies_to_criticality}
                onChange={(e) => setForm((f) => ({ ...f, applies_to_criticality: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
              >
                {CRITICALITIES.map((c) => (
                  <option key={c || 'any'} value={c}>
                    {c || 'Any criticality'}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Max age (days)">
              <input
                type="number"
                min={1}
                value={form.max_age_days}
                onChange={(e) => setForm((f) => ({ ...f, max_age_days: Number(e.target.value) }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
              />
            </Field>
            <Field label="Grace (days)">
              <input
                type="number"
                min={0}
                value={form.grace_days}
                onChange={(e) => setForm((f) => ({ ...f, grace_days: Number(e.target.value) }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
              />
            </Field>
            <Field label="Escalation (days)">
              <input
                type="number"
                min={0}
                value={form.escalation_days}
                onChange={(e) => setForm((f) => ({ ...f, escalation_days: Number(e.target.value) }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
              />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}
