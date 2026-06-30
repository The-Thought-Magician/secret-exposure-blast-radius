import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  owners,
  stores,
  secrets,
  resources,
  grant_edges,
  secret_copies,
} from './db/schema.js'
import { eq } from 'drizzle-orm'

import secretsRoutes from './routes/secrets.js'
import storesRoutes from './routes/stores.js'
import copiesRoutes from './routes/copies.js'
import resourcesRoutes from './routes/resources.js'
import grantsRoutes from './routes/grants.js'
import blastRadiusRoutes from './routes/blastRadius.js'
import exposuresRoutes from './routes/exposures.js'
import timelineRoutes from './routes/timeline.js'
import accessLogsRoutes from './routes/accessLogs.js'
import runbooksRoutes from './routes/runbooks.js'
import reuseRoutes from './routes/reuse.js'
import policiesRoutes from './routes/policies.js'
import debtRoutes from './routes/debt.js'
import evidenceRoutes from './routes/evidence.js'
import simulationsRoutes from './routes/simulations.js'
import ownersRoutes from './routes/owners.js'
import notificationsRoutes from './routes/notifications.js'
import dashboardRoutes from './routes/dashboard.js'
import reportsRoutes from './routes/reports.js'
import auditRoutes from './routes/audit.js'
import seedRoutes from './routes/seed.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://secret-exposure-blast-radius.vercel.app',
]

app.use('*', cors({
  origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
  credentials: true,
}))

const api = new Hono()
api.route('/secrets', secretsRoutes)
api.route('/stores', storesRoutes)
api.route('/copies', copiesRoutes)
api.route('/resources', resourcesRoutes)
api.route('/grants', grantsRoutes)
api.route('/blast-radius', blastRadiusRoutes)
api.route('/exposures', exposuresRoutes)
api.route('/timeline', timelineRoutes)
api.route('/access-logs', accessLogsRoutes)
api.route('/runbooks', runbooksRoutes)
api.route('/reuse', reuseRoutes)
api.route('/policies', policiesRoutes)
api.route('/debt', debtRoutes)
api.route('/evidence', evidenceRoutes)
api.route('/simulations', simulationsRoutes)
api.route('/owners', ownersRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/dashboard', dashboardRoutes)
api.route('/reports', reportsRoutes)
api.route('/audit', auditRoutes)
api.route('/seed', seedRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

const DEMO_USER = 'demo-user'

// Idempotent: count-then-insert. Seeds the billing plans plus a small demo
// graph (owner, store, secret, resource, copy, grant) for the demo user.
async function seedIfEmpty() {
  // Plans
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 4900 },
    ]).onConflictDoNothing()
    console.log('Seeded plans')
  }

  // Demo graph (only if the demo user has no secrets yet)
  const existingDemo = await db.select().from(secrets).where(eq(secrets.user_id, DEMO_USER)).limit(1)
  if (existingDemo.length === 0) {
    const [owner] = await db.insert(owners).values({
      user_id: DEMO_USER,
      name: 'Platform Team',
      email: 'platform@example.com',
      team: 'Platform',
      escalation_contact: 'oncall@example.com',
    }).returning()

    const [store] = await db.insert(stores).values({
      user_id: DEMO_USER,
      name: 'Production Vault',
      type: 'vault',
      location: 'vault.internal',
      owner_id: owner.id,
      scan_cadence: 'daily',
    }).returning()

    const [secret] = await db.insert(secrets).values({
      user_id: DEMO_USER,
      name: 'payments-db-password',
      type: 'db_password',
      owning_service: 'payments',
      environment: 'prod',
      criticality: 'critical',
      fingerprint: 'fp-demo-payments',
      last_four: '8f2a',
      status: 'active',
      max_age_days: 90,
    }).returning()

    const [resource] = await db.insert(resources).values({
      user_id: DEMO_USER,
      name: 'payments-postgres',
      type: 'database',
      sensitivity: 'crown_jewel',
      environment: 'prod',
      owner_id: owner.id,
    }).returning()

    await db.insert(secret_copies).values({
      user_id: DEMO_USER,
      secret_id: secret.id,
      store_id: store.id,
      rotated: false,
      last_seen_at: new Date(),
    }).onConflictDoNothing()

    await db.insert(grant_edges).values({
      user_id: DEMO_USER,
      secret_id: secret.id,
      resource_id: resource.id,
      permission: 'admin',
      scope: 'full',
      confidence: 'confirmed',
    }).onConflictDoNothing()

    console.log('Seeded demo graph')
  }
}

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, THEN run migrate() + seedIfEmpty() (both idempotent)
// each in its own try/catch. Never await DB work before serve().
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

try {
  await migrate()
} catch (e) {
  console.error('Migration error:', e)
}

try {
  await seedIfEmpty()
} catch (e) {
  console.error('Seed error:', e)
}

export default app
