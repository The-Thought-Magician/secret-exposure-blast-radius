import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { resources, grant_edges, secrets, owners } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const resourceSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    'database',
    's3_bucket',
    'payment_api',
    'internal_service',
    'queue',
    'cloud_account',
    'saas',
  ]),
  sensitivity: z
    .enum(['public', 'internal', 'confidential', 'pii', 'crown_jewel'])
    .optional()
    .default('internal'),
  environment: z.string().min(1).optional().default('prod'),
  owner_id: z.string().nullable().optional(),
  contains_secret_id: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
})

// GET / — list caller's resources (filter by type/sensitivity/env)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const { type, sensitivity, env } = c.req.query()
  const conds = [eq(resources.user_id, userId)]
  if (type) conds.push(eq(resources.type, type))
  if (sensitivity) conds.push(eq(resources.sensitivity, sensitivity))
  if (env) conds.push(eq(resources.environment, env))
  const rows = await db
    .select()
    .from(resources)
    .where(and(...conds))
    .orderBy(desc(resources.created_at))
  return c.json(rows)
})

// GET /:id — resource detail + granting secrets
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [resource] = await db
    .select()
    .from(resources)
    .where(and(eq(resources.id, id), eq(resources.user_id, userId)))
  if (!resource) return c.json({ error: 'Not found' }, 404)

  // Granting secrets: edges where this resource is the target, joined to secret.
  const grantRows = await db
    .select({
      grant: grant_edges,
      secret: secrets,
    })
    .from(grant_edges)
    .leftJoin(secrets, eq(grant_edges.secret_id, secrets.id))
    .where(and(eq(grant_edges.resource_id, id), eq(grant_edges.user_id, userId)))
    .orderBy(desc(grant_edges.created_at))

  const grants = grantRows.map((r) => ({ ...r.grant, secret: r.secret }))
  return c.json({ resource, grants })
})

// POST / — create resource
router.post('/', authMiddleware, zValidator('json', resourceSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (body.owner_id) {
    const [owner] = await db
      .select()
      .from(owners)
      .where(and(eq(owners.id, body.owner_id), eq(owners.user_id, userId)))
    if (!owner) return c.json({ error: 'owner_id not found' }, 400)
  }
  if (body.contains_secret_id) {
    const [sec] = await db
      .select()
      .from(secrets)
      .where(and(eq(secrets.id, body.contains_secret_id), eq(secrets.user_id, userId)))
    if (!sec) return c.json({ error: 'contains_secret_id not found' }, 400)
  }

  const [created] = await db
    .insert(resources)
    .values({
      user_id: userId,
      name: body.name,
      type: body.type,
      sensitivity: body.sensitivity,
      environment: body.environment,
      owner_id: body.owner_id ?? null,
      contains_secret_id: body.contains_secret_id ?? null,
      metadata: body.metadata ?? {},
    })
    .returning()
  return c.json(created, 201)
})

// PUT /:id — update resource
router.put('/:id', authMiddleware, zValidator('json', resourceSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(resources)
    .where(eq(resources.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  if (body.owner_id) {
    const [owner] = await db
      .select()
      .from(owners)
      .where(and(eq(owners.id, body.owner_id), eq(owners.user_id, userId)))
    if (!owner) return c.json({ error: 'owner_id not found' }, 400)
  }
  if (body.contains_secret_id) {
    const [sec] = await db
      .select()
      .from(secrets)
      .where(and(eq(secrets.id, body.contains_secret_id), eq(secrets.user_id, userId)))
    if (!sec) return c.json({ error: 'contains_secret_id not found' }, 400)
  }

  const [updated] = await db
    .update(resources)
    .set(body)
    .where(eq(resources.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — delete resource
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(resources)
    .where(eq(resources.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Remove grant edges pointing at this resource first to avoid dangling edges.
  await db
    .delete(grant_edges)
    .where(and(eq(grant_edges.resource_id, id), eq(grant_edges.user_id, userId)))
  await db.delete(resources).where(eq(resources.id, id))
  return c.json({ success: true })
})

export default router
