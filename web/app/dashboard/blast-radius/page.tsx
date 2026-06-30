'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { Badge, severityTone } from '@/components/ui/Badge'
import { Spinner, PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Secret {
  id: string
  name: string
  type?: string
  environment?: string
  criticality?: string
  status?: string
}

interface SummaryEntry {
  secret_id: string
  name: string
  score: number
  reachable_count: number
}

interface GraphNode {
  id: string
  label?: string
  name?: string
  type?: string
  kind?: string
  sensitivity?: string
  depth?: number
  crown_jewel?: boolean
}

interface GraphEdge {
  from?: string
  to?: string
  source?: string
  target?: string
  permission?: string
  scope?: string
}

interface ReachableResource {
  id: string
  name?: string
  type?: string
  sensitivity?: string
  environment?: string
  depth?: number
  crown_jewel?: boolean
  path?: Array<{ id: string; name?: string }> | string[]
}

interface BlastRadius {
  score: number
  reachable_count: number
  crown_jewel_count: number
  max_depth: number
  reachable_resources: ReachableResource[]
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
}

function scoreTone(score: number): 'red' | 'amber' | 'green' {
  if (score >= 70) return 'red'
  if (score >= 40) return 'amber'
  return 'green'
}

export default function BlastRadiusPage() {
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [summary, setSummary] = useState<SummaryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [radius, setRadius] = useState<BlastRadius | null>(null)
  const [radiusLoading, setRadiusLoading] = useState(false)
  const [radiusError, setRadiusError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        const [secretsRes, summaryRes] = await Promise.all([
          api.getSecrets(),
          api.getBlastRadiusSummary(),
        ])
        if (cancelled) return
        const secretList: Secret[] = Array.isArray(secretsRes) ? secretsRes : secretsRes?.secrets ?? []
        const summaryList: SummaryEntry[] = summaryRes?.secrets ?? (Array.isArray(summaryRes) ? summaryRes : [])
        setSecrets(secretList)
        setSummary(summaryList)
        const initial = summaryList[0]?.secret_id ?? secretList[0]?.id ?? null
        if (initial) setSelectedId(initial)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load blast radius data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setRadius(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        setRadiusLoading(true)
        setRadiusError(null)
        const res = await api.getBlastRadius(selectedId)
        if (cancelled) return
        setRadius({
          score: res?.score ?? 0,
          reachable_count: res?.reachable_count ?? 0,
          crown_jewel_count: res?.crown_jewel_count ?? 0,
          max_depth: res?.max_depth ?? 0,
          reachable_resources: res?.reachable_resources ?? [],
          graph: { nodes: res?.graph?.nodes ?? [], edges: res?.graph?.edges ?? [] },
        })
      } catch (e) {
        if (!cancelled) setRadiusError(e instanceof Error ? e.message : 'Failed to compute blast radius')
      } finally {
        if (!cancelled) setRadiusLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const summaryById = useMemo(() => {
    const m = new Map<string, SummaryEntry>()
    for (const s of summary) m.set(s.secret_id, s)
    return m
  }, [summary])

  const filteredSecrets = useMemo(() => {
    const q = search.trim().toLowerCase()
    const merged = secrets.map((s) => ({
      ...s,
      summaryScore: summaryById.get(s.id)?.score ?? null,
      summaryReach: summaryById.get(s.id)?.reachable_count ?? null,
    }))
    // surface summary-only entries too (defensive) using secret list as source of truth
    const filtered = q
      ? merged.filter(
          (s) =>
            s.name?.toLowerCase().includes(q) ||
            s.type?.toLowerCase().includes(q) ||
            s.environment?.toLowerCase().includes(q),
        )
      : merged
    return filtered.sort((a, b) => (b.summaryScore ?? -1) - (a.summaryScore ?? -1))
  }, [secrets, search, summaryById])

  const selectedSecret = secrets.find((s) => s.id === selectedId) ?? null

  if (loading) return <PageSpinner label="Loading blast radius explorer..." />

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState
          title="Could not load data"
          description={error}
          action={
            <Button onClick={() => location.reload()} variant="secondary">
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  const hasSecrets = secrets.length > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Blast Radius Explorer</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Pick a secret to see everything it can reach, the attack paths, and which crown jewels are at risk.
        </p>
      </div>

      {!hasSecrets ? (
        <EmptyState
          title="No secrets yet"
          description="Register secrets and grant edges to model reachability, then return here to explore the blast radius."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Secret picker */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Secrets ({filteredSecrets.length})</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search secrets..."
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-red-700 focus:outline-none"
              />
              <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
                {filteredSecrets.map((s) => {
                  const active = s.id === selectedId
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-red-800 bg-red-950/30'
                          : 'border-transparent bg-zinc-950/40 hover:border-zinc-800 hover:bg-zinc-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-zinc-100">{s.name}</span>
                        {s.summaryScore != null && (
                          <Badge tone={scoreTone(s.summaryScore)}>{Math.round(s.summaryScore)}</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-zinc-500">
                        {s.type && <span>{s.type}</span>}
                        {s.environment && <span>· {s.environment}</span>}
                        {s.summaryReach != null && <span>· {s.summaryReach} reachable</span>}
                      </div>
                    </button>
                  )
                })}
                {filteredSecrets.length === 0 && (
                  <p className="px-1 py-4 text-center text-sm text-zinc-600">No secrets match your search.</p>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Detail panel */}
          <div className="space-y-6">
            {radiusLoading ? (
              <div className="flex min-h-[40vh] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40">
                <Spinner label="Computing reachability..." />
              </div>
            ) : radiusError ? (
              <EmptyState
                title="Could not compute blast radius"
                description={radiusError}
                action={
                  <Button variant="secondary" onClick={() => setSelectedId((id) => (id ? `${id}` : id))}>
                    Retry
                  </Button>
                }
              />
            ) : radius && selectedSecret ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-zinc-100">{selectedSecret.name}</h2>
                  {selectedSecret.type && <Badge tone="zinc">{selectedSecret.type}</Badge>}
                  {selectedSecret.environment && <Badge tone="blue">{selectedSecret.environment}</Badge>}
                  {selectedSecret.criticality && (
                    <Badge tone={severityTone(selectedSecret.criticality)}>{selectedSecret.criticality}</Badge>
                  )}
                  {selectedSecret.status && (
                    <Badge tone={severityTone(selectedSecret.status)}>{selectedSecret.status}</Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat
                    label="Blast Score"
                    value={Math.round(radius.score)}
                    tone={scoreTone(radius.score)}
                    hint="0-100 reachability weight"
                  />
                  <Stat label="Reachable" value={radius.reachable_count} hint="resources in scope" />
                  <Stat
                    label="Crown Jewels"
                    value={radius.crown_jewel_count}
                    tone={radius.crown_jewel_count > 0 ? 'red' : 'green'}
                    hint="high-sensitivity hits"
                  />
                  <Stat label="Max Depth" value={radius.max_depth} hint="longest path hops" />
                </div>

                <BlastGraph nodes={radius.graph.nodes} edges={radius.graph.edges} rootName={selectedSecret.name} />

                <Card>
                  <CardHeader>
                    <CardTitle>Reachable Resources & Paths ({radius.reachable_resources.length})</CardTitle>
                  </CardHeader>
                  <CardBody className="p-0">
                    {radius.reachable_resources.length === 0 ? (
                      <div className="px-5 py-10 text-center text-sm text-zinc-500">
                        This secret cannot reach any resources. Add grant edges to model access.
                      </div>
                    ) : (
                      <Table>
                        <THead>
                          <TR>
                            <TH>Resource</TH>
                            <TH>Type</TH>
                            <TH>Sensitivity</TH>
                            <TH>Depth</TH>
                            <TH>Path</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {radius.reachable_resources.map((r, i) => (
                            <TR key={r.id ?? i}>
                              <TD>
                                <span className="flex items-center gap-2">
                                  {(r.crown_jewel || r.sensitivity?.toLowerCase() === 'critical') && (
                                    <span title="Crown jewel" className="text-amber-400">
                                      ◆
                                    </span>
                                  )}
                                  <span className="font-medium text-zinc-100">{r.name ?? r.id}</span>
                                </span>
                              </TD>
                              <TD>{r.type ?? '—'}</TD>
                              <TD>
                                {r.sensitivity ? (
                                  <Badge tone={severityTone(r.sensitivity)}>{r.sensitivity}</Badge>
                                ) : (
                                  '—'
                                )}
                              </TD>
                              <TD className="tabular-nums">{r.depth ?? '—'}</TD>
                              <TD>
                                <PathTrail path={r.path} fallbackName={r.name ?? r.id} rootName={selectedSecret.name} />
                              </TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    )}
                  </CardBody>
                </Card>
              </>
            ) : (
              <EmptyState title="Select a secret" description="Choose a secret on the left to compute its blast radius." />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PathTrail({
  path,
  fallbackName,
  rootName,
}: {
  path?: Array<{ id: string; name?: string }> | string[]
  fallbackName: string
  rootName: string
}) {
  let labels: string[]
  if (!path || path.length === 0) {
    labels = [rootName, fallbackName]
  } else if (typeof path[0] === 'string') {
    labels = path as string[]
  } else {
    labels = (path as Array<{ id: string; name?: string }>).map((p) => p.name ?? p.id)
  }
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs text-zinc-400">
      {labels.map((label, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-zinc-600">→</span>}
          <span className={i === 0 ? 'text-red-400' : ''}>{label}</span>
        </span>
      ))}
    </span>
  )
}

function BlastGraph({
  nodes,
  edges,
  rootName,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  rootName: string
}) {
  // Group nodes into depth columns for a simple layered SVG layout.
  const layout = useMemo(() => {
    if (nodes.length === 0) return null
    const byDepth = new Map<number, GraphNode[]>()
    for (const n of nodes) {
      const d = n.depth ?? 0
      if (!byDepth.has(d)) byDepth.set(d, [])
      byDepth.get(d)!.push(n)
    }
    const depths = [...byDepth.keys()].sort((a, b) => a - b)
    const colGap = 220
    const rowGap = 64
    const width = Math.max(640, depths.length * colGap + 80)
    const maxRows = Math.max(...depths.map((d) => byDepth.get(d)!.length), 1)
    const height = Math.max(220, maxRows * rowGap + 40)
    const pos = new Map<string, { x: number; y: number; node: GraphNode }>()
    depths.forEach((d, ci) => {
      const col = byDepth.get(d)!
      col.forEach((n, ri) => {
        const x = 60 + ci * colGap
        const y = (height / (col.length + 1)) * (ri + 1)
        pos.set(n.id, { x, y, node: n })
      })
    })
    return { pos, width, height, depths }
  }, [nodes])

  if (!layout) {
    return null
  }

  const edgeKey = (e: GraphEdge) => `${e.from ?? e.source}->${e.to ?? e.target}`

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Reachability Graph</CardTitle>
        <span className="text-xs text-zinc-500">
          {nodes.length} nodes · {edges.length} edges
        </span>
      </CardHeader>
      <CardBody className="overflow-x-auto">
        <svg width={layout.width} height={layout.height} className="min-w-full">
          {edges.map((e, i) => {
            const from = layout.pos.get(e.from ?? e.source ?? '')
            const to = layout.pos.get(e.to ?? e.target ?? '')
            if (!from || !to) return null
            return (
              <g key={edgeKey(e) + i}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="#dc2626"
                  strokeOpacity={0.35}
                  strokeWidth={1.5}
                />
              </g>
            )
          })}
          {[...layout.pos.values()].map(({ x, y, node }) => {
            const isRoot = (node.depth ?? 0) === 0
            const isCrown = node.crown_jewel || node.sensitivity?.toLowerCase() === 'critical'
            const fill = isRoot ? '#7f1d1d' : isCrown ? '#78350f' : '#27272a'
            const stroke = isRoot ? '#ef4444' : isCrown ? '#f59e0b' : '#3f3f46'
            return (
              <g key={node.id}>
                <circle cx={x} cy={y} r={isRoot ? 11 : 8} fill={fill} stroke={stroke} strokeWidth={1.5} />
                <text x={x + 14} y={y + 4} fontSize={11} fill="#a1a1aa">
                  {(isRoot ? rootName : node.label ?? node.name ?? node.id).slice(0, 22)}
                </text>
              </g>
            )
          })}
        </svg>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-900 ring-1 ring-red-500" /> Secret (root)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-900 ring-1 ring-amber-500" /> Crown jewel
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-800 ring-1 ring-zinc-600" /> Resource
          </span>
        </div>
      </CardBody>
    </Card>
  )
}
