import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  exposures,
  secrets,
  resources,
  grant_edges,
  blast_radius_snapshots,
  runbooks,
  runbook_tasks,
  timeline_events,
  evidence_records,
  secret_copies,
  notifications,
  audit_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Blast-radius computation — BFS from a secret over grant_edges, following
// transitive `contains_secret_id` chains (a reachable resource that itself
// holds another secret extends reachability to whatever that secret grants).
// ---------------------------------------------------------------------------
interface ReachableResource {
  resource_id: string
  name: string
  sensitivity: string
  depth: number
  path: string[]
}
interface RadiusGraph {
  nodes: Array<{ id: string; label: string; kind: string }>
  edges: Array<{ from: string; to: string; permission: string }>
}
interface RadiusResult {
  score: number
  reachable_count: number
  crown_jewel_count: number
  max_depth: number
  reachable_resources: ReachableResource[]
  graph: RadiusGraph
}

const SENSITIVITY_WEIGHT: Record<string, number> = {
  public: 1,
  internal: 2,
  confidential: 4,
  pii: 6,
  crown_jewel: 10,
}

async function computeBlastRadius(userId: string, rootSecretId: string): Promise<RadiusResult> {
  const allGrants = await db.select().from(grant_edges).where(eq(grant_edges.user_id, userId))
  const allResources = await db.select().from(resources).where(eq(resources.user_id, userId))
  const allSecrets = await db.select().from(secrets).where(eq(secrets.user_id, userId))

  const resourceById = new Map(allResources.map((r) => [r.id, r]))
  const secretById = new Map(allSecrets.map((s) => [s.id, s]))

  // secret_id -> grant edges originating from it
  const grantsBySecret = new Map<string, typeof allGrants>()
  for (const g of allGrants) {
    const arr = grantsBySecret.get(g.secret_id) ?? []
    arr.push(g)
    grantsBySecret.set(g.secret_id, arr)
  }

  const reachable = new Map<string, ReachableResource>()
  const nodes = new Map<string, { id: string; label: string; kind: string }>()
  const edges: RadiusGraph['edges'] = []

  const rootSecret = secretById.get(rootSecretId)
  nodes.set(`secret:${rootSecretId}`, {
    id: `secret:${rootSecretId}`,
    label: rootSecret?.name ?? 'secret',
    kind: 'secret',
  })

  // BFS over (secretId, path-of-resource-names, depth)
  const visitedSecrets = new Set<string>()
  type Frame = { secretId: string; path: string[]; depth: number }
  const queue: Frame[] = [{ secretId: rootSecretId, path: [], depth: 0 }]

  while (queue.length > 0) {
    const { secretId, path, depth } = queue.shift()!
    if (visitedSecrets.has(secretId)) continue
    visitedSecrets.add(secretId)

    const outgoing = grantsBySecret.get(secretId) ?? []
    for (const g of outgoing) {
      const res = resourceById.get(g.resource_id)
      if (!res) continue
      const newDepth = depth + 1
      const newPath = [...path, res.name]

      nodes.set(`resource:${res.id}`, {
        id: `resource:${res.id}`,
        label: res.name,
        kind: res.sensitivity === 'crown_jewel' ? 'crown_jewel' : 'resource',
      })
      edges.push({ from: `secret:${secretId}`, to: `resource:${res.id}`, permission: g.permission })

      const existing = reachable.get(res.id)
      if (!existing || newDepth < existing.depth) {
        reachable.set(res.id, {
          resource_id: res.id,
          name: res.name,
          sensitivity: res.sensitivity,
          depth: newDepth,
          path: newPath,
        })
      }

      // Transitive chain: resource holds another secret.
      if (res.contains_secret_id && !visitedSecrets.has(res.contains_secret_id)) {
        const chained = secretById.get(res.contains_secret_id)
        if (chained) {
          nodes.set(`secret:${chained.id}`, {
            id: `secret:${chained.id}`,
            label: chained.name,
            kind: 'secret',
          })
          edges.push({ from: `resource:${res.id}`, to: `secret:${chained.id}`, permission: 'contains' })
          queue.push({ secretId: chained.id, path: newPath, depth: newDepth })
        }
      }
    }
  }

  const reachableArr = [...reachable.values()].sort((a, b) => a.depth - b.depth)
  const crownJewels = reachableArr.filter((r) => r.sensitivity === 'crown_jewel').length
  const maxDepth = reachableArr.reduce((m, r) => Math.max(m, r.depth), 0)

  // Score: sum of sensitivity weight discounted by depth, plus reach breadth.
  let score = 0
  for (const r of reachableArr) {
    const weight = SENSITIVITY_WEIGHT[r.sensitivity] ?? 2
    score += weight / r.depth
  }
  score = Math.round(score * 100) / 100

  return {
    score,
    reachable_count: reachableArr.length,
    crown_jewel_count: crownJewels,
    max_depth: maxDepth,
    reachable_resources: reachableArr,
    graph: { nodes: [...nodes.values()], edges },
  }
}

function deriveSeverity(radius: RadiusResult): 'low' | 'medium' | 'high' | 'critical' {
  if (radius.crown_jewel_count > 0 || radius.score >= 30) return 'critical'
  if (radius.score >= 12 || radius.reachable_count >= 6) return 'high'
  if (radius.score >= 4 || radius.reachable_count >= 2) return 'medium'
  return 'low'
}

// ---------------------------------------------------------------------------
// GET / — list caller's exposures (filter by status/severity)
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const status = c.req.query('status')
  const severity = c.req.query('severity')
  const conds = [eq(exposures.user_id, userId)]
  if (status) conds.push(eq(exposures.status, status))
  if (severity) conds.push(eq(exposures.severity, severity))
  const rows = await db
    .select()
    .from(exposures)
    .where(and(...conds))
    .orderBy(desc(exposures.detected_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — exposure detail incl snapshot, runbook, timeline, evidence
// ---------------------------------------------------------------------------
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [exposure] = await db
    .select()
    .from(exposures)
    .where(and(eq(exposures.id, id), eq(exposures.user_id, userId)))
  if (!exposure) return c.json({ error: 'Not found' }, 404)

  const [snapshot] = await db
    .select()
    .from(blast_radius_snapshots)
    .where(and(eq(blast_radius_snapshots.exposure_id, id), eq(blast_radius_snapshots.user_id, userId)))
    .orderBy(desc(blast_radius_snapshots.created_at))

  const [runbook] = await db
    .select()
    .from(runbooks)
    .where(and(eq(runbooks.exposure_id, id), eq(runbooks.user_id, userId)))
    .orderBy(desc(runbooks.created_at))

  let tasks: Array<typeof runbook_tasks.$inferSelect> = []
  if (runbook) {
    tasks = await db
      .select()
      .from(runbook_tasks)
      .where(and(eq(runbook_tasks.runbook_id, runbook.id), eq(runbook_tasks.user_id, userId)))
      .orderBy(runbook_tasks.created_at)
  }

  const timeline = await db
    .select()
    .from(timeline_events)
    .where(and(eq(timeline_events.exposure_id, id), eq(timeline_events.user_id, userId)))
    .orderBy(timeline_events.occurred_at)

  const evidence = await db
    .select()
    .from(evidence_records)
    .where(and(eq(evidence_records.exposure_id, id), eq(evidence_records.user_id, userId)))
    .orderBy(desc(evidence_records.created_at))

  return c.json({
    exposure,
    snapshot: snapshot ?? null,
    runbook: runbook ? { ...runbook, tasks } : null,
    timeline,
    evidence,
  })
})

// ---------------------------------------------------------------------------
// POST / — declare exposure: compute radius, persist snapshot, derive
// severity, auto-generate runbook + tasks + timeline start, notify.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  secret_id: z.string().min(1),
  title: z.string().min(1),
  vector: z.enum(['git_commit', 'log_dump', 'ticket_paste', 'third_party_breach', 'screen_share', 'other']),
  exposed_since: z.string().datetime().optional(),
  notes: z.string().optional(),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [secret] = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, body.secret_id), eq(secrets.user_id, userId)))
  if (!secret) return c.json({ error: 'Secret not found' }, 404)

  const radius = await computeBlastRadius(userId, body.secret_id)
  const severity = deriveSeverity(radius)
  const detectedAt = new Date()
  const exposedSince = body.exposed_since ? new Date(body.exposed_since) : null

  const [exposure] = await db
    .insert(exposures)
    .values({
      user_id: userId,
      secret_id: body.secret_id,
      title: body.title,
      vector: body.vector,
      severity,
      status: 'analyzing',
      exposed_since: exposedSince,
      detected_at: detectedAt,
      blast_radius_score: radius.score,
      notes: body.notes ?? null,
    })
    .returning()

  const [snapshot] = await db
    .insert(blast_radius_snapshots)
    .values({
      user_id: userId,
      exposure_id: exposure.id,
      secret_id: body.secret_id,
      score: radius.score,
      reachable_count: radius.reachable_count,
      crown_jewel_count: radius.crown_jewel_count,
      max_depth: radius.max_depth,
      reachable_resources: radius.reachable_resources,
      graph: radius.graph,
    })
    .returning()

  // Auto-generate runbook.
  const copies = await db
    .select()
    .from(secret_copies)
    .where(and(eq(secret_copies.secret_id, body.secret_id), eq(secret_copies.user_id, userId)))

  const taskRows: Array<typeof runbook_tasks.$inferInsert> = []
  // rotate the secret itself
  taskRows.push({
    user_id: userId,
    runbook_id: '',
    kind: 'rotate',
    description: `Rotate secret "${secret.name}" at its source of truth`,
    status: 'pending',
  })
  // revoke each live copy in a store
  for (const copy of copies) {
    taskRows.push({
      user_id: userId,
      runbook_id: '',
      kind: 'revoke',
      description: `Revoke / replace copy of "${secret.name}" in store`,
      store_id: copy.store_id,
      status: 'pending',
    })
  }
  // verify each reachable resource no longer trusts old credential
  for (const r of radius.reachable_resources) {
    taskRows.push({
      user_id: userId,
      runbook_id: '',
      kind: 'verify',
      description: `Verify resource "${r.name}" rejects the compromised credential`,
      resource_id: r.resource_id,
      status: 'pending',
    })
  }
  // notify owner
  taskRows.push({
    user_id: userId,
    runbook_id: '',
    kind: 'notify',
    description: 'Notify owning service and stakeholders of the exposure',
    status: 'pending',
  })

  const [runbook] = await db
    .insert(runbooks)
    .values({
      user_id: userId,
      exposure_id: exposure.id,
      title: `Containment runbook for ${body.title}`,
      status: 'open',
      total_tasks: taskRows.length,
      verified_tasks: 0,
    })
    .returning()

  const insertedTasks = await db
    .insert(runbook_tasks)
    .values(taskRows.map((t) => ({ ...t, runbook_id: runbook.id })))
    .returning()

  // Timeline start event.
  await db.insert(timeline_events).values({
    user_id: userId,
    exposure_id: exposure.id,
    kind: 'exposure_start',
    description: `Secret "${secret.name}" exposed via ${body.vector}`,
    anomalous: false,
    occurred_at: exposedSince ?? detectedAt,
  })
  await db.insert(timeline_events).values({
    user_id: userId,
    exposure_id: exposure.id,
    kind: 'detection',
    description: `Exposure declared: ${body.title}`,
    anomalous: false,
    occurred_at: detectedAt,
  })

  // Notify.
  await db.insert(notifications).values({
    user_id: userId,
    kind: 'exposure_declared',
    title: `${severity.toUpperCase()} exposure declared`,
    body: `${body.title} — ${radius.reachable_count} reachable resource(s), ${radius.crown_jewel_count} crown jewel(s).`,
    link: `/dashboard/exposures/${exposure.id}`,
    read: false,
  })

  // Audit.
  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'declare_exposure',
    entity_type: 'exposure',
    entity_id: exposure.id,
    detail: { severity, score: radius.score, reachable_count: radius.reachable_count },
  })

  return c.json({ exposure, snapshot, runbook: { ...runbook, tasks: insertedTasks } }, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update status/notes (auth + owner)
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(['detected', 'analyzing', 'contained', 'closed']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  notes: z.string().optional(),
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(exposures).where(eq(exposures.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db.update(exposures).set(body).where(eq(exposures.id, id)).returning()
  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'update_exposure',
    entity_type: 'exposure',
    entity_id: id,
    detail: body as Record<string, unknown>,
  })
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// POST /:id/contain — requires runbook complete, sets contained_at, timeline
// ---------------------------------------------------------------------------
router.post('/:id/contain', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(exposures).where(eq(exposures.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [runbook] = await db
    .select()
    .from(runbooks)
    .where(and(eq(runbooks.exposure_id, id), eq(runbooks.user_id, userId)))
    .orderBy(desc(runbooks.created_at))
  if (!runbook) return c.json({ error: 'No runbook to verify' }, 400)
  if (runbook.status !== 'complete' || runbook.verified_tasks < runbook.total_tasks) {
    return c.json({ error: 'Runbook must be complete before containment' }, 400)
  }

  const containedAt = new Date()
  const [updated] = await db
    .update(exposures)
    .set({ status: 'contained', contained_at: containedAt })
    .where(eq(exposures.id, id))
    .returning()

  await db.insert(timeline_events).values({
    user_id: userId,
    exposure_id: id,
    kind: 'containment',
    description: 'Exposure contained — runbook fully verified',
    anomalous: false,
    occurred_at: containedAt,
  })

  await db.insert(notifications).values({
    user_id: userId,
    kind: 'runbook_complete',
    title: 'Exposure contained',
    body: `${existing.title} is now contained.`,
    link: `/dashboard/exposures/${id}`,
    read: false,
  })

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'contain_exposure',
    entity_type: 'exposure',
    entity_id: id,
    detail: {},
  })

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// POST /:id/close — close exposure, sets closed_at
// ---------------------------------------------------------------------------
router.post('/:id/close', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(exposures).where(eq(exposures.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const closedAt = new Date()
  const [updated] = await db
    .update(exposures)
    .set({ status: 'closed', closed_at: closedAt })
    .where(eq(exposures.id, id))
    .returning()

  await db.insert(timeline_events).values({
    user_id: userId,
    exposure_id: id,
    kind: 'rotation_complete',
    description: 'Exposure closed',
    anomalous: false,
    occurred_at: closedAt,
  })

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'close_exposure',
    entity_type: 'exposure',
    entity_id: id,
    detail: {},
  })

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete exposure + dependent rows (auth + owner)
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(exposures).where(eq(exposures.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Remove dependent rows first to satisfy FK constraints.
  const rbs = await db.select().from(runbooks).where(eq(runbooks.exposure_id, id))
  for (const rb of rbs) {
    await db.delete(runbook_tasks).where(eq(runbook_tasks.runbook_id, rb.id))
  }
  await db.delete(runbooks).where(eq(runbooks.exposure_id, id))
  await db.delete(timeline_events).where(eq(timeline_events.exposure_id, id))
  await db.delete(blast_radius_snapshots).where(eq(blast_radius_snapshots.exposure_id, id))
  await db.delete(evidence_records).where(eq(evidence_records.exposure_id, id))
  await db.delete(exposures).where(eq(exposures.id, id))

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'delete_exposure',
    entity_type: 'exposure',
    entity_id: id,
    detail: {},
  })

  return c.json({ success: true })
})

export default router
