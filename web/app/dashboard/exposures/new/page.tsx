'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge, severityTone } from '@/components/ui/Badge'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'

interface Secret {
  id: string
  name: string
  type?: string
  environment?: string
  criticality?: string
  status?: string
}

const VECTORS = [
  'git_commit',
  'log_dump',
  'ticket_paste',
  'third_party_breach',
  'screen_share',
  'other',
]

const SEVERITIES = ['critical', 'high', 'medium', 'low']

function nowLocalInput(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60000)
  return local.toISOString().slice(0, 16)
}

export default function NewExposurePage() {
  const router = useRouter()

  const [secrets, setSecrets] = useState<Secret[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [secretId, setSecretId] = useState('')
  const [secretSearch, setSecretSearch] = useState('')
  const [title, setTitle] = useState('')
  const [vector, setVector] = useState('git_commit')
  const [severity, setSeverity] = useState('')
  const [exposedSince, setExposedSince] = useState('')
  const [detectedAt, setDetectedAt] = useState(nowLocalInput())
  const [notes, setNotes] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        const res = await api.getSecrets()
        if (cancelled) return
        const list: Secret[] = Array.isArray(res) ? res : res?.secrets ?? []
        setSecrets(list)
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load secrets')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredSecrets = useMemo(() => {
    const q = secretSearch.trim().toLowerCase()
    if (!q) return secrets
    return secrets.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.type?.toLowerCase().includes(q) ||
        s.environment?.toLowerCase().includes(q),
    )
  }, [secrets, secretSearch])

  const selectedSecret = secrets.find((s) => s.id === secretId) ?? null
  const canSubmit = secretId !== '' && title.trim() !== '' && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        secret_id: secretId,
        title: title.trim(),
        vector,
      }
      if (severity) body.severity = severity
      if (exposedSince) body.exposed_since = new Date(exposedSince).toISOString()
      if (detectedAt) body.detected_at = new Date(detectedAt).toISOString()
      if (notes.trim()) body.notes = notes.trim()

      const res = await api.createExposure(body)
      const created = res?.exposure ?? res
      const newId = created?.id
      if (newId) {
        router.push(`/dashboard/exposures/${newId}`)
      } else {
        router.push('/dashboard/exposures')
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to declare exposure')
      setSubmitting(false)
    }
  }

  if (loading) return <PageSpinner label="Loading secrets..." />

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Could not load secrets"
          description={loadError}
          action={
            <Button variant="secondary" onClick={() => location.reload()}>
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  const fieldClass =
    'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-red-700 focus:outline-none'
  const labelClass = 'block text-xs font-medium uppercase tracking-wide text-zinc-500'

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="mb-1 text-sm text-zinc-500">
          <Link href="/dashboard/exposures" className="hover:text-red-400">
            Exposures
          </Link>{' '}
          / Declare
        </div>
        <h1 className="text-xl font-semibold text-zinc-100">Declare Exposure</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Declaring computes the blast radius, persists a snapshot, derives severity, and auto-generates a runbook with
          tasks and a timeline start.
        </p>
      </div>

      {secrets.length === 0 ? (
        <EmptyState
          title="No secrets to expose"
          description="Register at least one secret before declaring an exposure."
          action={
            <Link href="/dashboard/secrets">
              <Button>Go to Secrets</Button>
            </Link>
          }
        />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Affected Secret</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <input
                value={secretSearch}
                onChange={(e) => setSecretSearch(e.target.value)}
                placeholder="Search secrets..."
                className={fieldClass}
              />
              <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {filteredSecrets.map((s) => {
                  const active = s.id === secretId
                  return (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => setSecretId(s.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-red-800 bg-red-950/30'
                          : 'border-transparent bg-zinc-950/40 hover:border-zinc-800 hover:bg-zinc-900'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-zinc-100">{s.name}</span>
                        <span className="text-xs text-zinc-500">
                          {[s.type, s.environment].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {s.criticality && <Badge tone={severityTone(s.criticality)}>{s.criticality}</Badge>}
                        {active && <span className="text-red-400">✓</span>}
                      </span>
                    </button>
                  )
                })}
                {filteredSecrets.length === 0 && (
                  <p className="px-1 py-4 text-center text-sm text-zinc-600">No secrets match your search.</p>
                )}
              </div>
              {selectedSecret && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
                  Selected: <span className="font-medium text-zinc-100">{selectedSecret.name}</span>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Incident Details</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <label className={labelClass} htmlFor="title">
                  Title
                </label>
                <input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Prod DB password leaked in public commit"
                  className={`mt-1 ${fieldClass}`}
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="vector">
                    Vector
                  </label>
                  <select id="vector" value={vector} onChange={(e) => setVector(e.target.value)} className={`mt-1 ${fieldClass}`}>
                    {VECTORS.map((v) => (
                      <option key={v} value={v}>
                        {v.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="severity">
                    Severity (optional — derived if blank)
                  </label>
                  <select
                    id="severity"
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className={`mt-1 ${fieldClass}`}
                  >
                    <option value="">Auto-derive</option>
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s[0].toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="exposed">
                    Exposed Since (optional)
                  </label>
                  <input
                    id="exposed"
                    type="datetime-local"
                    value={exposedSince}
                    onChange={(e) => setExposedSince(e.target.value)}
                    className={`mt-1 ${fieldClass}`}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="detected">
                    Detected At
                  </label>
                  <input
                    id="detected"
                    type="datetime-local"
                    value={detectedAt}
                    onChange={(e) => setDetectedAt(e.target.value)}
                    className={`mt-1 ${fieldClass}`}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass} htmlFor="notes">
                  Notes (optional)
                </label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Context, source, who reported it..."
                  className={`mt-1 ${fieldClass}`}
                />
              </div>
            </CardBody>
          </Card>

          {submitError && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {submitError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <Link href="/dashboard/exposures">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? <Spinner label="Declaring..." /> : 'Declare Exposure'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
