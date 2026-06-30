import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  owners,
  resources,
  stores,
  resource_owners,
  runbook_tasks,
} from '../db/schema.js'
import { eq, and, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const ownerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  team: z.string().optional().nullable(),
  escalation_contact: z.string().optional().nullable(),
})

const assignSchema = z
  .object({
    owner_id: z.string().min(1),
    resource_id: z.string().min(1).optional().nullable(),
    store_id: z.string().min(1).optional().nullable(),
  })
  .refine((v) => !!v.resource_id || !!v.store_id, {
    message: 'Either resource_id or store_id is required',
  })

// GET / — owner directory + open (unfinished) task counts
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db.select().from(owners).where(eq(owners.user_id, userId))

  const ownerIds = rows.map((o) => o.id)
  const openCounts = new Map<string, number>()
  if (ownerIds.length > 0) {
    const tasks = await db
      .select()
      .from(runbook_tasks)
      .where(
        and(
          eq(runbook_tasks.user_id, userId),
          inArray(runbook_tasks.owner_id, ownerIds),
        ),
      )
    for (const t of tasks) {
      if (!t.owner_id) continue
      if (t.status === 'done' || t.status === 'verified') continue
      openCounts.set(t.owner_id, (openCounts.get(t.owner_id) ?? 0) + 1)
    }
  }

  const result = rows.map((o) => ({
    ...o,
    open_task_count: openCounts.get(o.id) ?? 0,
  }))
  return c.json(result)
})

// GET /:id — owner detail + assigned resources/stores/tasks
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [owner] = await db
    .select()
    .from(owners)
    .where(and(eq(owners.id, id), eq(owners.user_id, userId)))
  if (!owner) return c.json({ error: 'Not found' }, 404)

  const assignments = await db
    .select()
    .from(resource_owners)
    .where(
      and(
        eq(resource_owners.owner_id, id),
        eq(resource_owners.user_id, userId),
      ),
    )

  const assignedResourceIds = assignments
    .map((a) => a.resource_id)
    .filter((v): v is string => !!v)
  const assignedStoreIds = assignments
    .map((a) => a.store_id)
    .filter((v): v is string => !!v)

  // Resources owned directly (owner_id on resources) plus via resource_owners.
  const directResources = await db
    .select()
    .from(resources)
    .where(and(eq(resources.owner_id, id), eq(resources.user_id, userId)))
  let mappedResources: typeof directResources = []
  if (assignedResourceIds.length > 0) {
    mappedResources = await db
      .select()
      .from(resources)
      .where(
        and(
          inArray(resources.id, assignedResourceIds),
          eq(resources.user_id, userId),
        ),
      )
  }
  const resourceMap = new Map<string, (typeof directResources)[number]>()
  for (const r of [...directResources, ...mappedResources]) resourceMap.set(r.id, r)

  const directStores = await db
    .select()
    .from(stores)
    .where(and(eq(stores.owner_id, id), eq(stores.user_id, userId)))
  let mappedStores: typeof directStores = []
  if (assignedStoreIds.length > 0) {
    mappedStores = await db
      .select()
      .from(stores)
      .where(
        and(inArray(stores.id, assignedStoreIds), eq(stores.user_id, userId)),
      )
  }
  const storeMap = new Map<string, (typeof directStores)[number]>()
  for (const s of [...directStores, ...mappedStores]) storeMap.set(s.id, s)

  const tasks = await db
    .select()
    .from(runbook_tasks)
    .where(
      and(eq(runbook_tasks.owner_id, id), eq(runbook_tasks.user_id, userId)),
    )

  return c.json({
    owner,
    resources: [...resourceMap.values()],
    stores: [...storeMap.values()],
    tasks,
  })
})

// POST / — create owner
router.post('/', authMiddleware, zValidator('json', ownerSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(owners)
    .values({ ...body, user_id: userId })
    .returning()
  return c.json(created, 201)
})

// PUT /:id — update owner (auth + owner)
router.put(
  '/:id',
  authMiddleware,
  zValidator('json', ownerSchema.partial()),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db
      .select()
      .from(owners)
      .where(eq(owners.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
    const body = c.req.valid('json')
    const [updated] = await db
      .update(owners)
      .set(body)
      .where(eq(owners.id, id))
      .returning()
    return c.json(updated)
  },
)

// DELETE /:id — delete owner (auth + owner)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(owners).where(eq(owners.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  // Clear assignments referencing this owner first to avoid FK issues.
  await db
    .delete(resource_owners)
    .where(
      and(
        eq(resource_owners.owner_id, id),
        eq(resource_owners.user_id, userId),
      ),
    )
  await db.delete(owners).where(eq(owners.id, id))
  return c.json({ success: true })
})

// POST /assign — assign owner to a resource or store
router.post(
  '/assign',
  authMiddleware,
  zValidator('json', assignSchema),
  async (c) => {
    const userId = getUserId(c)
    const body = c.req.valid('json')

    const [owner] = await db
      .select()
      .from(owners)
      .where(and(eq(owners.id, body.owner_id), eq(owners.user_id, userId)))
    if (!owner) return c.json({ error: 'Owner not found' }, 404)

    if (body.resource_id) {
      const [r] = await db
        .select()
        .from(resources)
        .where(
          and(
            eq(resources.id, body.resource_id),
            eq(resources.user_id, userId),
          ),
        )
      if (!r) return c.json({ error: 'Resource not found' }, 404)
    }
    if (body.store_id) {
      const [s] = await db
        .select()
        .from(stores)
        .where(
          and(eq(stores.id, body.store_id), eq(stores.user_id, userId)),
        )
      if (!s) return c.json({ error: 'Store not found' }, 404)
    }

    const [created] = await db
      .insert(resource_owners)
      .values({
        user_id: userId,
        owner_id: body.owner_id,
        resource_id: body.resource_id ?? null,
        store_id: body.store_id ?? null,
      })
      .returning()
    return c.json(created, 201)
  },
)

export default router
