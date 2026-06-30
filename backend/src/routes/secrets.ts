import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  secrets,
  grant_edges,
  secret_copies,
  reuse_clusters,
  stores,
  resources,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const secretSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    'api_key',
    'db_password',
    'oauth_token',
    'service_account',
    'ssh_key',
    'signing_key',
    'webhook_secret',
    'tls_key',
    'pat',
  ]),
  owning_service: z.string().optional(),
  environment: z.enum(['prod', 'staging', 'dev']).optional().default('prod'),
  criticality: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  fingerprint: z.string().optional(),
  last_four: z.string().optional(),
  status: z.enum(['active', 'rotating', 'retired', 'compromised']).optional().default('active'),
  max_age_days: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional().default([]),
  scopes: z.array(z.string()).optional().default([]),
})

// Deterministic fingerprint when not provided: hash of value-shaped fields.
async function deriveFingerprint(seed: string): Promise<string> {
  const data = new TextEncoder().encode(seed)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

// Link a secret to a reuse cluster keyed by fingerprint; create/update counts.
async function linkReuseCluster(userId: string, fingerprint: string): Promise<string | null> {
  if (!fingerprint) return null
  const sharing = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.user_id, userId), eq(secrets.fingerprint, fingerprint)))
  const count = sharing.length
  const [existing] = await db
    .select()
    .from(reuse_clusters)
    .where(and(eq(reuse_clusters.user_id, userId), eq(reuse_clusters.fingerprint, fingerprint)))
  const risk = count <= 1 ? 0 : Math.min(100, count * 18)
  if (existing) {
    await db
      .update(reuse_clusters)
      .set({ secret_count: count, risk_score: risk })
      .where(eq(reuse_clusters.id, existing.id))
    return existing.id
  }
  const [created] = await db
    .insert(reuse_clusters)
    .values({ user_id: userId, fingerprint, secret_count: count, risk_score: risk })
    .returning()
  return created.id
}

// GET / — list caller's secrets, filterable by type/env/criticality/status
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const { type, environment, criticality, status } = c.req.query()
  const conds = [eq(secrets.user_id, userId)]
  if (type) conds.push(eq(secrets.type, type))
  if (environment) conds.push(eq(secrets.environment, environment))
  if (criticality) conds.push(eq(secrets.criticality, criticality))
  if (status) conds.push(eq(secrets.status, status))
  const rows = await db
    .select()
    .from(secrets)
    .where(and(...conds))
    .orderBy(desc(secrets.created_at))
  return c.json(rows)
})

// GET /:id — secret detail incl grants, copies, reuse cluster
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [secret] = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, id), eq(secrets.user_id, userId)))
  if (!secret) return c.json({ error: 'Not found' }, 404)

  const grants = await db
    .select({
      id: grant_edges.id,
      secret_id: grant_edges.secret_id,
      resource_id: grant_edges.resource_id,
      permission: grant_edges.permission,
      scope: grant_edges.scope,
      confidence: grant_edges.confidence,
      created_at: grant_edges.created_at,
      resource_name: resources.name,
      resource_type: resources.type,
      resource_sensitivity: resources.sensitivity,
    })
    .from(grant_edges)
    .leftJoin(resources, eq(grant_edges.resource_id, resources.id))
    .where(and(eq(grant_edges.secret_id, id), eq(grant_edges.user_id, userId)))

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
    })
    .from(secret_copies)
    .leftJoin(stores, eq(secret_copies.store_id, stores.id))
    .where(and(eq(secret_copies.secret_id, id), eq(secret_copies.user_id, userId)))

  let reuse = null
  if (secret.reuse_cluster_id) {
    const [cluster] = await db
      .select()
      .from(reuse_clusters)
      .where(eq(reuse_clusters.id, secret.reuse_cluster_id))
    reuse = cluster ?? null
  }

  return c.json({ secret, grants, copies, reuse })
})

// POST / — create secret (derives fingerprint, links reuse cluster)
router.post('/', authMiddleware, zValidator('json', secretSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const fingerprint =
    body.fingerprint ?? (await deriveFingerprint(`${userId}:${body.name}:${body.type}:${body.owning_service ?? ''}`))
  const [created] = await db
    .insert(secrets)
    .values({ ...body, fingerprint, user_id: userId })
    .returning()
  const clusterId = await linkReuseCluster(userId, fingerprint)
  if (clusterId) {
    await db.update(secrets).set({ reuse_cluster_id: clusterId }).where(eq(secrets.id, created.id))
    created.reuse_cluster_id = clusterId
  }
  return c.json(created, 201)
})

// PUT /:id — update secret (auth + owner)
router.put('/:id', authMiddleware, zValidator('json', secretSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(secrets).where(eq(secrets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db.update(secrets).set(body).where(eq(secrets.id, id)).returning()
  if (body.fingerprint && body.fingerprint !== existing.fingerprint) {
    const clusterId = await linkReuseCluster(userId, body.fingerprint)
    if (clusterId) {
      await db.update(secrets).set({ reuse_cluster_id: clusterId }).where(eq(secrets.id, id))
      updated.reuse_cluster_id = clusterId
    }
  }
  return c.json(updated)
})

// DELETE /:id — delete secret (auth + owner)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(secrets).where(eq(secrets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(grant_edges).where(eq(grant_edges.secret_id, id))
  await db.delete(secret_copies).where(eq(secret_copies.secret_id, id))
  await db.delete(secrets).where(eq(secrets.id, id))
  return c.json({ success: true })
})

// POST /:id/rotate — mark rotated (sets last_rotated_at, status), marks copies rotated
router.post('/:id/rotate', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(secrets).where(eq(secrets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const now = new Date()
  const [updated] = await db
    .update(secrets)
    .set({ last_rotated_at: now, status: 'active' })
    .where(eq(secrets.id, id))
    .returning()
  await db
    .update(secret_copies)
    .set({ rotated: true, last_seen_at: now })
    .where(and(eq(secret_copies.secret_id, id), eq(secret_copies.user_id, userId)))
  return c.json(updated)
})

export default router
