import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  rotation_debt,
  secrets,
  rotation_policies,
  secret_copies,
  owners,
  audit_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Severity weights for scoring debt entries.
const SEVERITY_WEIGHT: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

const CRITICALITY_SEVERITY: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
}

function daysBetween(from: Date | null | undefined, to: Date): number {
  if (!from) return 0
  return Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 86_400_000))
}

function severityForAge(ageDays: number, maxAge: number | null): string {
  if (!maxAge || maxAge <= 0) return ageDays > 365 ? 'high' : ageDays > 180 ? 'medium' : 'low'
  const ratio = ageDays / maxAge
  if (ratio >= 3) return 'critical'
  if (ratio >= 2) return 'high'
  if (ratio >= 1.25) return 'medium'
  return 'low'
}

function scoreFor(severity: string, ageDays: number): number {
  const base = SEVERITY_WEIGHT[severity] ?? 1
  // Score grows with severity weight and age (capped contribution from age).
  return Number((base * 10 + Math.min(ageDays, 730) / 10).toFixed(2))
}

// ---------------------------------------------------------------------------
// GET / — rotation-debt ledger (filter by reason/owner/resolved)
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const reason = c.req.query('reason')
  const ownerId = c.req.query('owner_id') ?? c.req.query('owner')
  const resolvedQ = c.req.query('resolved')

  const conds = [eq(rotation_debt.user_id, userId)]
  if (reason) conds.push(eq(rotation_debt.reason, reason))
  if (ownerId) conds.push(eq(rotation_debt.owner_id, ownerId))
  if (resolvedQ === 'true') conds.push(eq(rotation_debt.resolved, true))
  if (resolvedQ === 'false') conds.push(eq(rotation_debt.resolved, false))

  const rows = await db
    .select()
    .from(rotation_debt)
    .where(and(...conds))
    .orderBy(desc(rotation_debt.score), desc(rotation_debt.created_at))

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /recompute — recompute debt from secrets vs policies/max-age + unrotated copies
// ---------------------------------------------------------------------------
router.post('/recompute', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const now = new Date()

  // Clear unresolved debt and rebuild; keep resolved history.
  await db
    .delete(rotation_debt)
    .where(and(eq(rotation_debt.user_id, userId), eq(rotation_debt.resolved, false)))

  const userSecrets = await db.select().from(secrets).where(eq(secrets.user_id, userId))
  const policies = await db
    .select()
    .from(rotation_policies)
    .where(eq(rotation_policies.user_id, userId))
  const copies = await db.select().from(secret_copies).where(eq(secret_copies.user_id, userId))

  // Owner resolution: secret -> owning resource owner is not direct; use null unless inferable.
  const inserts: Array<typeof rotation_debt.$inferInsert> = []

  // Index unrotated copies per secret.
  const unrotatedBySecret = new Map<string, number>()
  for (const cp of copies) {
    if (!cp.rotated) {
      unrotatedBySecret.set(cp.secret_id, (unrotatedBySecret.get(cp.secret_id) ?? 0) + 1)
    }
  }

  function effectiveMaxAge(s: typeof secrets.$inferSelect): number | null {
    if (s.max_age_days && s.max_age_days > 0) return s.max_age_days
    // Find the most specific matching policy.
    let best: { maxAge: number; specificity: number } | null = null
    for (const p of policies) {
      const typeMatch = !p.applies_to_type || p.applies_to_type === s.type
      const critMatch = !p.applies_to_criticality || p.applies_to_criticality === s.criticality
      if (!typeMatch || !critMatch) continue
      const specificity = (p.applies_to_type ? 1 : 0) + (p.applies_to_criticality ? 1 : 0)
      if (!best || specificity > best.specificity) {
        best = { maxAge: p.max_age_days, specificity }
      }
    }
    return best ? best.maxAge : null
  }

  for (const s of userSecrets) {
    if (s.status === 'retired') continue

    // 1. never_rotated
    if (!s.last_rotated_at) {
      const ageDays = daysBetween(s.created_at, now)
      const severity = CRITICALITY_SEVERITY[s.criticality] ?? 'medium'
      inserts.push({
        user_id: userId,
        secret_id: s.id,
        reason: 'never_rotated',
        age_days: ageDays,
        severity,
        score: scoreFor(severity, ageDays),
        owner_id: null,
        resolved: false,
      })
    } else {
      // 2. past_max_age
      const maxAge = effectiveMaxAge(s)
      const ageDays = daysBetween(s.last_rotated_at, now)
      if (maxAge && ageDays > maxAge) {
        const severity = severityForAge(ageDays, maxAge)
        inserts.push({
          user_id: userId,
          secret_id: s.id,
          reason: 'past_max_age',
          age_days: ageDays,
          severity,
          score: scoreFor(severity, ageDays),
          owner_id: null,
          resolved: false,
        })
      }
    }

    // 3. old_copies_live — unrotated copies of this secret still present
    const unrotated = unrotatedBySecret.get(s.id) ?? 0
    if (unrotated > 0) {
      const severity = unrotated >= 3 ? 'high' : unrotated >= 2 ? 'medium' : 'low'
      const ageDays = daysBetween(s.last_rotated_at ?? s.created_at, now)
      inserts.push({
        user_id: userId,
        secret_id: s.id,
        reason: 'old_copies_live',
        age_days: ageDays,
        severity,
        score: scoreFor(severity, ageDays) + unrotated * 2,
        owner_id: null,
        resolved: false,
      })
    }
  }

  let entries: Array<typeof rotation_debt.$inferSelect> = []
  if (inserts.length > 0) {
    entries = await db.insert(rotation_debt).values(inserts).returning()
  }

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'recompute',
    entity_type: 'rotation_debt',
    entity_id: null,
    detail: { count: entries.length },
  })

  return c.json({ entries })
})

// ---------------------------------------------------------------------------
// PUT /:id/resolve — mark a debt entry resolved
// ---------------------------------------------------------------------------
router.put('/:id/resolve', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(rotation_debt).where(eq(rotation_debt.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(rotation_debt)
    .set({ resolved: true })
    .where(eq(rotation_debt.id, id))
    .returning()

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'resolve',
    entity_type: 'rotation_debt',
    entity_id: id,
    detail: { reason: existing.reason },
  })

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// GET /summary — debt totals by reason/owner + trend
// ---------------------------------------------------------------------------
router.get('/summary', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(rotation_debt)
    .where(and(eq(rotation_debt.user_id, userId), eq(rotation_debt.resolved, false)))

  const ownerRows = await db.select().from(owners).where(eq(owners.user_id, userId))
  const ownerNames = new Map(ownerRows.map((o) => [o.id, o.name]))

  const byReason: Record<string, { count: number; score: number }> = {}
  const byOwner: Record<string, { owner_id: string | null; owner_name: string; count: number; score: number }> = {}
  let totalScore = 0

  for (const r of rows) {
    const score = r.score ?? 0
    totalScore += score

    byReason[r.reason] = byReason[r.reason] ?? { count: 0, score: 0 }
    byReason[r.reason].count += 1
    byReason[r.reason].score = Number((byReason[r.reason].score + score).toFixed(2))

    const ownerKey = r.owner_id ?? 'unassigned'
    if (!byOwner[ownerKey]) {
      byOwner[ownerKey] = {
        owner_id: r.owner_id ?? null,
        owner_name: r.owner_id ? ownerNames.get(r.owner_id) ?? 'Unknown' : 'Unassigned',
        count: 0,
        score: 0,
      }
    }
    byOwner[ownerKey].count += 1
    byOwner[ownerKey].score = Number((byOwner[ownerKey].score + score).toFixed(2))
  }

  // Trend: resolved-over-time buckets (by day) of all debt entries for this user.
  const allRows = await db.select().from(rotation_debt).where(eq(rotation_debt.user_id, userId))
  const trendMap = new Map<string, { open: number; resolved: number }>()
  for (const r of allRows) {
    const day = new Date(r.created_at).toISOString().slice(0, 10)
    const bucket = trendMap.get(day) ?? { open: 0, resolved: 0 }
    if (r.resolved) bucket.resolved += 1
    else bucket.open += 1
    trendMap.set(day, bucket)
  }
  const trend = [...trendMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, ...v }))

  return c.json({
    by_reason: Object.entries(byReason).map(([reason, v]) => ({ reason, ...v })),
    by_owner: Object.values(byOwner),
    total_score: Number(totalScore.toFixed(2)),
    open_count: rows.length,
    trend,
  })
})

export default router
