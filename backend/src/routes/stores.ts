import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { stores, secret_copies, secrets, owners } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const storeSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    'vault',
    'aws_sm',
    'gcp_sm',
    'env_file',
    'ci_variable',
    'k8s_secret',
    'onepassword',
    'other',
  ]),
  location: z.string().optional(),
  owner_id: z.string().optional().nullable(),
  scan_cadence: z.enum(['daily', 'weekly', 'manual']).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
})

// A copy is "stale" when the store was scanned after the copy was last seen,
// or when the copy has never been seen.
function staleCadenceMs(cadence: string | null): number {
  if (cadence === 'daily') return 86_400_000
  if (cadence === 'weekly') return 7 * 86_400_000
  return 30 * 86_400_000
}

// GET / — list stores with health (secret_count, stale_copy_count)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(stores)
    .where(eq(stores.user_id, userId))
    .orderBy(desc(stores.created_at))

  const copies = await db
    .select()
    .from(secret_copies)
    .where(eq(secret_copies.user_id, userId))

  const now = Date.now()
  const out = rows.map((store) => {
    const storeCopies = copies.filter((cp) => cp.store_id === store.id)
    const secretIds = new Set(storeCopies.map((cp) => cp.secret_id))
    const threshold = staleCadenceMs(store.scan_cadence)
    const staleCopyCount = storeCopies.filter((cp) => {
      const seen = cp.last_seen_at ? new Date(cp.last_seen_at).getTime() : 0
      return !cp.rotated || now - seen > threshold
    }).length
    return {
      ...store,
      secret_count: secretIds.size,
      stale_copy_count: staleCopyCount,
    }
  })
  return c.json(out)
})

// GET /:id — store detail + secrets it holds
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [store] = await db
    .select()
    .from(stores)
    .where(and(eq(stores.id, id), eq(stores.user_id, userId)))
  if (!store) return c.json({ error: 'Not found' }, 404)

  const copies = await db
    .select({
      id: secret_copies.id,
      secret_id: secret_copies.secret_id,
      store_id: secret_copies.store_id,
      rotated: secret_copies.rotated,
      last_seen_at: secret_copies.last_seen_at,
      created_at: secret_copies.created_at,
      secret_name: secrets.name,
      secret_type: secrets.type,
      secret_status: secrets.status,
      secret_criticality: secrets.criticality,
    })
    .from(secret_copies)
    .leftJoin(secrets, eq(secret_copies.secret_id, secrets.id))
    .where(and(eq(secret_copies.store_id, id), eq(secret_copies.user_id, userId)))

  return c.json({ store, copies })
})

// POST / — create store
router.post('/', authMiddleware, zValidator('json', storeSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (body.owner_id) {
    const [owner] = await db
      .select()
      .from(owners)
      .where(and(eq(owners.id, body.owner_id), eq(owners.user_id, userId)))
    if (!owner) return c.json({ error: 'Owner not found' }, 400)
  }
  const [created] = await db.insert(stores).values({ ...body, user_id: userId }).returning()
  return c.json(created, 201)
})

// PUT /:id — update store (auth + owner)
router.put('/:id', authMiddleware, zValidator('json', storeSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(stores).where(eq(stores.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db.update(stores).set(body).where(eq(stores.id, id)).returning()
  return c.json(updated)
})

// DELETE /:id — delete store (auth + owner)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(stores).where(eq(stores.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(secret_copies).where(eq(secret_copies.store_id, id))
  await db.delete(stores).where(eq(stores.id, id))
  return c.json({ success: true })
})

// POST /:id/scan — record a scan (sets last_scanned_at), refreshes copy last_seen_at
router.post('/:id/scan', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(stores).where(eq(stores.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const now = new Date()
  const [updated] = await db
    .update(stores)
    .set({ last_scanned_at: now })
    .where(eq(stores.id, id))
    .returning()
  await db
    .update(secret_copies)
    .set({ last_seen_at: now })
    .where(and(eq(secret_copies.store_id, id), eq(secret_copies.user_id, userId)))
  return c.json(updated)
})

export default router
