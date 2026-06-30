import { db } from './index.js'
import { sql } from 'drizzle-orm'

// Self-provisions the schema on a fresh Neon DB. Each statement is idempotent.
// DDL column names/types MUST match schema.ts exactly.
const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS owners (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    email text,
    team text,
    escalation_contact text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS stores (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    location text,
    owner_id text REFERENCES owners(id),
    scan_cadence text,
    last_scanned_at timestamptz,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS secrets (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    owning_service text,
    environment text NOT NULL DEFAULT 'prod',
    criticality text NOT NULL DEFAULT 'medium',
    fingerprint text,
    last_four text,
    status text NOT NULL DEFAULT 'active',
    max_age_days integer,
    last_rotated_at timestamptz,
    reuse_cluster_id text,
    tags jsonb DEFAULT '[]'::jsonb,
    scopes jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS resources (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    sensitivity text NOT NULL DEFAULT 'internal',
    environment text NOT NULL DEFAULT 'prod',
    owner_id text REFERENCES owners(id),
    contains_secret_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS secret_copies (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    secret_id text NOT NULL REFERENCES secrets(id),
    store_id text NOT NULL REFERENCES stores(id),
    rotated boolean NOT NULL DEFAULT false,
    last_seen_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (secret_id, store_id)
  )`,

  `CREATE TABLE IF NOT EXISTS grant_edges (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    secret_id text NOT NULL REFERENCES secrets(id),
    resource_id text NOT NULL REFERENCES resources(id),
    permission text NOT NULL DEFAULT 'read',
    scope text,
    confidence text NOT NULL DEFAULT 'confirmed',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (secret_id, resource_id)
  )`,

  `CREATE TABLE IF NOT EXISTS resource_owners (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    resource_id text REFERENCES resources(id),
    store_id text REFERENCES stores(id),
    owner_id text NOT NULL REFERENCES owners(id),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS reuse_clusters (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    fingerprint text NOT NULL,
    secret_count integer NOT NULL DEFAULT 0,
    risk_score real DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS exposures (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    secret_id text NOT NULL REFERENCES secrets(id),
    title text NOT NULL,
    vector text NOT NULL,
    severity text NOT NULL DEFAULT 'medium',
    status text NOT NULL DEFAULT 'detected',
    exposed_since timestamptz,
    detected_at timestamptz NOT NULL DEFAULT now(),
    contained_at timestamptz,
    closed_at timestamptz,
    blast_radius_score real DEFAULT 0,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS blast_radius_snapshots (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    exposure_id text NOT NULL REFERENCES exposures(id),
    secret_id text NOT NULL REFERENCES secrets(id),
    score real DEFAULT 0,
    reachable_count integer DEFAULT 0,
    crown_jewel_count integer DEFAULT 0,
    max_depth integer DEFAULT 0,
    reachable_resources jsonb DEFAULT '[]'::jsonb,
    graph jsonb DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS timeline_events (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    exposure_id text NOT NULL REFERENCES exposures(id),
    kind text NOT NULL,
    description text NOT NULL,
    resource_id text REFERENCES resources(id),
    anomalous boolean NOT NULL DEFAULT false,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS access_logs (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    resource_id text REFERENCES resources(id),
    principal text NOT NULL,
    ip text,
    action text,
    anomalous boolean NOT NULL DEFAULT false,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS runbooks (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    exposure_id text NOT NULL REFERENCES exposures(id),
    title text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    total_tasks integer NOT NULL DEFAULT 0,
    verified_tasks integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS runbook_tasks (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    runbook_id text NOT NULL REFERENCES runbooks(id),
    kind text NOT NULL,
    description text NOT NULL,
    store_id text REFERENCES stores(id),
    resource_id text REFERENCES resources(id),
    owner_id text REFERENCES owners(id),
    status text NOT NULL DEFAULT 'pending',
    due_at timestamptz,
    completed_at timestamptz,
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS rotation_policies (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    applies_to_type text,
    applies_to_criticality text,
    max_age_days integer NOT NULL,
    grace_days integer NOT NULL DEFAULT 0,
    escalation_days integer,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS rotation_debt (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    secret_id text NOT NULL REFERENCES secrets(id),
    reason text NOT NULL,
    age_days integer,
    severity text NOT NULL DEFAULT 'medium',
    score real DEFAULT 0,
    owner_id text REFERENCES owners(id),
    resolved boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS evidence_records (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    exposure_id text NOT NULL REFERENCES exposures(id),
    content_hash text NOT NULL,
    mttc_minutes integer,
    completeness_pct real DEFAULT 0,
    payload jsonb DEFAULT '{}'::jsonb,
    signed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS simulations (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    secret_id text REFERENCES secrets(id),
    template text NOT NULL,
    status text NOT NULL DEFAULT 'running',
    blast_radius_score real DEFAULT 0,
    time_to_contain_minutes integer,
    tasks_completed integer DEFAULT 0,
    total_tasks integer DEFAULT 0,
    score real DEFAULT 0,
    result jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free',
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // Indexes on FKs / user_id for query performance
  `CREATE INDEX IF NOT EXISTS idx_stores_user_id ON stores(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stores_owner_id ON stores(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_secrets_user_id ON secrets(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_secrets_fingerprint ON secrets(fingerprint)`,
  `CREATE INDEX IF NOT EXISTS idx_resources_user_id ON resources(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_resources_owner_id ON resources(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_secret_copies_secret_id ON secret_copies(secret_id)`,
  `CREATE INDEX IF NOT EXISTS idx_secret_copies_store_id ON secret_copies(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_grant_edges_secret_id ON grant_edges(secret_id)`,
  `CREATE INDEX IF NOT EXISTS idx_grant_edges_resource_id ON grant_edges(resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_resource_owners_resource_id ON resource_owners(resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_resource_owners_store_id ON resource_owners(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exposures_user_id ON exposures(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exposures_secret_id ON exposures(secret_id)`,
  `CREATE INDEX IF NOT EXISTS idx_blast_radius_snapshots_exposure_id ON blast_radius_snapshots(exposure_id)`,
  `CREATE INDEX IF NOT EXISTS idx_timeline_events_exposure_id ON timeline_events(exposure_id)`,
  `CREATE INDEX IF NOT EXISTS idx_access_logs_resource_id ON access_logs(resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runbooks_exposure_id ON runbooks(exposure_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runbook_tasks_runbook_id ON runbook_tasks(runbook_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runbook_tasks_owner_id ON runbook_tasks(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rotation_policies_user_id ON rotation_policies(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rotation_debt_secret_id ON rotation_debt(secret_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rotation_debt_owner_id ON rotation_debt(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_records_exposure_id ON evidence_records(exposure_id)`,
  `CREATE INDEX IF NOT EXISTS idx_simulations_user_id ON simulations(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reuse_clusters_user_id ON reuse_clusters(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  console.log('Migration complete: provisioned', statements.length, 'statements')
}
