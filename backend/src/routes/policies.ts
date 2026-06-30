import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rotation_policies, audit_log } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const policySchema = z.object({
  name: z.string().min(1),
  applies_to_type: z.string().optional().nullable(),
  applies_to_criticality: z.enum(['low', 'medium', 'high', 'critical']).optional().nullable(),
  max_age_days: z.number().int().positive(),
  grace_days: z.number().int().min(0).optional().default(0),
  escalation_days: z.number().int().min(0).optional().nullable(),
})

// ---------------------------------------------------------------------------
// GET / — list caller's rotation policies.
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(rotation_policies)
    .where(eq(rotation_policies.user_id, userId))
    .orderBy(desc(rotation_policies.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — create a policy.
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', policySchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [policy] = await db
    .insert(rotation_policies)
    .values({
      user_id: userId,
      name: body.name,
      applies_to_type: body.applies_to_type ?? null,
      applies_to_criticality: body.applies_to_criticality ?? null,
      max_age_days: body.max_age_days,
      grace_days: body.grace_days ?? 0,
      escalation_days: body.escalation_days ?? null,
    })
    .returning()

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'policy_create',
    entity_type: 'rotation_policy',
    entity_id: policy.id,
    detail: { name: policy.name, max_age_days: policy.max_age_days },
  })

  return c.json(policy, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update a policy (auth + owner).
// ---------------------------------------------------------------------------
router.put('/:id', authMiddleware, zValidator('json', policySchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(rotation_policies)
    .where(eq(rotation_policies.id, id))

  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.applies_to_type !== undefined) patch.applies_to_type = body.applies_to_type
  if (body.applies_to_criticality !== undefined) patch.applies_to_criticality = body.applies_to_criticality
  if (body.max_age_days !== undefined) patch.max_age_days = body.max_age_days
  if (body.grace_days !== undefined) patch.grace_days = body.grace_days
  if (body.escalation_days !== undefined) patch.escalation_days = body.escalation_days

  const [updated] = await db
    .update(rotation_policies)
    .set(patch)
    .where(eq(rotation_policies.id, id))
    .returning()

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'policy_update',
    entity_type: 'rotation_policy',
    entity_id: id,
    detail: patch,
  })

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete a policy (auth + owner).
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(rotation_policies)
    .where(eq(rotation_policies.id, id))

  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(rotation_policies).where(eq(rotation_policies.id, id))

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'policy_delete',
    entity_type: 'rotation_policy',
    entity_id: id,
    detail: { name: existing.name },
  })

  return c.json({ success: true })
})

export default router
