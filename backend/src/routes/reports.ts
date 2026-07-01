import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  exposures,
  rotation_debt,
  blast_radius_snapshots,
  resources,
  secrets,
  reuse_clusters,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// All report endpoints require auth (caller-scoped analytics).
router.use('*', authMiddleware)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function minutesBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null
  const ms = b.getTime() - a.getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.round(ms / 60000)
}

// ---------------------------------------------------------------------------
// GET /exposure-history — exposure history + MTTC trend
//   history: every exposure with its lifecycle timestamps and computed MTTC.
//   mttc_trend: average mean-time-to-contain (minutes) bucketed by detection day.
// ---------------------------------------------------------------------------
router.get('/exposure-history', async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(exposures)
    .where(eq(exposures.user_id, userId))
    .orderBy(desc(exposures.detected_at))

  const history = rows.map((e) => {
    const mttc = minutesBetween(e.detected_at ?? null, e.contained_at ?? null)
    return {
      id: e.id,
      secret_id: e.secret_id,
      title: e.title,
      vector: e.vector,
      severity: e.severity,
      status: e.status,
      exposed_since: e.exposed_since,
      detected_at: e.detected_at,
      contained_at: e.contained_at,
      closed_at: e.closed_at,
      blast_radius_score: e.blast_radius_score ?? 0,
      mttc_minutes: mttc,
    }
  })

  // MTTC trend bucketed by detection day (only contained exposures contribute).
  const buckets = new Map<string, { total: number; count: number }>()
  for (const e of rows) {
    const mttc = minutesBetween(e.detected_at ?? null, e.contained_at ?? null)
    if (mttc === null || !e.detected_at) continue
    const key = dayKey(new Date(e.detected_at))
    const b = buckets.get(key) ?? { total: 0, count: 0 }
    b.total += mttc
    b.count += 1
    buckets.set(key, b)
  }
  const mttc_trend = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, b]) => ({
      day,
      avg_mttc_minutes: Math.round(b.total / b.count),
      contained: b.count,
    }))

  const contained = history.filter((h) => h.mttc_minutes !== null)
  const overallMttc =
    contained.length > 0
      ? Math.round(
          contained.reduce((s, h) => s + (h.mttc_minutes ?? 0), 0) / contained.length,
        )
      : null

  return c.json({
    history,
    mttc_trend,
    summary: {
      total: history.length,
      open: history.filter((h) => h.status === 'detected' || h.status === 'analyzing').length,
      contained: history.filter((h) => h.status === 'contained').length,
      closed: history.filter((h) => h.status === 'closed').length,
      overall_mttc_minutes: overallMttc,
    },
  })
})

// ---------------------------------------------------------------------------
// GET /debt-trend — rotation-debt trend over time
//   Buckets unresolved + resolved debt entries by creation day, tracking the
//   running open debt count and cumulative score.
// ---------------------------------------------------------------------------
router.get('/debt-trend', async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(rotation_debt)
    .where(eq(rotation_debt.user_id, userId))
    .orderBy(rotation_debt.created_at)

  const buckets = new Map<
    string,
    { opened: number; resolved: number; score: number }
  >()
  for (const d of rows) {
    const key = dayKey(new Date(d.created_at))
    const b = buckets.get(key) ?? { opened: 0, resolved: 0, score: 0 }
    b.opened += 1
    if (d.resolved) b.resolved += 1
    b.score += d.score ?? 0
    buckets.set(key, b)
  }

  let runningOpen = 0
  const trend = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, b]) => {
      runningOpen += b.opened - b.resolved
      return {
        day,
        opened: b.opened,
        resolved: b.resolved,
        open_balance: runningOpen,
        score: Math.round(b.score * 100) / 100,
      }
    })

  const openEntries = rows.filter((d) => !d.resolved)
  return c.json({
    trend,
    summary: {
      total_entries: rows.length,
      open: openEntries.length,
      resolved: rows.length - openEntries.length,
      open_score: Math.round(openEntries.reduce((s, d) => s + (d.score ?? 0), 0) * 100) / 100,
    },
  })
})

// ---------------------------------------------------------------------------
// GET /crown-jewels — top reachable crown-jewel resources
//   Aggregates blast-radius snapshots: which crown-jewel / high-sensitivity
//   resources appear most across the reachable sets, and at what min depth.
// ---------------------------------------------------------------------------
router.get('/crown-jewels', async (c) => {
  const userId = getUserId(c)

  const snaps = await db
    .select()
    .from(blast_radius_snapshots)
    .where(eq(blast_radius_snapshots.user_id, userId))
    .orderBy(desc(blast_radius_snapshots.created_at))

  // resource_id -> aggregate
  const agg = new Map<
    string,
    {
      resource_id: string
      name: string
      sensitivity: string
      type: string | null
      environment: string | null
      exposure_count: number
      reachable_count: number
      min_depth: number
      max_score: number
      blast_radius_score: number
    }
  >()

  // Resolve type/environment fresh from the resources table rather than the
  // (possibly stale, historically type/environment-less) snapshot JSON.
  const allResources = await db.select().from(resources).where(eq(resources.user_id, userId))
  const resourceById = new Map(allResources.map((r) => [r.id, r]))

  for (const s of snaps) {
    const reachable = (s.reachable_resources ?? []) as Array<{
      resource_id: string
      name: string
      sensitivity: string
      depth: number
      path: string[]
    }>
    for (const r of reachable) {
      // Crown jewels and PII/confidential resources are the assets that matter.
      if (!['crown_jewel', 'pii', 'confidential'].includes(r.sensitivity)) continue
      const resourceInfo = resourceById.get(r.resource_id)
      const prev = agg.get(r.resource_id)
      if (prev) {
        prev.exposure_count += 1
        prev.reachable_count += 1
        prev.min_depth = Math.min(prev.min_depth, r.depth)
        prev.max_score = Math.max(prev.max_score, s.score ?? 0)
        prev.blast_radius_score = prev.max_score
      } else {
        agg.set(r.resource_id, {
          resource_id: r.resource_id,
          name: r.name,
          sensitivity: r.sensitivity,
          type: resourceInfo?.type ?? null,
          environment: resourceInfo?.environment ?? null,
          exposure_count: 1,
          reachable_count: 1,
          min_depth: r.depth,
          max_score: s.score ?? 0,
          blast_radius_score: s.score ?? 0,
        })
      }
    }
  }

  // Always include the user's standing crown-jewel inventory even if never
  // reached, so the report doubles as a coverage view.
  const crownInventory = await db
    .select()
    .from(resources)
    .where(and(eq(resources.user_id, userId), eq(resources.sensitivity, 'crown_jewel')))

  for (const r of crownInventory) {
    if (!agg.has(r.id)) {
      agg.set(r.id, {
        resource_id: r.id,
        name: r.name,
        sensitivity: r.sensitivity,
        type: r.type ?? null,
        environment: r.environment ?? null,
        exposure_count: 0,
        reachable_count: 0,
        min_depth: -1,
        max_score: 0,
        blast_radius_score: 0,
      })
    }
  }

  const list = [...agg.values()].sort((a, b) => {
    if (b.exposure_count !== a.exposure_count) return b.exposure_count - a.exposure_count
    return b.max_score - a.max_score
  })

  return c.json({
    resources: list,
    summary: {
      crown_jewels_total: crownInventory.length,
      reached: list.filter((r) => r.exposure_count > 0).length,
    },
  })
})

// ---------------------------------------------------------------------------
// GET /posture — insurer-renewal posture report
//   A single rolled-up posture snapshot suitable for a cyber-insurance renewal:
//   exposure containment record, MTTC, rotation hygiene, reuse risk, and
//   crown-jewel reachability — plus a derived posture grade.
// ---------------------------------------------------------------------------
router.get('/posture', async (c) => {
  const userId = getUserId(c)

  const [allExposures, allDebt, allSecrets, clusters, snaps] = await Promise.all([
    db.select().from(exposures).where(eq(exposures.user_id, userId)),
    db.select().from(rotation_debt).where(eq(rotation_debt.user_id, userId)),
    db.select().from(secrets).where(eq(secrets.user_id, userId)),
    db.select().from(reuse_clusters).where(eq(reuse_clusters.user_id, userId)),
    db.select().from(blast_radius_snapshots).where(eq(blast_radius_snapshots.user_id, userId)),
  ])

  const contained = allExposures.filter(
    (e) => e.status === 'contained' || e.status === 'closed',
  )
  const mttcValues = allExposures
    .map((e) => minutesBetween(e.detected_at ?? null, e.contained_at ?? null))
    .filter((m): m is number => m !== null)
  const avgMttc =
    mttcValues.length > 0
      ? Math.round(mttcValues.reduce((s, m) => s + m, 0) / mttcValues.length)
      : null
  const containmentRate =
    allExposures.length > 0
      ? Math.round((contained.length / allExposures.length) * 100)
      : 100

  const openExposures = allExposures.filter(
    (e) => e.status === 'detected' || e.status === 'analyzing',
  ).length

  const openDebt = allDebt.filter((d) => !d.resolved)
  const debtScore = Math.round(openDebt.reduce((s, d) => s + (d.score ?? 0), 0) * 100) / 100
  const compromised = allSecrets.filter((s) => s.status === 'compromised').length

  const highRiskClusters = clusters.filter((cl) => (cl.risk_score ?? 0) >= 50).length
  const reusedSecrets = clusters.reduce((s, cl) => s + (cl.secret_count ?? 0), 0)

  const crownReachable = new Set<string>()
  for (const s of snaps) {
    const reachable = (s.reachable_resources ?? []) as Array<{
      resource_id: string
      sensitivity: string
    }>
    for (const r of reachable) {
      if (r.sensitivity === 'crown_jewel') crownReachable.add(r.resource_id)
    }
  }

  // Derive a simple insurer-facing grade out of 100.
  let grade = 100
  grade -= openExposures * 8
  grade -= compromised * 6
  grade -= Math.min(20, openDebt.length * 2)
  grade -= Math.min(15, highRiskClusters * 5)
  grade -= Math.min(20, crownReachable.size * 4)
  if (avgMttc !== null && avgMttc > 240) grade -= 10
  grade = Math.max(0, Math.min(100, grade))

  const letter =
    grade >= 90 ? 'A' : grade >= 80 ? 'B' : grade >= 70 ? 'C' : grade >= 60 ? 'D' : 'F'

  const posture = {
    grade,
    letter,
    generated_at: new Date().toISOString(),
    exposures: {
      total: allExposures.length,
      open: openExposures,
      contained: contained.length,
      containment_rate_pct: containmentRate,
      avg_mttc_minutes: avgMttc,
    },
    secrets: {
      total: allSecrets.length,
      compromised,
      critical: allSecrets.filter((s) => s.criticality === 'critical').length,
    },
    rotation_debt: {
      open_entries: openDebt.length,
      open_score: debtScore,
    },
    reuse_risk: {
      clusters: clusters.length,
      high_risk_clusters: highRiskClusters,
      reused_secrets: reusedSecrets,
    },
    crown_jewels: {
      reachable: crownReachable.size,
    },
    attestations: [
      {
        control: 'Secret inventory maintained',
        met: allSecrets.length > 0,
      },
      {
        control: 'No outstanding compromised secrets',
        met: compromised === 0,
      },
      {
        control: 'All exposures contained',
        met: openExposures === 0,
      },
      {
        control: 'Rotation debt under control',
        met: openDebt.length <= 5,
      },
      {
        control: 'No high-risk secret reuse',
        met: highRiskClusters === 0,
      },
    ],
  }

  return c.json({ posture })
})

export default router
