import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  reuse_clusters,
  secrets,
  secret_copies,
  stores,
  audit_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Criticality weights feed the per-cluster risk score.
const CRIT_WEIGHT: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8,
}

// ---------------------------------------------------------------------------
// GET / — list clusters with member secrets + risk.
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)

  const clusters = await db
    .select()
    .from(reuse_clusters)
    .where(eq(reuse_clusters.user_id, userId))
    .orderBy(desc(reuse_clusters.risk_score))

  const out = []
  for (const cluster of clusters) {
    const members = await db
      .select()
      .from(secrets)
      .where(and(eq(secrets.user_id, userId), eq(secrets.reuse_cluster_id, cluster.id)))

    out.push({
      ...cluster,
      members,
      member_count: members.length,
    })
  }

  return c.json(out)
})

// ---------------------------------------------------------------------------
// GET /:id — cluster detail: all secrets sharing the fingerprint, with the
// stores/services each one lives in.
// ---------------------------------------------------------------------------
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [cluster] = await db
    .select()
    .from(reuse_clusters)
    .where(and(eq(reuse_clusters.id, id), eq(reuse_clusters.user_id, userId)))

  if (!cluster) return c.json({ error: 'Not found' }, 404)

  const members = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.user_id, userId), eq(secrets.reuse_cluster_id, id)))

  const enriched = []
  for (const secret of members) {
    const copies = await db
      .select({
        copy_id: secret_copies.id,
        store_id: secret_copies.store_id,
        store_name: stores.name,
        store_type: stores.type,
        rotated: secret_copies.rotated,
        last_seen_at: secret_copies.last_seen_at,
      })
      .from(secret_copies)
      .leftJoin(stores, eq(secret_copies.store_id, stores.id))
      .where(and(eq(secret_copies.user_id, userId), eq(secret_copies.secret_id, secret.id)))

    enriched.push({
      ...secret,
      owning_service: secret.owning_service,
      stores: copies,
    })
  }

  return c.json({ cluster, secrets: enriched })
})

// ---------------------------------------------------------------------------
// POST /recompute — rebuild clusters from secret fingerprints.
// Groups the caller's secrets by fingerprint; any fingerprint shared by >=2
// secrets becomes (or updates) a cluster. Each member's reuse_cluster_id is
// linked; secrets no longer in a multi-member group are unlinked. Stale
// clusters are removed.
// ---------------------------------------------------------------------------
router.post('/recompute', authMiddleware, async (c) => {
  const userId = getUserId(c)

  const allSecrets = await db
    .select()
    .from(secrets)
    .where(eq(secrets.user_id, userId))

  // Group by fingerprint (ignore null/empty fingerprints).
  const byFingerprint = new Map<string, typeof allSecrets>()
  for (const s of allSecrets) {
    const fp = s.fingerprint
    if (!fp) continue
    const arr = byFingerprint.get(fp) ?? []
    arr.push(s)
    byFingerprint.set(fp, arr)
  }

  const existingClusters = await db
    .select()
    .from(reuse_clusters)
    .where(eq(reuse_clusters.user_id, userId))
  const clusterByFingerprint = new Map(existingClusters.map((cl) => [cl.fingerprint, cl]))

  const liveFingerprints = new Set<string>()
  const resultClusters = []

  for (const [fingerprint, group] of byFingerprint) {
    if (group.length < 2) {
      // No longer a reuse cluster — unlink any members.
      for (const s of group) {
        if (s.reuse_cluster_id) {
          await db
            .update(secrets)
            .set({ reuse_cluster_id: null })
            .where(eq(secrets.id, s.id))
        }
      }
      continue
    }

    liveFingerprints.add(fingerprint)

    // Risk score: weighted by member criticality, scaled by member count and
    // by how many environments are spanned (prod blast is worse).
    const weightSum = group.reduce((acc, s) => acc + (CRIT_WEIGHT[s.criticality] ?? 2), 0)
    const envs = new Set(group.map((s) => s.environment))
    const hasProd = group.some((s) => s.environment === 'prod') ? 1.5 : 1
    const riskScore = Math.round(weightSum * group.length * envs.size * hasProd * 10) / 10

    let cluster = clusterByFingerprint.get(fingerprint)
    if (cluster) {
      const [updated] = await db
        .update(reuse_clusters)
        .set({ secret_count: group.length, risk_score: riskScore })
        .where(eq(reuse_clusters.id, cluster.id))
        .returning()
      cluster = updated
    } else {
      const [created] = await db
        .insert(reuse_clusters)
        .values({
          user_id: userId,
          fingerprint,
          secret_count: group.length,
          risk_score: riskScore,
        })
        .returning()
      cluster = created
    }

    // Link members to this cluster.
    for (const s of group) {
      if (s.reuse_cluster_id !== cluster.id) {
        await db
          .update(secrets)
          .set({ reuse_cluster_id: cluster.id })
          .where(eq(secrets.id, s.id))
      }
    }

    resultClusters.push({ ...cluster, member_count: group.length })
  }

  // Remove clusters whose fingerprint no longer has >=2 members.
  for (const cluster of existingClusters) {
    if (!liveFingerprints.has(cluster.fingerprint)) {
      await db
        .update(secrets)
        .set({ reuse_cluster_id: null })
        .where(and(eq(secrets.user_id, userId), eq(secrets.reuse_cluster_id, cluster.id)))
      await db.delete(reuse_clusters).where(eq(reuse_clusters.id, cluster.id))
    }
  }

  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'reuse_recompute',
    entity_type: 'reuse_cluster',
    entity_id: null,
    detail: { cluster_count: resultClusters.length },
  })

  resultClusters.sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))
  return c.json({ clusters: resultClusters })
})

export default router
