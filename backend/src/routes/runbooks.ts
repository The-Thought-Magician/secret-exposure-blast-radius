import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  runbooks,
  runbook_tasks,
  notifications,
  audit_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET / — list caller's runbooks (filter by status / exposure_id)
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const status = c.req.query('status')
  const exposureId = c.req.query('exposure_id')

  const conds = [eq(runbooks.user_id, userId)]
  if (status) conds.push(eq(runbooks.status, status))
  if (exposureId) conds.push(eq(runbooks.exposure_id, exposureId))

  const rows = await db
    .select()
    .from(runbooks)
    .where(and(...conds))
    .orderBy(desc(runbooks.created_at))

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — runbook detail + tasks
// ---------------------------------------------------------------------------
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [runbook] = await db
    .select()
    .from(runbooks)
    .where(and(eq(runbooks.id, id), eq(runbooks.user_id, userId)))

  if (!runbook) return c.json({ error: 'Not found' }, 404)

  const tasks = await db
    .select()
    .from(runbook_tasks)
    .where(and(eq(runbook_tasks.runbook_id, id), eq(runbook_tasks.user_id, userId)))
    .orderBy(runbook_tasks.created_at)

  return c.json({ runbook, tasks })
})

// ---------------------------------------------------------------------------
// POST /:id/tasks — add a task to a runbook (recomputes total_tasks)
// ---------------------------------------------------------------------------
const taskCreateSchema = z.object({
  kind: z.enum(['rotate', 'revoke', 'verify', 'notify']),
  description: z.string().min(1),
  store_id: z.string().optional().nullable(),
  resource_id: z.string().optional().nullable(),
  owner_id: z.string().optional().nullable(),
  status: z.enum(['pending', 'in_progress', 'done', 'verified']).optional().default('pending'),
  due_at: z.string().datetime().optional().nullable(),
})

router.post('/:id/tasks', authMiddleware, zValidator('json', taskCreateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [runbook] = await db
    .select()
    .from(runbooks)
    .where(and(eq(runbooks.id, id), eq(runbooks.user_id, userId)))

  if (!runbook) return c.json({ error: 'Not found' }, 404)

  const [task] = await db
    .insert(runbook_tasks)
    .values({
      user_id: userId,
      runbook_id: id,
      kind: body.kind,
      description: body.description,
      store_id: body.store_id ?? null,
      resource_id: body.resource_id ?? null,
      owner_id: body.owner_id ?? null,
      status: body.status,
      due_at: body.due_at ? new Date(body.due_at) : null,
      completed_at: body.status === 'done' || body.status === 'verified' ? new Date() : null,
      verified_at: body.status === 'verified' ? new Date() : null,
    })
    .returning()

  await recomputeRunbookProgress(userId, id)

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'runbook_task_add',
    entity_type: 'runbook_task',
    entity_id: task.id,
    detail: { runbook_id: id, kind: body.kind },
  })

  return c.json(task, 201)
})

// ---------------------------------------------------------------------------
// PUT /tasks/:taskId — update task status/owner; recompute progress;
// when all tasks verified -> runbook complete + notify.
// ---------------------------------------------------------------------------
const taskUpdateSchema = z.object({
  kind: z.enum(['rotate', 'revoke', 'verify', 'notify']).optional(),
  description: z.string().min(1).optional(),
  store_id: z.string().optional().nullable(),
  resource_id: z.string().optional().nullable(),
  owner_id: z.string().optional().nullable(),
  status: z.enum(['pending', 'in_progress', 'done', 'verified']).optional(),
  due_at: z.string().datetime().optional().nullable(),
})

router.put('/tasks/:taskId', authMiddleware, zValidator('json', taskUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const taskId = c.req.param('taskId')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(runbook_tasks)
    .where(eq(runbook_tasks.id, taskId))

  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const patch: Record<string, unknown> = {}
  if (body.kind !== undefined) patch.kind = body.kind
  if (body.description !== undefined) patch.description = body.description
  if (body.store_id !== undefined) patch.store_id = body.store_id
  if (body.resource_id !== undefined) patch.resource_id = body.resource_id
  if (body.owner_id !== undefined) patch.owner_id = body.owner_id
  if (body.due_at !== undefined) patch.due_at = body.due_at ? new Date(body.due_at) : null

  if (body.status !== undefined) {
    patch.status = body.status
    // completed_at set when moving into done/verified, cleared otherwise
    if (body.status === 'done' || body.status === 'verified') {
      patch.completed_at = existing.completed_at ?? new Date()
    } else {
      patch.completed_at = null
    }
    // verified_at only set when verified
    patch.verified_at = body.status === 'verified' ? (existing.verified_at ?? new Date()) : null
  }

  const [updated] = await db
    .update(runbook_tasks)
    .set(patch)
    .where(eq(runbook_tasks.id, taskId))
    .returning()

  const wasComplete = await recomputeRunbookProgress(userId, existing.runbook_id)

  if (wasComplete.justCompleted) {
    await db.insert(notifications).values({
      user_id: userId,
      kind: 'runbook_complete',
      title: 'Runbook complete',
      body: `All tasks verified for runbook "${wasComplete.title}"`,
      link: `/dashboard/runbooks`,
    })
  }

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'runbook_task_update',
    entity_type: 'runbook_task',
    entity_id: taskId,
    detail: { status: body.status ?? existing.status },
  })

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /tasks/:taskId — delete task; recompute progress.
// ---------------------------------------------------------------------------
router.delete('/tasks/:taskId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const taskId = c.req.param('taskId')

  const [existing] = await db
    .select()
    .from(runbook_tasks)
    .where(eq(runbook_tasks.id, taskId))

  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(runbook_tasks).where(eq(runbook_tasks.id, taskId))
  await recomputeRunbookProgress(userId, existing.runbook_id)

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'runbook_task_delete',
    entity_type: 'runbook_task',
    entity_id: taskId,
    detail: { runbook_id: existing.runbook_id },
  })

  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Helper: recompute total/verified task counts + runbook status.
// status: open (no progress) | in_progress (some) | complete (all verified).
// ---------------------------------------------------------------------------
async function recomputeRunbookProgress(
  userId: string,
  runbookId: string,
): Promise<{ justCompleted: boolean; title: string }> {
  const tasks = await db
    .select()
    .from(runbook_tasks)
    .where(and(eq(runbook_tasks.runbook_id, runbookId), eq(runbook_tasks.user_id, userId)))

  const total = tasks.length
  const verified = tasks.filter((t) => t.status === 'verified').length
  const anyProgress = tasks.some((t) => t.status !== 'pending')

  const [runbook] = await db
    .select()
    .from(runbooks)
    .where(eq(runbooks.id, runbookId))

  const wasComplete = runbook?.status === 'complete'

  let status: string
  if (total > 0 && verified === total) status = 'complete'
  else if (anyProgress) status = 'in_progress'
  else status = 'open'

  await db
    .update(runbooks)
    .set({ total_tasks: total, verified_tasks: verified, status })
    .where(eq(runbooks.id, runbookId))

  return {
    justCompleted: status === 'complete' && !wasComplete,
    title: runbook?.title ?? 'Runbook',
  }
}

export default router
