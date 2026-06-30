import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import {
  evidence_records,
  exposures,
  blast_radius_snapshots,
  timeline_events,
  runbooks,
  runbook_tasks,
  secrets,
  secret_copies,
  stores,
  audit_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

function minutesBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000))
}

// ---------------------------------------------------------------------------
// GET / — list evidence records
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const exposureId = c.req.query('exposure_id')
  const conds = [eq(evidence_records.user_id, userId)]
  if (exposureId) conds.push(eq(evidence_records.exposure_id, exposureId))
  const rows = await db
    .select()
    .from(evidence_records)
    .where(and(...conds))
    .orderBy(desc(evidence_records.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — evidence record detail (full payload)
// ---------------------------------------------------------------------------
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [rec] = await db.select().from(evidence_records).where(eq(evidence_records.id, id))
  if (!rec) return c.json({ error: 'Not found' }, 404)
  if (rec.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  return c.json(rec)
})

// ---------------------------------------------------------------------------
// POST /generate/:exposureId — generate signed evidence for a contained/closed exposure
//   bundles: blast radius + timeline + tasks + copy-discovery + MTTC + completeness + content_hash
// ---------------------------------------------------------------------------
router.post('/generate/:exposureId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const exposureId = c.req.param('exposureId')

  const [exposure] = await db.select().from(exposures).where(eq(exposures.id, exposureId))
  if (!exposure) return c.json({ error: 'Exposure not found' }, 404)
  if (exposure.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  if (exposure.status !== 'contained' && exposure.status !== 'closed') {
    return c.json(
      { error: 'Evidence can only be generated for contained or closed exposures' },
      400,
    )
  }

  const [secret] = await db.select().from(secrets).where(eq(secrets.id, exposure.secret_id))

  // 1. Blast radius — latest snapshot for this exposure.
  const [snapshot] = await db
    .select()
    .from(blast_radius_snapshots)
    .where(eq(blast_radius_snapshots.exposure_id, exposureId))
    .orderBy(desc(blast_radius_snapshots.created_at))

  // 2. Timeline — chronological events.
  const timeline = await db
    .select()
    .from(timeline_events)
    .where(eq(timeline_events.exposure_id, exposureId))
    .orderBy(timeline_events.occurred_at)

  const anomalies = timeline.filter((t) => t.anomalous).length

  // 3. Runbook + tasks.
  const [runbook] = await db
    .select()
    .from(runbooks)
    .where(eq(runbooks.exposure_id, exposureId))
    .orderBy(desc(runbooks.created_at))

  let tasks: Array<typeof runbook_tasks.$inferSelect> = []
  if (runbook) {
    tasks = await db
      .select()
      .from(runbook_tasks)
      .where(eq(runbook_tasks.runbook_id, runbook.id))
      .orderBy(runbook_tasks.created_at)
  }
  const verifiedTasks = tasks.filter((t) => t.status === 'verified').length
  const doneTasks = tasks.filter((t) => t.status === 'done' || t.status === 'verified').length

  // 4. Copy-discovery for the exposed secret — all copies + rotation state.
  const copies = await db
    .select()
    .from(secret_copies)
    .where(eq(secret_copies.secret_id, exposure.secret_id))
  const storeRows = await db.select().from(stores).where(eq(stores.user_id, userId))
  const storeNames = new Map(storeRows.map((s) => [s.id, s.name]))
  const copyDetail = copies.map((cp) => ({
    copy_id: cp.id,
    store_id: cp.store_id,
    store_name: storeNames.get(cp.store_id) ?? 'Unknown',
    rotated: cp.rotated,
    last_seen_at: cp.last_seen_at,
  }))
  const unrotatedCopies = copies.filter((cp) => !cp.rotated).length

  // 5. MTTC — minutes from exposed_since (fallback detected_at) to contained_at.
  const mttc = minutesBetween(
    exposure.exposed_since ?? exposure.detected_at,
    exposure.contained_at,
  )

  // 6. Completeness — weighted coverage of evidence components.
  const checks = {
    has_snapshot: !!snapshot,
    has_timeline: timeline.length > 0,
    has_runbook: !!runbook,
    all_tasks_verified: tasks.length > 0 && verifiedTasks === tasks.length,
    all_copies_rotated: copies.length === 0 || unrotatedCopies === 0,
    is_contained: !!exposure.contained_at,
    has_mttc: mttc !== null,
  }
  const checkValues = Object.values(checks)
  const completenessPct = Number(
    ((checkValues.filter(Boolean).length / checkValues.length) * 100).toFixed(2),
  )

  const signedAt = new Date()

  // Build the payload that will be hashed and stored.
  const payload = {
    exposure: {
      id: exposure.id,
      title: exposure.title,
      vector: exposure.vector,
      severity: exposure.severity,
      status: exposure.status,
      exposed_since: exposure.exposed_since,
      detected_at: exposure.detected_at,
      contained_at: exposure.contained_at,
      closed_at: exposure.closed_at,
    },
    secret: secret
      ? {
          id: secret.id,
          name: secret.name,
          type: secret.type,
          environment: secret.environment,
          criticality: secret.criticality,
        }
      : null,
    blast_radius: snapshot
      ? {
          score: snapshot.score,
          reachable_count: snapshot.reachable_count,
          crown_jewel_count: snapshot.crown_jewel_count,
          max_depth: snapshot.max_depth,
          reachable_resources: snapshot.reachable_resources,
          graph: snapshot.graph,
        }
      : null,
    timeline: timeline.map((t) => ({
      kind: t.kind,
      description: t.description,
      resource_id: t.resource_id,
      anomalous: t.anomalous,
      occurred_at: t.occurred_at,
    })),
    timeline_anomalies: anomalies,
    runbook: runbook
      ? {
          id: runbook.id,
          title: runbook.title,
          status: runbook.status,
          total_tasks: runbook.total_tasks,
          verified_tasks: runbook.verified_tasks,
        }
      : null,
    tasks: tasks.map((t) => ({
      kind: t.kind,
      description: t.description,
      status: t.status,
      completed_at: t.completed_at,
      verified_at: t.verified_at,
    })),
    task_summary: { total: tasks.length, done: doneTasks, verified: verifiedTasks },
    copy_discovery: { copies: copyDetail, unrotated: unrotatedCopies, total: copies.length },
    mttc_minutes: mttc,
    completeness_checks: checks,
    completeness_pct: completenessPct,
    signed_at: signedAt.toISOString(),
  }

  // 7. content_hash — deterministic SHA-256 over the canonical JSON payload.
  const canonical = JSON.stringify(payload)
  const contentHash = createHash('sha256').update(canonical).digest('hex')

  const [rec] = await db
    .insert(evidence_records)
    .values({
      user_id: userId,
      exposure_id: exposureId,
      content_hash: contentHash,
      mttc_minutes: mttc,
      completeness_pct: completenessPct,
      payload,
      signed_at: signedAt,
    })
    .returning()

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'generate',
    entity_type: 'evidence_record',
    entity_id: rec.id,
    detail: { exposure_id: exposureId, content_hash: contentHash, completeness_pct: completenessPct },
  })

  return c.json(rec, 201)
})

export default router
