import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  owners,
  stores,
  secrets,
  resources,
  secret_copies,
  grant_edges,
  resource_owners,
  reuse_clusters,
  exposures,
  blast_radius_snapshots,
  timeline_events,
  access_logs,
  runbooks,
  runbook_tasks,
  rotation_policies,
  rotation_debt,
  evidence_records,
  simulations,
  notifications,
  audit_log,
} from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

router.use('*', authMiddleware)

const DAY = 86_400_000

// ---------------------------------------------------------------------------
// POST / — seed a coherent sample dataset for the caller.
//   Builds owners → stores → secrets → resources → grants → copies, a reuse
//   cluster, a rotation policy + debt entry, then a full sample exposure with
//   a computed blast-radius snapshot, an auto-generated runbook + tasks, a
//   reconstructed timeline, access logs, and a notification.
// ---------------------------------------------------------------------------
router.post('/', async (c) => {
  const userId = getUserId(c)
  const now = Date.now()

  // --- Owners -------------------------------------------------------------
  const [platformOwner] = await db
    .insert(owners)
    .values({
      user_id: userId,
      name: 'Platform Team',
      email: 'platform@example.com',
      team: 'Platform',
      escalation_contact: 'oncall-platform@example.com',
    })
    .returning()
  const [dataOwner] = await db
    .insert(owners)
    .values({
      user_id: userId,
      name: 'Data Team',
      email: 'data@example.com',
      team: 'Data',
      escalation_contact: 'oncall-data@example.com',
    })
    .returning()

  // --- Stores -------------------------------------------------------------
  const [vault] = await db
    .insert(stores)
    .values({
      user_id: userId,
      name: 'HashiCorp Vault (prod)',
      type: 'vault',
      location: 'vault.internal:8200',
      owner_id: platformOwner.id,
      scan_cadence: 'daily',
      last_scanned_at: new Date(now - 1 * DAY),
      metadata: { region: 'us-east-1' },
    })
    .returning()
  const [ciStore] = await db
    .insert(stores)
    .values({
      user_id: userId,
      name: 'GitHub Actions Secrets',
      type: 'ci_variable',
      location: 'github.com/acme',
      owner_id: platformOwner.id,
      scan_cadence: 'weekly',
      last_scanned_at: new Date(now - 9 * DAY),
      metadata: {},
    })
    .returning()
  const [envFile] = await db
    .insert(stores)
    .values({
      user_id: userId,
      name: 'Legacy .env on bastion',
      type: 'env_file',
      location: '/opt/app/.env',
      owner_id: dataOwner.id,
      scan_cadence: 'manual',
      last_scanned_at: new Date(now - 45 * DAY),
      metadata: { note: 'pending decommission' },
    })
    .returning()

  // --- Reuse cluster (two secrets share a fingerprint) --------------------
  const sharedFingerprint = 'fp_' + 'a1b2c3d4e5f6'
  const [cluster] = await db
    .insert(reuse_clusters)
    .values({
      user_id: userId,
      fingerprint: sharedFingerprint,
      secret_count: 2,
      risk_score: 72,
    })
    .returning()

  // --- Secrets ------------------------------------------------------------
  const [dbPassword] = await db
    .insert(secrets)
    .values({
      user_id: userId,
      name: 'prod-postgres-password',
      type: 'db_password',
      owning_service: 'payments-api',
      environment: 'prod',
      criticality: 'critical',
      fingerprint: sharedFingerprint,
      last_four: 'a91f',
      status: 'active',
      max_age_days: 90,
      last_rotated_at: new Date(now - 140 * DAY), // overdue
      reuse_cluster_id: cluster.id,
      tags: ['database', 'pci'],
      scopes: ['db:read', 'db:write'],
    })
    .returning()
  const [stagingPassword] = await db
    .insert(secrets)
    .values({
      user_id: userId,
      name: 'staging-postgres-password',
      type: 'db_password',
      owning_service: 'payments-api',
      environment: 'staging',
      criticality: 'medium',
      fingerprint: sharedFingerprint, // reused value!
      last_four: 'a91f',
      status: 'active',
      max_age_days: 90,
      last_rotated_at: new Date(now - 30 * DAY),
      reuse_cluster_id: cluster.id,
      tags: ['database'],
      scopes: ['db:read', 'db:write'],
    })
    .returning()
  const [stripeKey] = await db
    .insert(secrets)
    .values({
      user_id: userId,
      name: 'stripe-live-secret-key',
      type: 'api_key',
      owning_service: 'payments-api',
      environment: 'prod',
      criticality: 'critical',
      fingerprint: 'fp_stripe_9z8y7x',
      last_four: 'k3p9',
      status: 'active',
      max_age_days: 180,
      last_rotated_at: null, // never rotated
      tags: ['payments'],
      scopes: ['charges:write'],
    })
    .returning()

  // --- Resources (graph nodes) -------------------------------------------
  const [primaryDb] = await db
    .insert(resources)
    .values({
      user_id: userId,
      name: 'payments-primary-db',
      type: 'database',
      sensitivity: 'crown_jewel',
      environment: 'prod',
      owner_id: dataOwner.id,
      metadata: { engine: 'postgres' },
    })
    .returning()
  const [piiBucket] = await db
    .insert(resources)
    .values({
      user_id: userId,
      name: 'customer-pii-bucket',
      type: 's3_bucket',
      sensitivity: 'pii',
      environment: 'prod',
      owner_id: dataOwner.id,
      // This resource itself holds the stripe key (transitive chain).
      contains_secret_id: stripeKey.id,
      metadata: { region: 'us-east-1' },
    })
    .returning()
  const [stripeApi] = await db
    .insert(resources)
    .values({
      user_id: userId,
      name: 'Stripe Payments API',
      type: 'payment_api',
      sensitivity: 'crown_jewel',
      environment: 'prod',
      owner_id: platformOwner.id,
      metadata: {},
    })
    .returning()
  const [internalSvc] = await db
    .insert(resources)
    .values({
      user_id: userId,
      name: 'reporting-service',
      type: 'internal_service',
      sensitivity: 'internal',
      environment: 'prod',
      owner_id: platformOwner.id,
      metadata: {},
    })
    .returning()

  // --- resource_owners mappings ------------------------------------------
  await db.insert(resource_owners).values([
    { user_id: userId, resource_id: primaryDb.id, owner_id: dataOwner.id },
    { user_id: userId, resource_id: piiBucket.id, owner_id: dataOwner.id },
    { user_id: userId, resource_id: stripeApi.id, owner_id: platformOwner.id },
    { user_id: userId, store_id: vault.id, owner_id: platformOwner.id },
  ])

  // --- Grant edges (secret → resource) -----------------------------------
  await db.insert(grant_edges).values([
    {
      user_id: userId,
      secret_id: dbPassword.id,
      resource_id: primaryDb.id,
      permission: 'admin',
      scope: 'full',
      confidence: 'confirmed',
    },
    {
      user_id: userId,
      secret_id: dbPassword.id,
      resource_id: piiBucket.id,
      permission: 'read',
      scope: 'export',
      confidence: 'inferred',
    },
    {
      user_id: userId,
      secret_id: stripeKey.id,
      resource_id: stripeApi.id,
      permission: 'write',
      scope: 'charges',
      confidence: 'confirmed',
    },
    {
      user_id: userId,
      secret_id: stagingPassword.id,
      resource_id: internalSvc.id,
      permission: 'read',
      scope: null,
      confidence: 'confirmed',
    },
  ])

  // --- Secret copies (same secret in multiple stores) --------------------
  await db.insert(secret_copies).values([
    {
      user_id: userId,
      secret_id: dbPassword.id,
      store_id: vault.id,
      rotated: false,
      last_seen_at: new Date(now - 1 * DAY),
    },
    {
      user_id: userId,
      secret_id: dbPassword.id,
      store_id: ciStore.id,
      rotated: false,
      last_seen_at: new Date(now - 9 * DAY),
    },
    {
      user_id: userId,
      secret_id: dbPassword.id,
      store_id: envFile.id,
      rotated: false, // stale copy on legacy env file
      last_seen_at: new Date(now - 45 * DAY),
    },
    {
      user_id: userId,
      secret_id: stripeKey.id,
      store_id: vault.id,
      rotated: false,
      last_seen_at: new Date(now - 1 * DAY),
    },
  ])

  // --- Rotation policy + debt entries ------------------------------------
  await db.insert(rotation_policies).values({
    user_id: userId,
    name: 'Critical secrets: 90-day max age',
    applies_to_type: null,
    applies_to_criticality: 'critical',
    max_age_days: 90,
    grace_days: 7,
    escalation_days: 14,
  })

  await db.insert(rotation_debt).values([
    {
      user_id: userId,
      secret_id: dbPassword.id,
      reason: 'past_max_age',
      age_days: 140,
      severity: 'high',
      score: 88,
      owner_id: dataOwner.id,
      resolved: false,
    },
    {
      user_id: userId,
      secret_id: stripeKey.id,
      reason: 'never_rotated',
      age_days: null,
      severity: 'high',
      score: 80,
      owner_id: platformOwner.id,
      resolved: false,
    },
    {
      user_id: userId,
      secret_id: dbPassword.id,
      reason: 'old_copies_live',
      age_days: 45,
      severity: 'medium',
      score: 50,
      owner_id: platformOwner.id,
      resolved: false,
    },
  ])

  // --- Access logs (feed the timeline reconstruction) --------------------
  const exposedSince = new Date(now - 6 * DAY)
  const detectedAt = new Date(now - 2 * DAY)
  await db.insert(access_logs).values([
    {
      user_id: userId,
      resource_id: primaryDb.id,
      principal: 'svc-payments@prod',
      ip: '10.0.1.20',
      action: 'connect',
      anomalous: false,
      occurred_at: new Date(now - 5 * DAY),
    },
    {
      user_id: userId,
      resource_id: primaryDb.id,
      principal: 'unknown@45.13.x.x',
      ip: '45.13.99.7',
      action: 'bulk_export',
      anomalous: true,
      occurred_at: new Date(now - 4 * DAY),
    },
    {
      user_id: userId,
      resource_id: piiBucket.id,
      principal: 'unknown@45.13.x.x',
      ip: '45.13.99.7',
      action: 'list_objects',
      anomalous: true,
      occurred_at: new Date(now - 3 * DAY),
    },
    {
      user_id: userId,
      resource_id: stripeApi.id,
      principal: 'svc-payments@prod',
      ip: '10.0.1.20',
      action: 'create_charge',
      anomalous: false,
      occurred_at: new Date(now - 3.5 * DAY),
    },
  ])

  // --- Sample exposure ----------------------------------------------------
  // Compute a blast radius for dbPassword by BFS over grants + transitive
  // contains_secret_id so the snapshot is real.
  const reachable: Array<{
    resource_id: string
    name: string
    sensitivity: string
    depth: number
    path: string[]
  }> = []
  const graphNodes: Array<{ id: string; label: string; kind: string }> = [
    { id: dbPassword.id, label: dbPassword.name, kind: 'secret' },
  ]
  const graphEdges: Array<{ from: string; to: string; permission: string }> = []

  const directGrants = [
    { res: primaryDb, perm: 'admin', depth: 1 },
    { res: piiBucket, perm: 'read', depth: 1 },
  ]
  for (const g of directGrants) {
    reachable.push({
      resource_id: g.res.id,
      name: g.res.name,
      sensitivity: g.res.sensitivity,
      depth: g.depth,
      path: [dbPassword.id, g.res.id],
    })
    graphNodes.push({ id: g.res.id, label: g.res.name, kind: 'resource' })
    graphEdges.push({ from: dbPassword.id, to: g.res.id, permission: g.perm })
  }
  // Transitive: piiBucket contains stripeKey, which grants stripeApi.
  reachable.push({
    resource_id: stripeApi.id,
    name: stripeApi.name,
    sensitivity: stripeApi.sensitivity,
    depth: 2,
    path: [dbPassword.id, piiBucket.id, stripeKey.id, stripeApi.id],
  })
  graphNodes.push({ id: stripeKey.id, label: stripeKey.name, kind: 'secret' })
  graphNodes.push({ id: stripeApi.id, label: stripeApi.name, kind: 'resource' })
  graphEdges.push({ from: piiBucket.id, to: stripeKey.id, permission: 'contains' })
  graphEdges.push({ from: stripeKey.id, to: stripeApi.id, permission: 'write' })

  const crownJewelCount = reachable.filter((r) => r.sensitivity === 'crown_jewel').length
  const maxDepth = reachable.reduce((m, r) => Math.max(m, r.depth), 0)
  const blastScore =
    Math.round(
      (reachable.length * 10 + crownJewelCount * 25 + maxDepth * 5) * 10,
    ) / 10

  const [exposure] = await db
    .insert(exposures)
    .values({
      user_id: userId,
      secret_id: dbPassword.id,
      title: 'prod-postgres-password leaked in git commit',
      vector: 'git_commit',
      severity: 'critical',
      status: 'contained',
      exposed_since: exposedSince,
      detected_at: detectedAt,
      contained_at: new Date(now - 1.5 * DAY),
      blast_radius_score: blastScore,
      notes: 'Found hardcoded in a config file pushed to a public fork.',
    })
    .returning()

  await db.insert(blast_radius_snapshots).values({
    user_id: userId,
    exposure_id: exposure.id,
    secret_id: dbPassword.id,
    score: blastScore,
    reachable_count: reachable.length,
    crown_jewel_count: crownJewelCount,
    max_depth: maxDepth,
    reachable_resources: reachable,
    graph: { nodes: graphNodes, edges: graphEdges },
  })

  // --- Runbook + tasks ----------------------------------------------------
  const [runbook] = await db
    .insert(runbooks)
    .values({
      user_id: userId,
      exposure_id: exposure.id,
      title: 'Contain & rotate prod-postgres-password',
      status: 'in_progress',
      total_tasks: 4,
      verified_tasks: 2,
    })
    .returning()

  await db.insert(runbook_tasks).values([
    {
      user_id: userId,
      runbook_id: runbook.id,
      kind: 'rotate',
      description: 'Rotate prod-postgres-password in Vault',
      store_id: vault.id,
      owner_id: platformOwner.id,
      status: 'verified',
      completed_at: new Date(now - 1.6 * DAY),
      verified_at: new Date(now - 1.55 * DAY),
    },
    {
      user_id: userId,
      runbook_id: runbook.id,
      kind: 'rotate',
      description: 'Update GitHub Actions secret with new value',
      store_id: ciStore.id,
      owner_id: platformOwner.id,
      status: 'verified',
      completed_at: new Date(now - 1.55 * DAY),
      verified_at: new Date(now - 1.5 * DAY),
    },
    {
      user_id: userId,
      runbook_id: runbook.id,
      kind: 'revoke',
      description: 'Remove stale copy from legacy .env on bastion',
      store_id: envFile.id,
      owner_id: dataOwner.id,
      status: 'in_progress',
      due_at: new Date(now + 1 * DAY),
    },
    {
      user_id: userId,
      runbook_id: runbook.id,
      kind: 'verify',
      description: 'Confirm no anomalous access after rotation',
      resource_id: primaryDb.id,
      owner_id: dataOwner.id,
      status: 'pending',
      due_at: new Date(now + 2 * DAY),
    },
  ])

  // --- Timeline events ----------------------------------------------------
  await db.insert(timeline_events).values([
    {
      user_id: userId,
      exposure_id: exposure.id,
      kind: 'exposure_start',
      description: 'Secret first exposed via public git commit',
      anomalous: false,
      occurred_at: exposedSince,
    },
    {
      user_id: userId,
      exposure_id: exposure.id,
      kind: 'anomalous_access',
      description: 'Bulk export from payments-primary-db by unknown principal',
      resource_id: primaryDb.id,
      anomalous: true,
      occurred_at: new Date(now - 4 * DAY),
    },
    {
      user_id: userId,
      exposure_id: exposure.id,
      kind: 'anomalous_access',
      description: 'Unknown principal listed customer-pii-bucket objects',
      resource_id: piiBucket.id,
      anomalous: true,
      occurred_at: new Date(now - 3 * DAY),
    },
    {
      user_id: userId,
      exposure_id: exposure.id,
      kind: 'detection',
      description: 'Exposure detected by secret scanner',
      anomalous: false,
      occurred_at: detectedAt,
    },
    {
      user_id: userId,
      exposure_id: exposure.id,
      kind: 'containment',
      description: 'Secret rotated and CI store updated',
      anomalous: false,
      occurred_at: new Date(now - 1.5 * DAY),
    },
  ])

  // --- Notification -------------------------------------------------------
  await db.insert(notifications).values({
    user_id: userId,
    kind: 'exposure_declared',
    title: 'Critical exposure: prod-postgres-password',
    body: 'A critical secret was exposed via git commit. Blast radius computed.',
    link: `/dashboard/exposures/${exposure.id}`,
    read: false,
  })

  // --- Audit trail entry --------------------------------------------------
  await db.insert(audit_log).values({
    user_id: userId,
    actor: userId,
    action: 'seed',
    entity_type: 'dataset',
    entity_id: null,
    detail: { source: 'seed-endpoint' },
  })

  const counts = {
    owners: 2,
    stores: 3,
    secrets: 3,
    resources: 4,
    grants: 4,
    copies: 4,
    reuse_clusters: 1,
    policies: 1,
    debt: 3,
    access_logs: 4,
    exposures: 1,
    snapshots: 1,
    runbooks: 1,
    runbook_tasks: 4,
    timeline_events: 5,
    notifications: 1,
  }

  return c.json({ seeded: true, counts }, 201)
})

// ---------------------------------------------------------------------------
// DELETE / — clear ALL of the caller's data across every domain table,
//   deleted in FK-dependency order (children before parents).
// ---------------------------------------------------------------------------
router.delete('/', async (c) => {
  const userId = getUserId(c)

  // Order matters: delete rows that reference others first.
  await db.delete(evidence_records).where(eq(evidence_records.user_id, userId))
  await db.delete(blast_radius_snapshots).where(eq(blast_radius_snapshots.user_id, userId))
  await db.delete(timeline_events).where(eq(timeline_events.user_id, userId))
  await db.delete(runbook_tasks).where(eq(runbook_tasks.user_id, userId))
  await db.delete(runbooks).where(eq(runbooks.user_id, userId))
  await db.delete(exposures).where(eq(exposures.user_id, userId))
  await db.delete(simulations).where(eq(simulations.user_id, userId))
  await db.delete(rotation_debt).where(eq(rotation_debt.user_id, userId))
  await db.delete(rotation_policies).where(eq(rotation_policies.user_id, userId))
  await db.delete(access_logs).where(eq(access_logs.user_id, userId))
  await db.delete(secret_copies).where(eq(secret_copies.user_id, userId))
  await db.delete(grant_edges).where(eq(grant_edges.user_id, userId))
  await db.delete(resource_owners).where(eq(resource_owners.user_id, userId))
  await db.delete(resources).where(eq(resources.user_id, userId))
  await db.delete(secrets).where(eq(secrets.user_id, userId))
  await db.delete(reuse_clusters).where(eq(reuse_clusters.user_id, userId))
  await db.delete(stores).where(eq(stores.user_id, userId))
  await db.delete(owners).where(eq(owners.user_id, userId))
  await db.delete(notifications).where(eq(notifications.user_id, userId))
  await db.delete(audit_log).where(eq(audit_log.user_id, userId))

  return c.json({ cleared: true })
})

export default router
