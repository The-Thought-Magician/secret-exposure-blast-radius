import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  exposures,
  runbooks,
  rotation_debt,
  reuse_clusters,
  blast_radius_snapshots,
  audit_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// GET / — posture summary for the caller
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)

  const allExposures = await db
    .select()
    .from(exposures)
    .where(eq(exposures.user_id, userId))

  // Open exposures = anything not yet closed.
  const openExposures = allExposures.filter((e) => e.status !== 'closed')
  const openByStatus = {
    detected: openExposures.filter((e) => e.status === 'detected').length,
    analyzing: openExposures.filter((e) => e.status === 'analyzing').length,
    contained: openExposures.filter((e) => e.status === 'contained').length,
  }
  const openBySeverity = {
    low: openExposures.filter((e) => e.severity === 'low').length,
    medium: openExposures.filter((e) => e.severity === 'medium').length,
    high: openExposures.filter((e) => e.severity === 'high').length,
    critical: openExposures.filter((e) => e.severity === 'critical').length,
  }

  // MTTC — mean time to contain (minutes) across exposures with a contained_at.
  const contained = allExposures.filter(
    (e) => e.contained_at && e.detected_at,
  )
  let mttcMinutes = 0
  if (contained.length > 0) {
    const total = contained.reduce((acc, e) => {
      const start = new Date(e.detected_at as unknown as string).getTime()
      const end = new Date(e.contained_at as unknown as string).getTime()
      const diff = end - start
      return acc + (diff > 0 ? diff : 0)
    }, 0)
    mttcMinutes = Math.round(total / contained.length / 60000)
  }

  // Containment progress — across open exposures' runbooks.
  const exposureIds = openExposures.map((e) => e.id)
  let totalTasks = 0
  let verifiedTasks = 0
  let runbooksComplete = 0
  let runbooksTotal = 0
  if (exposureIds.length > 0) {
    const rbs = await db
      .select()
      .from(runbooks)
      .where(eq(runbooks.user_id, userId))
    const openRbs = rbs.filter((r) => exposureIds.includes(r.exposure_id))
    runbooksTotal = openRbs.length
    for (const r of openRbs) {
      totalTasks += r.total_tasks ?? 0
      verifiedTasks += r.verified_tasks ?? 0
      if (r.status === 'complete') runbooksComplete += 1
    }
  }
  const containmentProgress = {
    runbooks_total: runbooksTotal,
    runbooks_complete: runbooksComplete,
    total_tasks: totalTasks,
    verified_tasks: verifiedTasks,
    pct: totalTasks > 0 ? Math.round((verifiedTasks / totalTasks) * 100) : 0,
  }

  // Debt summary.
  const debtRows = await db
    .select()
    .from(rotation_debt)
    .where(
      and(
        eq(rotation_debt.user_id, userId),
        eq(rotation_debt.resolved, false),
      ),
    )
  const debtByReason: Record<string, number> = {}
  let debtScore = 0
  for (const d of debtRows) {
    debtByReason[d.reason] = (debtByReason[d.reason] ?? 0) + 1
    debtScore += d.score ?? 0
  }
  const debt = {
    open_entries: debtRows.length,
    total_score: Math.round(debtScore * 100) / 100,
    by_reason: debtByReason,
    by_severity: {
      low: debtRows.filter((d) => d.severity === 'low').length,
      medium: debtRows.filter((d) => d.severity === 'medium').length,
      high: debtRows.filter((d) => d.severity === 'high').length,
      critical: debtRows.filter((d) => d.severity === 'critical').length,
    },
  }

  // Crown-jewel exposure — from snapshots tied to open exposures.
  const snapshots = await db
    .select()
    .from(blast_radius_snapshots)
    .where(eq(blast_radius_snapshots.user_id, userId))
  const openSnapshots = snapshots.filter((s) =>
    exposureIds.includes(s.exposure_id),
  )
  const crownJewelCount = openSnapshots.reduce(
    (acc, s) => acc + (s.crown_jewel_count ?? 0),
    0,
  )
  const maxBlastRadius = openSnapshots.reduce(
    (acc, s) => Math.max(acc, s.score ?? 0),
    0,
  )
  const topSnapshot = openSnapshots
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
  const crownJewels = {
    exposed_crown_jewel_count: crownJewelCount,
    max_blast_radius_score: Math.round(maxBlastRadius * 100) / 100,
    top_exposure_id: topSnapshot?.exposure_id ?? null,
  }

  // Reuse risk.
  const clusters = await db
    .select()
    .from(reuse_clusters)
    .where(eq(reuse_clusters.user_id, userId))
  const riskyClusters = clusters.filter((cl) => (cl.secret_count ?? 0) > 1)
  const reuseRisk = {
    cluster_count: clusters.length,
    risky_cluster_count: riskyClusters.length,
    reused_secret_count: riskyClusters.reduce(
      (acc, cl) => acc + (cl.secret_count ?? 0),
      0,
    ),
    max_risk_score:
      Math.round(
        clusters.reduce((acc, cl) => Math.max(acc, cl.risk_score ?? 0), 0) *
          100,
      ) / 100,
  }

  // Recent activity — latest audit-log entries.
  const recent = await db
    .select()
    .from(audit_log)
    .where(eq(audit_log.user_id, userId))
    .orderBy(desc(audit_log.created_at))
    .limit(10)

  return c.json({
    open_exposures: openExposures.length,
    open_by_status: openByStatus,
    open_by_severity: openBySeverity,
    mttc_minutes: mttcMinutes,
    containment_progress: containmentProgress,
    debt,
    crown_jewels: crownJewels,
    reuse_risk: reuseRisk,
    recent,
  })
})

export default router
