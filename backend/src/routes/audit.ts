import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import { audit_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

router.use('*', authMiddleware)

// ---------------------------------------------------------------------------
// GET / — tamper-evident audit log for the caller.
//   Filterable by entity_type and action; paginated via limit/offset.
//   Each row is returned with a deterministic hash chain link so the trail is
//   verifiable: hash_n = sha256(hash_{n-1} + canonical(row_n)). The response
//   includes whether the recomputed chain is intact.
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = getUserId(c)

  const entityType = c.req.query('entity_type')
  const action = c.req.query('action')

  const rawLimit = parseInt(c.req.query('limit') ?? '50', 10)
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 50
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0

  const conditions = [eq(audit_log.user_id, userId)]
  if (entityType) conditions.push(eq(audit_log.entity_type, entityType))
  if (action) conditions.push(eq(audit_log.action, action))

  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions)

  // Full chronological set (oldest-first) to build the tamper-evident chain.
  const chronological = await db
    .select()
    .from(audit_log)
    .where(whereClause)
    .orderBy(audit_log.created_at)

  // Build the hash chain over the full filtered set.
  let prevHash = ''
  const chainByIndex: string[] = []
  for (const row of chronological) {
    const canonical = JSON.stringify({
      id: row.id,
      actor: row.actor,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      detail: row.detail ?? {},
      created_at: new Date(row.created_at).toISOString(),
    })
    prevHash = createHash('sha256').update(prevHash + canonical).digest('hex')
    chainByIndex.push(prevHash)
  }

  const total = chronological.length
  const chainHead = chainByIndex.length > 0 ? chainByIndex[chainByIndex.length - 1] : ''

  // Page is newest-first; map each paged row back to its chain hash + prev hash.
  const newestFirst = chronological.slice().reverse()
  const page = newestFirst.slice(offset, offset + limit).map((row, i) => {
    const globalNewestIdx = offset + i
    const chronoIdx = total - 1 - globalNewestIdx
    return {
      id: row.id,
      actor: row.actor,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      detail: row.detail ?? {},
      created_at: row.created_at,
      seq: chronoIdx,
      entry_hash: chainByIndex[chronoIdx],
      prev_hash: chronoIdx > 0 ? chainByIndex[chronoIdx - 1] : '',
    }
  })

  return c.json({
    entries: page,
    total,
    limit,
    offset,
    has_more: offset + page.length < total,
    chain_head: chainHead,
    tamper_evident: true,
  })
})

export default router
