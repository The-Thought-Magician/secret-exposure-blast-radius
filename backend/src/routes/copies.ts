import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { secret_copies, secrets, stores } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const copySchema = z.object({
  secret_id: z.string().min(1),
  store_id: z.string().min(1),
  rotated: z.boolean().optional().default(false),
  last_seen_at: z.string().datetime().optional(),
})

// GET / — list copies, filter by secret_id/store_id
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const { secret_id, store_id } = c.req.query()
  const conds = [eq(secret_copies.user_id, userId)]
  if (secret_id) conds.push(eq(secret_copies.secret_id, secret_id))
  if (store_id) conds.push(eq(secret_copies.store_id, store_id))
  const rows = await db
    .select({
      id: secret_copies.id,
      secret_id: secret_copies.secret_id,
      store_id: secret_copies.store_id,
      rotated: secret_copies.rotated,
      last_seen_at: secret_copies.last_seen_at,
      created_at: secret_copies.created_at,
      secret_name: secrets.name,
      secret_status: secrets.status,
      store_name: stores.name,
      store_type: stores.type,
    })
    .from(secret_copies)
    .leftJoin(secrets, eq(secret_copies.secret_id, secrets.id))
    .leftJoin(stores, eq(secret_copies.store_id, stores.id))
    .where(and(...conds))
    .orderBy(desc(secret_copies.created_at))
  return c.json(rows)
})

// POST / — register a copy (secret in store). UNIQUE(secret_id, store_id) upsert.
router.post('/', authMiddleware, zValidator('json', copySchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [secret] = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, body.secret_id), eq(secrets.user_id, userId)))
  if (!secret) return c.json({ error: 'Secret not found' }, 400)
  const [store] = await db
    .select()
    .from(stores)
    .where(and(eq(stores.id, body.store_id), eq(stores.user_id, userId)))
  if (!store) return c.json({ error: 'Store not found' }, 400)

  const lastSeen = body.last_seen_at ? new Date(body.last_seen_at) : new Date()
  const [created] = await db
    .insert(secret_copies)
    .values({
      user_id: userId,
      secret_id: body.secret_id,
      store_id: body.store_id,
      rotated: body.rotated,
      last_seen_at: lastSeen,
    })
    .onConflictDoUpdate({
      target: [secret_copies.secret_id, secret_copies.store_id],
      set: { rotated: body.rotated, last_seen_at: lastSeen },
    })
    .returning()
  return c.json(created, 201)
})

// DELETE /:id — remove copy (auth + owner)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(secret_copies).where(eq(secret_copies.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(secret_copies).where(eq(secret_copies.id, id))
  return c.json({ success: true })
})

// GET /discover/:secretId — copy-discovery: live copies + unrotated + gaps
// (stores in the inventory that do NOT yet hold a copy of this secret).
router.get('/discover/:secretId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const secretId = c.req.param('secretId')

  const [secret] = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, secretId), eq(secrets.user_id, userId)))
  if (!secret) return c.json({ error: 'Secret not found' }, 404)

  const copies = await db
    .select({
      id: secret_copies.id,
      secret_id: secret_copies.secret_id,
      store_id: secret_copies.store_id,
      rotated: secret_copies.rotated,
      last_seen_at: secret_copies.last_seen_at,
      created_at: secret_copies.created_at,
      store_name: stores.name,
      store_type: stores.type,
      store_location: stores.location,
    })
    .from(secret_copies)
    .leftJoin(stores, eq(secret_copies.store_id, stores.id))
    .where(and(eq(secret_copies.secret_id, secretId), eq(secret_copies.user_id, userId)))

  // Unrotated copies: a copy is unrotated if the secret was rotated after the
  // copy was last refreshed, or the copy was never marked rotated.
  const rotatedAt = secret.last_rotated_at ? new Date(secret.last_rotated_at).getTime() : 0
  const unrotated = copies.filter((cp) => {
    if (!cp.rotated) return true
    const seen = cp.last_seen_at ? new Date(cp.last_seen_at).getTime() : 0
    return rotatedAt > 0 && seen < rotatedAt
  })

  // Gaps: stores the caller owns that have no copy of this secret yet — the
  // places a leaked secret might also live but is not tracked.
  const allStores = await db.select().from(stores).where(eq(stores.user_id, userId))
  const coveredStoreIds = new Set(copies.map((cp) => cp.store_id))
  const gaps = allStores
    .filter((s) => !coveredStoreIds.has(s.id))
    .map((s) => ({ store_id: s.id, store_name: s.name, store_type: s.type, location: s.location }))

  return c.json({ copies, unrotated, gaps })
})

export default router
