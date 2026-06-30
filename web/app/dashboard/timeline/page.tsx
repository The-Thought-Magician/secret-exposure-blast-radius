'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, severityTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

type Json = Record<string, any>

function fmt(ts?: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts)
  return d.toLocaleString()
}

export default function TimelinePage() {
  const [exposures, setExposures] = useState<Json[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [events, setEvents] = useState<Json[]>([])

  const [loading, setLoading] = useState(true)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [onlyAnomalous, setOnlyAnomalous] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [evKind, setEvKind] = useState('manual_note')
  const [evDesc, setEvDesc] = useState('')
  const [evWhen, setEvWhen] = useState('')
  const [evAnom, setEvAnom] = useState(false)

  const loadExposures = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getExposures()
      const list: Json[] = Array.isArray(res) ? res : res?.exposures ?? []
      setExposures(list)
      if (list.length > 0) {
        setSelectedId((cur) => cur ?? list[0].id)
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load exposures')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadExposures()
  }, [loadExposures])

  const loadEvents = useCallback(async (exposureId: string) => {
    setLoadingEvents(true)
    setEventsError(null)
    try {
      const res = await api.getTimeline(exposureId)
      const list: Json[] = Array.isArray(res) ? res : res?.events ?? []
      setEvents(list)
    } catch (e: any) {
      setEventsError(e?.message ?? 'Failed to load timeline')
      setEvents([])
    } finally {
      setLoadingEvents(false)
    }
  }, [])

  useEffect(() => {
    if (selectedId) void loadEvents(selectedId)
  }, [selectedId, loadEvents])

  const selected = useMemo(() => exposures.find((e) => e.id === selectedId) ?? null, [exposures, selectedId])

  const sortedEvents = useMemo(() => {
    const arr = [...events]
    arr.sort((a, b) => {
      const ta = new Date(a.occurred_at ?? a.created_at ?? 0).getTime()
      const tb = new Date(b.occurred_at ?? b.created_at ?? 0).getTime()
      return ta - tb
    })
    return onlyAnomalous ? arr.filter((e) => e.anomalous) : arr
  }, [events, onlyAnomalous])

  const anomalyCount = useMemo(() => events.filter((e) => e.anomalous).length, [events])

  const reconstruct = async () => {
    if (!selectedId) return
    setBusy('reconstruct')
    setNotice(null)
    setEventsError(null)
    try {
      await api.reconstructTimeline(selectedId)
      setNotice('Timeline reconstructed from access logs')
      await loadEvents(selectedId)
    } catch (e: any) {
      setEventsError(e?.message ?? 'Reconstruct failed')
    } finally {
      setBusy(null)
    }
  }

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedId) return
    setBusy('add')
    setEventsError(null)
    try {
      const body: Json = { kind: evKind, description: evDesc, anomalous: evAnom }
      if (evWhen) body.occurred_at = new Date(evWhen).toISOString()
      await api.addTimelineEvent(selectedId, body)
      setNotice('Timeline event added')
      setAddOpen(false)
      setEvDesc('')
      setEvWhen('')
      setEvAnom(false)
      setEvKind('manual_note')
      await loadEvents(selectedId)
    } catch (e: any) {
      setEventsError(e?.message ?? 'Failed to add event')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <PageSpinner label="Loading timeline..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState title="Could not load exposures" description={error} icon="⚠" action={<Button onClick={() => void loadExposures()}>Retry</Button>} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-5">
        <h1 className="text-xl font-bold text-zinc-100">Timeline Reconstruction</h1>
        <p className="mt-1 text-sm text-zinc-500">Replay access activity within each exposure window and flag anomalous access.</p>
      </div>

      {notice && <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300">{notice}</div>}

      {exposures.length === 0 ? (
        <EmptyState
          title="No exposures yet"
          description="Declare an exposure to begin reconstructing its timeline."
          icon="🕵"
          action={<Link href="/dashboard/exposures/new"><Button>Declare exposure</Button></Link>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Exposure selector */}
          <Card className="lg:col-span-1">
            <CardHeader><CardTitle>Exposures</CardTitle></CardHeader>
            <CardBody className="space-y-1 p-2">
              {exposures.map((ex) => {
                const active = ex.id === selectedId
                return (
                  <button
                    key={ex.id}
                    onClick={() => setSelectedId(ex.id)}
                    className={`flex w-full flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                      active ? 'border-red-900/60 bg-red-950/30' : 'border-transparent hover:bg-zinc-800/60'
                    }`}
                  >
                    <span className="text-sm font-medium text-zinc-200">{ex.title ?? 'Untitled'}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={severityTone(ex.severity)}>{ex.severity ?? '—'}</Badge>
                      <Badge tone={severityTone(ex.status)}>{ex.status ?? '—'}</Badge>
                    </span>
                  </button>
                )
              })}
            </CardBody>
          </Card>

          {/* Timeline panel */}
          <div className="space-y-6 lg:col-span-2">
            {selected && (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="Events" value={events.length} />
                  <Stat label="Anomalies" value={anomalyCount} tone={anomalyCount > 0 ? 'red' : 'green'} />
                  <Stat label="Exposed since" value={<span className="text-sm">{fmt(selected.exposed_since)}</span>} />
                  <Stat label="Detected" value={<span className="text-sm">{fmt(selected.detected_at)}</span>} />
                </div>

                <Card>
                  <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle>
                      <Link href={`/dashboard/exposures/${selected.id}`} className="hover:text-red-300">{selected.title ?? 'Timeline'}</Link>
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                        <input type="checkbox" checked={onlyAnomalous} onChange={(e) => setOnlyAnomalous(e.target.checked)} className="accent-red-500" />
                        Anomalous only
                      </label>
                      <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>Add event</Button>
                      <Button size="sm" onClick={reconstruct} disabled={busy === 'reconstruct'}>
                        {busy === 'reconstruct' ? <Spinner /> : 'Reconstruct'}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardBody>
                    {eventsError && <div className="mb-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{eventsError}</div>}
                    {loadingEvents ? (
                      <div className="py-8"><Spinner label="Loading events..." /></div>
                    ) : sortedEvents.length === 0 ? (
                      <EmptyState
                        title={onlyAnomalous ? 'No anomalous events' : 'No timeline events'}
                        description={onlyAnomalous ? 'No access in this window was flagged anomalous.' : 'Reconstruct to pull access logs into a timeline.'}
                      />
                    ) : (
                      <ol className="relative space-y-4 border-l border-zinc-800 pl-5">
                        {sortedEvents.map((ev, i) => (
                          <li key={ev.id ?? i} className="relative">
                            <span className={`absolute -left-[1.42rem] top-1 h-2.5 w-2.5 rounded-full ${ev.anomalous ? 'bg-red-500 ring-2 ring-red-900/60' : 'bg-zinc-600'}`} />
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-zinc-200">{ev.kind ?? 'event'}</span>
                              {ev.anomalous && <Badge tone="red">anomalous</Badge>}
                              <span className="text-xs text-zinc-500">{fmt(ev.occurred_at ?? ev.created_at)}</span>
                            </div>
                            {ev.description && <p className="mt-0.5 text-sm text-zinc-400">{ev.description}</p>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </CardBody>
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add timeline event"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={submitAdd} disabled={busy === 'add'}>{busy === 'add' ? <Spinner /> : 'Add event'}</Button>
          </>
        }
      >
        <form onSubmit={submitAdd} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Kind</label>
            <input
              value={evKind}
              onChange={(e) => setEvKind(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
              placeholder="e.g. manual_note, access, rotation"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Description</label>
            <textarea
              value={evDesc}
              onChange={(e) => setEvDesc(e.target.value)}
              rows={3}
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
              placeholder="What happened..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Occurred at</label>
            <input
              type="datetime-local"
              value={evWhen}
              onChange={(e) => setEvWhen(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={evAnom} onChange={(e) => setEvAnom(e.target.checked)} className="accent-red-500" />
            Flag as anomalous
          </label>
        </form>
      </Modal>
    </div>
  )
}
