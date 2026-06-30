'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

interface EvidenceRecord {
  id: string
  exposure_id: string
  content_hash: string
  mttc_minutes: number | null
  completeness_pct: number
  payload?: unknown
  signed_at: string | null
  created_at: string
}

interface Exposure {
  id: string
  title: string
  severity: string
  status: string
  detected_at: string | null
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function fmtMinutes(min?: number | null) {
  if (min == null) return '—'
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h}h ${m}m`
}

export default function EvidencePage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [records, setRecords] = useState<EvidenceRecord[]>([])
  const [exposures, setExposures] = useState<Exposure[]>([])

  const [search, setSearch] = useState('')

  const [genOpen, setGenOpen] = useState(false)
  const [genExposureId, setGenExposureId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  const [viewing, setViewing] = useState<EvidenceRecord | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)

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
      const [recs, exps] = await Promise.all([api.getEvidenceRecords(), api.getExposures()])
      setRecords(Array.isArray(recs) ? recs : recs?.records ?? [])
      setExposures(Array.isArray(exps) ? exps : exps?.exposures ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load evidence records')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authed) load()
  }, [authed, load])

  const exposureTitle = useCallback(
    (id: string) => exposures.find((x) => x.id === id)?.title ?? id.slice(0, 8),
    [exposures],
  )

  // Only contained/closed exposures can have evidence generated.
  const eligibleExposures = useMemo(
    () => exposures.filter((x) => ['contained', 'closed', 'resolved'].includes((x.status ?? '').toLowerCase())),
    [exposures],
  )

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return records
    return records.filter(
      (r) => r.content_hash.toLowerCase().includes(term) || exposureTitle(r.exposure_id).toLowerCase().includes(term),
    )
  }, [records, search, exposureTitle])

  const avgCompleteness = records.length
    ? Math.round(records.reduce((acc, r) => acc + (r.completeness_pct || 0), 0) / records.length)
    : 0
  const avgMttc = (() => {
    const withMttc = records.filter((r) => r.mttc_minutes != null)
    if (!withMttc.length) return null
    return withMttc.reduce((acc, r) => acc + (r.mttc_minutes || 0), 0) / withMttc.length
  })()

  function openGenerate() {
    setGenError(null)
    setGenExposureId(eligibleExposures[0]?.id ?? '')
    setGenOpen(true)
  }

  async function generate() {
    if (!genExposureId) {
      setGenError('Select an exposure to generate evidence for')
      return
    }
    setGenerating(true)
    setGenError(null)
    try {
      await api.generateEvidence(genExposureId)
      setGenOpen(false)
      await load()
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Evidence generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function view(rec: EvidenceRecord) {
    setViewing(rec)
    setViewError(null)
    setViewLoading(true)
    try {
      const full = await api.getEvidenceRecord(rec.id)
      setViewing(full ?? rec)
    } catch (e) {
      setViewError(e instanceof Error ? e.message : 'Failed to load full record')
    } finally {
      setViewLoading(false)
    }
  }

  if (!authed) return <PageSpinner label="Authenticating..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Signed Evidence Records</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Tamper-evident incident packages — blast radius, timeline, runbook completion, MTTC and content hash — ready for
            insurers and auditors.
          </p>
        </div>
        <Button onClick={openGenerate}>Generate evidence</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Records" value={records.length} />
        <Stat label="Eligible exposures" value={eligibleExposures.length} tone="blue" />
        <Stat
          label="Avg completeness"
          value={`${avgCompleteness}%`}
          tone={avgCompleteness >= 80 ? 'green' : avgCompleteness >= 50 ? 'amber' : 'red'}
        />
        <Stat label="Avg MTTC" value={fmtMinutes(avgMttc)} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Evidence ledger</CardTitle>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hash / exposure..."
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-red-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <Spinner label="Loading evidence..." />
            </div>
          ) : visible.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No evidence records"
                description={
                  eligibleExposures.length
                    ? 'Generate a signed evidence package from a contained or closed exposure.'
                    : 'Contain or close an exposure first, then generate a signed evidence package from it.'
                }
                action={eligibleExposures.length ? <Button onClick={openGenerate}>Generate evidence</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Exposure</TH>
                  <TH>Content hash</TH>
                  <TH className="text-right">MTTC</TH>
                  <TH className="text-right">Completeness</TH>
                  <TH>Signed</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((r) => {
                  const exp = exposures.find((x) => x.id === r.exposure_id)
                  return (
                    <TR key={r.id}>
                      <TD>
                        <div className="font-medium text-zinc-100">{exposureTitle(r.exposure_id)}</div>
                        {exp && <Badge tone={severityTone(exp.severity)} className="mt-1">{exp.severity}</Badge>}
                      </TD>
                      <TD className="font-mono text-xs text-zinc-400">{r.content_hash.slice(0, 16)}…</TD>
                      <TD className="text-right tabular-nums">{fmtMinutes(r.mttc_minutes)}</TD>
                      <TD className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className={`h-full rounded-full ${
                                r.completeness_pct >= 80 ? 'bg-emerald-500' : r.completeness_pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${Math.min(100, r.completeness_pct)}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-xs text-zinc-400">{Math.round(r.completeness_pct)}%</span>
                        </div>
                      </TD>
                      <TD>
                        {r.signed_at ? (
                          <Badge tone="green">{fmtDateTime(r.signed_at)}</Badge>
                        ) : (
                          <Badge tone="amber">Unsigned</Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Button size="sm" variant="secondary" onClick={() => view(r)}>
                          View
                        </Button>
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
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title="Generate signed evidence"
        footer={
          <>
            <Button variant="secondary" onClick={() => setGenOpen(false)} disabled={generating}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={generating || !genExposureId}>
              {generating ? <Spinner label="Generating..." /> : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {genError && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{genError}</div>
          )}
          <p className="text-sm text-zinc-400">
            Evidence packages bundle the blast radius snapshot, reconstructed timeline, runbook task completion, copy-discovery
            results, MTTC and a content hash for the chosen exposure.
          </p>
          {eligibleExposures.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-zinc-500">
              No contained or closed exposures available. Contain an exposure first.
            </div>
          ) : (
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Exposure</span>
              <select
                value={genExposureId}
                onChange={(e) => setGenExposureId(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
              >
                {eligibleExposures.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title} — {x.status}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Modal>

      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title="Evidence record"
        className="max-w-2xl"
        footer={
          <Button variant="secondary" onClick={() => setViewing(null)}>
            Close
          </Button>
        }
      >
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Exposure" value={<span className="text-base">{exposureTitle(viewing.exposure_id)}</span>} />
              <Stat label="MTTC" value={fmtMinutes(viewing.mttc_minutes)} />
              <Stat
                label="Completeness"
                value={`${Math.round(viewing.completeness_pct)}%`}
                tone={viewing.completeness_pct >= 80 ? 'green' : 'amber'}
              />
              <Stat label="Signed at" value={<span className="text-base">{fmtDateTime(viewing.signed_at)}</span>} />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Content hash</div>
              <div className="break-all rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">
                {viewing.content_hash}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Signed payload</div>
              {viewLoading ? (
                <div className="py-4">
                  <Spinner label="Loading payload..." />
                </div>
              ) : viewError ? (
                <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{viewError}</div>
              ) : (
                <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
                  {viewing.payload ? JSON.stringify(viewing.payload, null, 2) : 'No payload recorded.'}
                </pre>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
