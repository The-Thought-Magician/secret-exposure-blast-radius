import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { access_logs, resources, audit_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET / — list access logs (filter by resource_id / principal)
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const resourceId = c.req.query('resource_id')
  const principal = c.req.query('principal')
  const conds = [eq(access_logs.user_id, userId)]
  if (resourceId) conds.push(eq(access_logs.resource_id, resourceId))
  if (principal) conds.push(eq(access_logs.principal, principal))
  const rows = await db
    .select()
    .from(access_logs)
    .where(and(...conds))
    .orderBy(desc(access_logs.occurred_at))
  return c.json(rows)
})

const logSchema = z.object({
  resource_id: z.string().optional(),
  principal: z.string().min(1),
  ip: z.string().optional(),
  action: z.string().optional(),
  anomalous: z.boolean().optional().default(false),
  occurred_at: z.string().datetime().optional(),
})

async function assertResourceOwned(userId: string, resourceId: string | undefined): Promise<boolean> {
  if (!resourceId) return true
  const [res] = await db
    .select()
    .from(resources)
    .where(and(eq(resources.id, resourceId), eq(resources.user_id, userId)))
  return !!res
}

// ---------------------------------------------------------------------------
// POST / — ingest a single access log entry
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', logSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await assertResourceOwned(userId, body.resource_id))) {
    return c.json({ error: 'Resource not found' }, 404)
  }
  const [row] = await db
    .insert(access_logs)
    .values({
      user_id: userId,
      resource_id: body.resource_id ?? null,
      principal: body.principal,
      ip: body.ip ?? null,
      action: body.action ?? null,
      anomalous: body.anomalous ?? false,
      occurred_at: body.occurred_at ? new Date(body.occurred_at) : new Date(),
    })
    .returning()

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'ingest_access_log',
    entity_type: 'access_log',
    entity_id: row.id,
    detail: { principal: body.principal, resource_id: body.resource_id ?? null },
  })

  return c.json(row, 201)
})

// ---------------------------------------------------------------------------
// POST /bulk — ingest an array of access logs
// ---------------------------------------------------------------------------
const bulkSchema = z.object({
  logs: z.array(logSchema).min(1),
})

router.post('/bulk', authMiddleware, zValidator('json', bulkSchema), async (c) => {
  const userId = getUserId(c)
  const { logs } = c.req.valid('json')

  // Validate every referenced resource belongs to the caller.
  const referenced = [...new Set(logs.map((l) => l.resource_id).filter((x): x is string => !!x))]
  for (const rid of referenced) {
    if (!(await assertResourceOwned(userId, rid))) {
      return c.json({ error: `Resource not found: ${rid}` }, 404)
    }
  }

  const values = logs.map((l) => ({
    user_id: userId,
    resource_id: l.resource_id ?? null,
    principal: l.principal,
    ip: l.ip ?? null,
    action: l.action ?? null,
    anomalous: l.anomalous ?? false,
    occurred_at: l.occurred_at ? new Date(l.occurred_at) : new Date(),
  }))
  const inserted = await db.insert(access_logs).values(values).returning()

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'bulk_ingest_access_logs',
    entity_type: 'access_log',
    entity_id: null,
    detail: { inserted: inserted.length },
  })

  return c.json({ inserted: inserted.length }, 201)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete an entry (auth + owner)
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(access_logs).where(eq(access_logs.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(access_logs).where(eq(access_logs.id, id))

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'delete_access_log',
    entity_type: 'access_log',
    entity_id: id,
    detail: {},
  })

  return c.json({ success: true })
})

export default router
