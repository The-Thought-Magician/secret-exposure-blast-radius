'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, severityTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface ClusterSecret {
  id: string
  name: string
  type: string | null
  owning_service: string | null
  environment: string | null
  criticality: string | null
  status: string | null
  last_four: string | null
}

interface Cluster {
  id: string
  fingerprint: string
  secret_count: number
  risk_score: number
  created_at: string
  secrets?: ClusterSecret[]
}

function riskTone(score: number): 'red' | 'amber' | 'green' {
  if (score >= 70) return 'red'
  if (score >= 40) return 'amber'
  return 'green'
}

function riskLabel(score: number): string {
  if (score >= 70) return 'Critical'
  if (score >= 40) return 'Elevated'
  return 'Low'
}

export default function ReusePage() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)

  const [search, setSearch] = useState('')
  const [onlyRisky, setOnlyRisky] = useState(false)

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ cluster: Cluster; secrets: ClusterSecret[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getReuseClusters()
      setClusters(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reuse clusters')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function recompute() {
    setRecomputing(true)
    setError(null)
    try {
      const res = await api.recomputeReuse()
      if (res && Array.isArray(res.clusters)) {
        setClusters(res.clusters)
      } else {
        await load()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to recompute')
    } finally {
      setRecomputing(false)
    }
  }

  async function openCluster(id: string) {
    setOpenId(id)
    setDetail(null)
    setDetailLoading(true)
    setDetailError(null)
    try {
      const data = await api.getReuseCluster(id)
      setDetail(data)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load cluster')
    } finally {
      setDetailLoading(false)
    }
  }

  const filtered = useMemo(() => {
    let list = clusters
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (c) =>
          c.fingerprint.toLowerCase().includes(q) ||
          (c.secrets ?? []).some((s) => s.name.toLowerCase().includes(q)),
      )
    }
    if (onlyRisky) list = list.filter((c) => (c.secret_count || 0) > 1)
    return [...list].sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))
  }, [clusters, search, onlyRisky])

  const stats = useMemo(() => {
    const reused = clusters.filter((c) => (c.secret_count || 0) > 1)
    const maxRisk = clusters.reduce((m, c) => Math.max(m, c.risk_score || 0), 0)
    const reusedSecrets = reused.reduce((s, c) => s + (c.secret_count || 0), 0)
    return {
      total: clusters.length,
      reusedClusters: reused.length,
      reusedSecrets,
      maxRisk: Math.round(maxRisk),
    }
  }, [clusters])

  const maxRiskBar = useMemo(
    () => Math.max(1, ...filtered.map((c) => c.risk_score || 0)),
    [filtered],
  )

  if (loading) return <PageSpinner label="Loading reuse clusters..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Reuse Detector</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Secrets sharing a fingerprint across services and stores. Reuse multiplies blast radius:
            one leak compromises every place the same value lives.
          </p>
        </div>
        <Button onClick={recompute} disabled={recomputing}>
          {recomputing ? <Spinner label="Recomputing..." /> : 'Recompute Clusters'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Clusters" value={stats.total} />
        <Stat
          label="Reused Fingerprints"
          value={stats.reusedClusters}
          tone={stats.reusedClusters > 0 ? 'red' : 'green'}
          hint=">1 secret shares the value"
        />
        <Stat label="Affected Secrets" value={stats.reusedSecrets} tone={stats.reusedSecrets > 0 ? 'amber' : 'default'} />
        <Stat label="Max Risk" value={stats.maxRisk} tone={riskTone(stats.maxRisk)} hint={riskLabel(stats.maxRisk)} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Clusters by Risk</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={onlyRisky}
                onChange={(e) => setOnlyRisky(e.target.checked)}
                className="accent-red-600"
              />
              Reused only
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fingerprint or secret..."
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-700 focus:outline-none"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {error ? (
            <div className="px-5 py-6 text-sm text-red-400">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No reuse clusters"
                description="Recompute to scan registered secrets for shared fingerprints. Clusters appear once two or more secrets share a value."
                action={<Button size="sm" onClick={recompute} disabled={recomputing}>Recompute</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Fingerprint</TH>
                  <TH>Secrets</TH>
                  <TH className="w-1/3">Risk</TH>
                  <TH>Tier</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {filtered.map((c) => {
                  const score = Math.round(c.risk_score || 0)
                  const tone = riskTone(score)
                  return (
                    <TR key={c.id}>
                      <TD className="font-mono text-xs text-zinc-300">
                        {c.fingerprint.length > 24 ? `${c.fingerprint.slice(0, 24)}…` : c.fingerprint}
                      </TD>
                      <TD>
                        <Badge tone={(c.secret_count || 0) > 1 ? 'red' : 'zinc'}>
                          {c.secret_count} secret{c.secret_count === 1 ? '' : 's'}
                        </Badge>
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className={
                                tone === 'red'
                                  ? 'h-full bg-red-500'
                                  : tone === 'amber'
                                    ? 'h-full bg-amber-500'
                                    : 'h-full bg-emerald-500'
                              }
                              style={{ width: `${(score / maxRiskBar) * 100}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-xs tabular-nums text-zinc-400">{score}</span>
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={tone}>{riskLabel(score)}</Badge>
                      </TD>
                      <TD className="text-right">
                        <Button size="sm" variant="secondary" onClick={() => openCluster(c.id)}>
                          Inspect
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
        open={openId !== null}
        onClose={() => { setOpenId(null); setDetail(null) }}
        title="Reuse Cluster Detail"
        className="max-w-2xl"
      >
        {detailLoading ? (
          <div className="py-8 text-center"><Spinner label="Loading cluster..." /></div>
        ) : detailError ? (
          <div className="text-sm text-red-400">{detailError}</div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Risk Score" value={Math.round(detail.cluster.risk_score || 0)} tone={riskTone(detail.cluster.risk_score || 0)} />
              <Stat label="Members" value={detail.secrets?.length ?? detail.cluster.secret_count} />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Shared Fingerprint</div>
              <div className="mt-1 break-all rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">
                {detail.cluster.fingerprint}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Secrets Sharing This Value
              </div>
              {(detail.secrets ?? []).length === 0 ? (
                <p className="text-sm text-zinc-500">No member secrets.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Service</TH>
                      <TH>Env</TH>
                      <TH>Criticality</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {(detail.secrets ?? []).map((s) => (
                      <TR key={s.id}>
                        <TD className="text-zinc-200">
                          {s.name}
                          {s.last_four && <span className="ml-2 font-mono text-xs text-zinc-500">…{s.last_four}</span>}
                        </TD>
                        <TD>{s.owning_service ?? '—'}</TD>
                        <TD>{s.environment ?? '—'}</TD>
                        <TD>
                          {s.criticality ? <Badge tone={severityTone(s.criticality)}>{s.criticality}</Badge> : '—'}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
