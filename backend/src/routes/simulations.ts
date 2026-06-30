import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  simulations,
  secrets,
  resources,
  grant_edges,
  secret_copies,
  audit_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const SENSITIVITY_WEIGHT: Record<string, number> = {
  public: 1,
  internal: 2,
  confidential: 4,
  pii: 6,
  crown_jewel: 10,
}

// Practice runbook templates — ordered task lists per scenario template.
const TEMPLATES: Record<string, { label: string; tasks: Array<{ kind: string; description: string }> }> = {
  db_password_leak: {
    label: 'Database password leak',
    tasks: [
      { kind: 'rotate', description: 'Rotate the leaked database password in the primary store' },
      { kind: 'revoke', description: 'Revoke active database sessions using the old credential' },
      { kind: 'rotate', description: 'Propagate the new credential to all copies (CI, env files, k8s secrets)' },
      { kind: 'verify', description: 'Verify no service is still using the old credential' },
      { kind: 'notify', description: 'Notify resource owners and on-call of the rotation window' },
    ],
  },
  ci_token_leak: {
    label: 'CI token leak',
    tasks: [
      { kind: 'revoke', description: 'Revoke the exposed CI token immediately' },
      { kind: 'rotate', description: 'Issue a replacement CI token with least-privilege scope' },
      { kind: 'rotate', description: 'Update CI variables and pipeline secrets with the new token' },
      { kind: 'verify', description: 'Audit recent pipeline runs for unauthorized use' },
      { kind: 'notify', description: 'Notify the platform team and affected service owners' },
    ],
  },
  third_party_breach: {
    label: 'Third-party breach',
    tasks: [
      { kind: 'rotate', description: 'Rotate all credentials shared with the breached vendor' },
      { kind: 'revoke', description: 'Revoke OAuth grants and API keys issued to the vendor' },
      { kind: 'verify', description: 'Confirm reuse clusters do not extend the breach to other secrets' },
      { kind: 'notify', description: 'Notify owners and document the vendor exposure for the renewal file' },
    ],
  },
  custom: {
    label: 'Custom tabletop',
    tasks: [
      { kind: 'rotate', description: 'Rotate the affected secret' },
      { kind: 'revoke', description: 'Revoke downstream access granted by the secret' },
      { kind: 'verify', description: 'Verify containment across all reachable resources' },
      { kind: 'notify', description: 'Notify stakeholders' },
    ],
  },
}

// Sandbox blast-radius BFS: secret -> resources via grant_edges, transitive via
// resources.contains_secret_id (a resource that itself holds another secret).
function computeSandboxRadius(
  secretId: string,
  grants: Array<typeof grant_edges.$inferSelect>,
  resourceRows: Array<typeof resources.$inferSelect>,
) {
  const resourceById = new Map(resourceRows.map((r) => [r.id, r]))
  // secret_id -> resource_ids it grants
  const grantsBySecret = new Map<string, Array<typeof grant_edges.$inferSelect>>()
  for (const g of grants) {
    const arr = grantsBySecret.get(g.secret_id) ?? []
    arr.push(g)
    grantsBySecret.set(g.secret_id, arr)
  }

  const reachable: Array<{
    resource_id: string
    name: string
    sensitivity: string
    depth: number
    path: string[]
  }> = []
  const nodes = new Map<string, { id: string; label: string; kind: string }>()
  const edges: Array<{ from: string; to: string; permission: string }> = []

  nodes.set(secretId, { id: secretId, label: secretId, kind: 'secret' })

  const visitedResources = new Set<string>()
  const visitedSecrets = new Set<string>([secretId])
  // queue of secrets to expand, carrying the path that reached them
  const queue: Array<{ secretId: string; depth: number; path: string[] }> = [
    { secretId, depth: 0, path: [secretId] },
  ]

  while (queue.length > 0) {
    const { secretId: sid, depth, path } = queue.shift()!
    const out = grantsBySecret.get(sid) ?? []
    for (const g of out) {
      const res = resourceById.get(g.resource_id)
      if (!res) continue
      nodes.set(res.id, { id: res.id, label: res.name, kind: 'resource' })
      edges.push({ from: sid, to: res.id, permission: g.permission })

      if (!visitedResources.has(res.id)) {
        visitedResources.add(res.id)
        const newPath = [...path, res.id]
        reachable.push({
          resource_id: res.id,
          name: res.name,
          sensitivity: res.sensitivity,
          depth: depth + 1,
          path: newPath,
        })
        // Transitive: this resource itself holds another secret.
        if (res.contains_secret_id && !visitedSecrets.has(res.contains_secret_id)) {
          visitedSecrets.add(res.contains_secret_id)
          nodes.set(res.contains_secret_id, {
            id: res.contains_secret_id,
            label: res.contains_secret_id,
            kind: 'secret',
          })
          edges.push({ from: res.id, to: res.contains_secret_id, permission: 'contains' })
          queue.push({ secretId: res.contains_secret_id, depth: depth + 1, path: newPath })
        }
      }
    }
  }

  const crownJewels = reachable.filter((r) => r.sensitivity === 'crown_jewel').length
  const maxDepth = reachable.reduce((m, r) => Math.max(m, r.depth), 0)
  const score = Number(
    reachable
      .reduce((sum, r) => sum + (SENSITIVITY_WEIGHT[r.sensitivity] ?? 1) / r.depth, 0)
      .toFixed(2),
  )

  return {
    score,
    reachable_count: reachable.length,
    crown_jewel_count: crownJewels,
    max_depth: maxDepth,
    reachable_resources: reachable,
    graph: { nodes: [...nodes.values()], edges },
  }
}

// ---------------------------------------------------------------------------
// GET / — list simulations
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const status = c.req.query('status')
  const conds = [eq(simulations.user_id, userId)]
  if (status) conds.push(eq(simulations.status, status))
  const rows = await db
    .select()
    .from(simulations)
    .where(and(...conds))
    .orderBy(desc(simulations.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — simulation detail/result
// ---------------------------------------------------------------------------
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [sim] = await db.select().from(simulations).where(eq(simulations.id, id))
  if (!sim) return c.json({ error: 'Not found' }, 404)
  if (sim.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  return c.json(sim)
})

// ---------------------------------------------------------------------------
// POST / — run a tabletop simulation (sandbox blast radius + practice runbook from template)
// ---------------------------------------------------------------------------
const runSchema = z.object({
  secret_id: z.string().optional(),
  template: z.enum(['db_password_leak', 'ci_token_leak', 'third_party_breach', 'custom']),
})

router.post('/', authMiddleware, zValidator('json', runSchema), async (c) => {
  const userId = getUserId(c)
  const { secret_id, template } = c.req.valid('json')

  let targetSecret: typeof secrets.$inferSelect | undefined
  if (secret_id) {
    const [s] = await db.select().from(secrets).where(eq(secrets.id, secret_id))
    if (!s) return c.json({ error: 'Secret not found' }, 404)
    if (s.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
    targetSecret = s
  }

  const tpl = TEMPLATES[template] ?? TEMPLATES.custom

  // Sandbox blast radius over the caller's real graph (read-only, persisted only in result).
  let radius = {
    score: 0,
    reachable_count: 0,
    crown_jewel_count: 0,
    max_depth: 0,
    reachable_resources: [] as Array<{
      resource_id: string
      name: string
      sensitivity: string
      depth: number
      path: string[]
    }>,
    graph: { nodes: [] as Array<{ id: string; label: string; kind: string }>, edges: [] as Array<{ from: string; to: string; permission: string }> },
  }

  if (targetSecret) {
    const grants = await db.select().from(grant_edges).where(eq(grant_edges.user_id, userId))
    const resourceRows = await db.select().from(resources).where(eq(resources.user_id, userId))
    radius = computeSandboxRadius(targetSecret.id, grants, resourceRows)
  }

  // Copy-spread context for the practice runbook.
  let copyCount = 0
  if (targetSecret) {
    const copies = await db
      .select()
      .from(secret_copies)
      .where(eq(secret_copies.secret_id, targetSecret.id))
    copyCount = copies.length
  }

  const practiceTasks = tpl.tasks.map((t, idx) => ({
    step: idx + 1,
    kind: t.kind,
    description: t.description,
    status: 'pending' as const,
  }))

  const result = {
    template,
    template_label: tpl.label,
    secret: targetSecret
      ? { id: targetSecret.id, name: targetSecret.name, type: targetSecret.type }
      : null,
    sandbox_blast_radius: radius,
    copy_spread: copyCount,
    practice_runbook: practiceTasks,
    started_at: new Date().toISOString(),
  }

  const [sim] = await db
    .insert(simulations)
    .values({
      user_id: userId,
      secret_id: targetSecret?.id ?? null,
      template,
      status: 'running',
      blast_radius_score: radius.score,
      time_to_contain_minutes: null,
      tasks_completed: 0,
      total_tasks: practiceTasks.length,
      score: 0,
      result,
    })
    .returning()

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'run',
    entity_type: 'simulation',
    entity_id: sim.id,
    detail: { template, secret_id: targetSecret?.id ?? null },
  })

  return c.json(sim, 201)
})

// ---------------------------------------------------------------------------
// POST /:id/score — score the run (time-to-contain, tasks completed)
// ---------------------------------------------------------------------------
const scoreSchema = z.object({
  time_to_contain_minutes: z.number().int().nonnegative(),
  tasks_completed: z.number().int().nonnegative(),
})

router.post('/:id/score', authMiddleware, zValidator('json', scoreSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { time_to_contain_minutes, tasks_completed } = c.req.valid('json')

  const [sim] = await db.select().from(simulations).where(eq(simulations.id, id))
  if (!sim) return c.json({ error: 'Not found' }, 404)
  if (sim.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const total = sim.total_tasks ?? 0
  const completed = Math.min(tasks_completed, total || tasks_completed)

  // Score: completion ratio (0-70) + speed bonus (0-30, decaying with MTTC).
  const completionRatio = total > 0 ? completed / total : 0
  const completionPoints = completionRatio * 70
  // Speed: 30 points if contained within 60 min, decaying to 0 by 24h.
  const speedPoints = Math.max(0, 30 * (1 - Math.min(time_to_contain_minutes, 1440) / 1440))
  const finalScore = Number((completionPoints + speedPoints).toFixed(2))

  const result = {
    ...(sim.result as Record<string, unknown>),
    scored_at: new Date().toISOString(),
    completion_ratio: Number(completionRatio.toFixed(3)),
    completion_points: Number(completionPoints.toFixed(2)),
    speed_points: Number(speedPoints.toFixed(2)),
  }

  const [updated] = await db
    .update(simulations)
    .set({
      status: 'scored',
      time_to_contain_minutes,
      tasks_completed: completed,
      score: finalScore,
      result,
    })
    .where(eq(simulations.id, id))
    .returning()

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'score',
    entity_type: 'simulation',
    entity_id: id,
    detail: { score: finalScore, time_to_contain_minutes, tasks_completed: completed },
  })

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete simulation
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [sim] = await db.select().from(simulations).where(eq(simulations.id, id))
  if (!sim) return c.json({ error: 'Not found' }, 404)
  if (sim.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(simulations).where(eq(simulations.id, id))

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'delete',
    entity_type: 'simulation',
    entity_id: id,
    detail: {},
  })

  return c.json({ success: true })
})

export default router
