import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  timeline_events,
  exposures,
  access_logs,
  blast_radius_snapshots,
  resources,
  audit_log,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET /:exposureId — chronological timeline events for an exposure
// ---------------------------------------------------------------------------
router.get('/:exposureId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const exposureId = c.req.param('exposureId')
  const [exposure] = await db
    .select()
    .from(exposures)
    .where(and(eq(exposures.id, exposureId), eq(exposures.user_id, userId)))
  if (!exposure) return c.json({ error: 'Not found' }, 404)

  const events = await db
    .select()
    .from(timeline_events)
    .where(and(eq(timeline_events.exposure_id, exposureId), eq(timeline_events.user_id, userId)))
    .orderBy(timeline_events.occurred_at)
  return c.json(events)
})

// ---------------------------------------------------------------------------
// POST /:exposureId/reconstruct — pull access_logs between exposed_since and
// detected_at per reachable resource, create possible/anomalous-access events.
// ---------------------------------------------------------------------------
router.post('/:exposureId/reconstruct', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const exposureId = c.req.param('exposureId')
  const [exposure] = await db.select().from(exposures).where(eq(exposures.id, exposureId))
  if (!exposure) return c.json({ error: 'Not found' }, 404)
  if (exposure.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const windowStart = exposure.exposed_since ?? exposure.detected_at
  const windowEnd = exposure.detected_at

  // Reachable resources come from the latest snapshot.
  const [snapshot] = await db
    .select()
    .from(blast_radius_snapshots)
    .where(and(eq(blast_radius_snapshots.exposure_id, exposureId), eq(blast_radius_snapshots.user_id, userId)))
    .orderBy(blast_radius_snapshots.created_at)
  const reachable = snapshot?.reachable_resources ?? []
  const reachableIds = new Set(reachable.map((r) => r.resource_id))

  const resourceById = new Map(
    (await db.select().from(resources).where(eq(resources.user_id, userId))).map((r) => [r.id, r]),
  )

  // Pull all access logs for the user, filter to the window + reachable set.
  const logs = await db.select().from(access_logs).where(eq(access_logs.user_id, userId))

  const startMs = windowStart ? new Date(windowStart).getTime() : Number.NEGATIVE_INFINITY
  const endMs = new Date(windowEnd).getTime()

  // Per-resource baseline: which principals were seen across the whole history.
  const principalsByResource = new Map<string, Map<string, number>>()
  for (const log of logs) {
    if (!log.resource_id) continue
    let m = principalsByResource.get(log.resource_id)
    if (!m) {
      m = new Map()
      principalsByResource.set(log.resource_id, m)
    }
    m.set(log.principal, (m.get(log.principal) ?? 0) + 1)
  }

  const inWindow = logs.filter((log) => {
    if (!log.resource_id || !reachableIds.has(log.resource_id)) return false
    const t = new Date(log.occurred_at).getTime()
    return t >= startMs && t <= endMs
  })

  // Clear any previously reconstructed possible/anomalous-access events so the
  // reconstruction is idempotent.
  const existing = await db
    .select()
    .from(timeline_events)
    .where(and(eq(timeline_events.exposure_id, exposureId), eq(timeline_events.user_id, userId)))
  for (const ev of existing) {
    if (ev.kind === 'possible_access' || ev.kind === 'anomalous_access') {
      await db.delete(timeline_events).where(eq(timeline_events.id, ev.id))
    }
  }

  const created: Array<typeof timeline_events.$inferSelect> = []
  let anomalies = 0
  for (const log of inWindow.sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  )) {
    const res = resourceById.get(log.resource_id!)
    const principalSeen = principalsByResource.get(log.resource_id!)?.get(log.principal) ?? 0
    // Anomalous if the log itself was flagged, or this principal is a rare
    // visitor to this resource (seen only within the window).
    const rare = principalSeen <= inWindow.filter(
      (l) => l.resource_id === log.resource_id && l.principal === log.principal,
    ).length
    const anomalous = log.anomalous || rare
    if (anomalous) anomalies++
    const [ev] = await db
      .insert(timeline_events)
      .values({
        user_id: userId,
        exposure_id: exposureId,
        kind: anomalous ? 'anomalous_access' : 'possible_access',
        description: `${log.principal} ${log.action ?? 'accessed'} ${res?.name ?? 'resource'}${
          log.ip ? ` from ${log.ip}` : ''
        }`,
        resource_id: log.resource_id,
        anomalous,
        occurred_at: new Date(log.occurred_at),
      })
      .returning()
    created.push(ev)
  }

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'reconstruct_timeline',
    entity_type: 'exposure',
    entity_id: exposureId,
    detail: { events: created.length, anomalies },
  })

  return c.json({ events: created, anomalies })
})

// ---------------------------------------------------------------------------
// POST /:exposureId/event — add a manual timeline event
// ---------------------------------------------------------------------------
const eventSchema = z.object({
  kind: z.enum([
    'exposure_start',
    'possible_access',
    'anomalous_access',
    'detection',
    'rotation_start',
    'rotation_complete',
    'containment',
  ]),
  description: z.string().min(1),
  resource_id: z.string().optional(),
  anomalous: z.boolean().optional().default(false),
  occurred_at: z.string().datetime().optional(),
})

router.post('/:exposureId/event', authMiddleware, zValidator('json', eventSchema), async (c) => {
  const userId = getUserId(c)
  const exposureId = c.req.param('exposureId')
  const [exposure] = await db.select().from(exposures).where(eq(exposures.id, exposureId))
  if (!exposure) return c.json({ error: 'Not found' }, 404)
  if (exposure.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  if (body.resource_id) {
    const [res] = await db
      .select()
      .from(resources)
      .where(and(eq(resources.id, body.resource_id), eq(resources.user_id, userId)))
    if (!res) return c.json({ error: 'Resource not found' }, 404)
  }

  const [ev] = await db
    .insert(timeline_events)
    .values({
      user_id: userId,
      exposure_id: exposureId,
      kind: body.kind,
      description: body.description,
      resource_id: body.resource_id ?? null,
      anomalous: body.anomalous ?? false,
      occurred_at: body.occurred_at ? new Date(body.occurred_at) : new Date(),
    })
    .returning()

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'add_timeline_event',
    entity_type: 'exposure',
    entity_id: exposureId,
    detail: { kind: body.kind },
  })

  return c.json(ev, 201)
})

export default router
