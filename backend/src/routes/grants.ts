import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { grant_edges, secrets, resources } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const grantSchema = z.object({
  secret_id: z.string().min(1),
  resource_id: z.string().min(1),
  permission: z.enum(['read', 'write', 'admin']).optional().default('read'),
  scope: z.string().nullable().optional(),
  confidence: z.enum(['confirmed', 'inferred']).optional().default('confirmed'),
})

// GET / — list grant edges (filter by secret_id/resource_id)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const { secret_id, resource_id } = c.req.query()
  const conds = [eq(grant_edges.user_id, userId)]
  if (secret_id) conds.push(eq(grant_edges.secret_id, secret_id))
  if (resource_id) conds.push(eq(grant_edges.resource_id, resource_id))
  const rows = await db
    .select()
    .from(grant_edges)
    .where(and(...conds))
    .orderBy(desc(grant_edges.created_at))
  return c.json(rows)
})

// POST / — create grant edge (UNIQUE(secret_id, resource_id))
router.post('/', authMiddleware, zValidator('json', grantSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [secret] = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, body.secret_id), eq(secrets.user_id, userId)))
  if (!secret) return c.json({ error: 'secret_id not found' }, 400)

  const [resource] = await db
    .select()
    .from(resources)
    .where(and(eq(resources.id, body.resource_id), eq(resources.user_id, userId)))
  if (!resource) return c.json({ error: 'resource_id not found' }, 400)

  // Enforce UNIQUE(secret_id, resource_id) at the app layer too.
  const [dup] = await db
    .select()
    .from(grant_edges)
    .where(
      and(
        eq(grant_edges.user_id, userId),
        eq(grant_edges.secret_id, body.secret_id),
        eq(grant_edges.resource_id, body.resource_id),
      ),
    )
  if (dup) return c.json({ error: 'Grant already exists for this secret/resource pair' }, 409)

  const [created] = await db
    .insert(grant_edges)
    .values({
      user_id: userId,
      secret_id: body.secret_id,
      resource_id: body.resource_id,
      permission: body.permission,
      scope: body.scope ?? null,
      confidence: body.confidence,
    })
    .returning()
  return c.json(created, 201)
})

// PUT /:id — update edge (permission/scope/confidence)
router.put(
  '/:id',
  authMiddleware,
  zValidator(
    'json',
    z.object({
      permission: z.enum(['read', 'write', 'admin']).optional(),
      scope: z.string().nullable().optional(),
      confidence: z.enum(['confirmed', 'inferred']).optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db.select().from(grant_edges).where(eq(grant_edges.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')
    const [updated] = await db
      .update(grant_edges)
      .set(body)
      .where(eq(grant_edges.id, id))
      .returning()
    return c.json(updated)
  },
)

// DELETE /:id — delete edge
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(grant_edges).where(eq(grant_edges.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(grant_edges).where(eq(grant_edges.id, id))
  return c.json({ success: true })
})

export default router
