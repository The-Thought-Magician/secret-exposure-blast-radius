import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Owners — people/teams responsible for stores and resources
// ---------------------------------------------------------------------------
export const owners = pgTable('owners', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  email: text('email'),
  team: text('team'),
  escalation_contact: text('escalation_contact'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Stores — where secrets live (Vault, AWS SM, CI vars, env files, k8s, etc.)
// ---------------------------------------------------------------------------
export const stores = pgTable('stores', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(), // vault | aws_sm | gcp_sm | env_file | ci_variable | k8s_secret | onepassword | other
  location: text('location'),
  owner_id: text('owner_id').references(() => owners.id),
  scan_cadence: text('scan_cadence'), // daily | weekly | manual
  last_scanned_at: timestamp('last_scanned_at'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Secrets — the credential registry
// ---------------------------------------------------------------------------
export const secrets = pgTable('secrets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(), // api_key | db_password | oauth_token | service_account | ssh_key | signing_key | webhook_secret | tls_key | pat
  owning_service: text('owning_service'),
  environment: text('environment').notNull().default('prod'), // prod | staging | dev
  criticality: text('criticality').notNull().default('medium'), // low | medium | high | critical
  fingerprint: text('fingerprint'), // value-hash used for reuse detection
  last_four: text('last_four'),
  status: text('status').notNull().default('active'), // active | rotating | retired | compromised
  max_age_days: integer('max_age_days'),
  last_rotated_at: timestamp('last_rotated_at'),
  reuse_cluster_id: text('reuse_cluster_id'),
  tags: jsonb('tags').$type<string[]>().default([]),
  scopes: jsonb('scopes').$type<string[]>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Resources — protectable things a secret can reach (graph nodes)
// ---------------------------------------------------------------------------
export const resources = pgTable('resources', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(), // database | s3_bucket | payment_api | internal_service | queue | cloud_account | saas
  sensitivity: text('sensitivity').notNull().default('internal'), // public | internal | confidential | pii | crown_jewel
  environment: text('environment').notNull().default('prod'),
  owner_id: text('owner_id').references(() => owners.id),
  contains_secret_id: text('contains_secret_id'), // resource that itself holds another secret (transitive chains)
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Secret copies — which secret lives in which store (copy-discovery basis)
// ---------------------------------------------------------------------------
export const secret_copies = pgTable('secret_copies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  secret_id: text('secret_id').notNull().references(() => secrets.id),
  store_id: text('store_id').notNull().references(() => stores.id),
  rotated: boolean('rotated').default(false).notNull(),
  last_seen_at: timestamp('last_seen_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.secret_id, t.store_id)])

// ---------------------------------------------------------------------------
// Grant edges — secret → resource (graph edges)
// ---------------------------------------------------------------------------
export const grant_edges = pgTable('grant_edges', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  secret_id: text('secret_id').notNull().references(() => secrets.id),
  resource_id: text('resource_id').notNull().references(() => resources.id),
  permission: text('permission').notNull().default('read'), // read | write | admin
  scope: text('scope'),
  confidence: text('confidence').notNull().default('confirmed'), // confirmed | inferred
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.secret_id, t.resource_id)])

// ---------------------------------------------------------------------------
// Resource owners — resource/store → owner mapping
// ---------------------------------------------------------------------------
export const resource_owners = pgTable('resource_owners', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  resource_id: text('resource_id').references(() => resources.id),
  store_id: text('store_id').references(() => stores.id),
  owner_id: text('owner_id').notNull().references(() => owners.id),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Reuse clusters — groups of identical secrets
// ---------------------------------------------------------------------------
export const reuse_clusters = pgTable('reuse_clusters', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  secret_count: integer('secret_count').default(0).notNull(),
  risk_score: real('risk_score').default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Exposures — declared leak events
// ---------------------------------------------------------------------------
export const exposures = pgTable('exposures', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  secret_id: text('secret_id').notNull().references(() => secrets.id),
  title: text('title').notNull(),
  vector: text('vector').notNull(), // git_commit | log_dump | ticket_paste | third_party_breach | screen_share | other
  severity: text('severity').notNull().default('medium'), // low | medium | high | critical
  status: text('status').notNull().default('detected'), // detected | analyzing | contained | closed
  exposed_since: timestamp('exposed_since'),
  detected_at: timestamp('detected_at').defaultNow().notNull(),
  contained_at: timestamp('contained_at'),
  closed_at: timestamp('closed_at'),
  blast_radius_score: real('blast_radius_score').default(0),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Blast radius snapshots — computed reachability set per exposure
// ---------------------------------------------------------------------------
export const blast_radius_snapshots = pgTable('blast_radius_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  exposure_id: text('exposure_id').notNull().references(() => exposures.id),
  secret_id: text('secret_id').notNull().references(() => secrets.id),
  score: real('score').default(0),
  reachable_count: integer('reachable_count').default(0),
  crown_jewel_count: integer('crown_jewel_count').default(0),
  max_depth: integer('max_depth').default(0),
  reachable_resources: jsonb('reachable_resources').$type<Array<{ resource_id: string; name: string; sensitivity: string; depth: number; path: string[] }>>().default([]),
  graph: jsonb('graph').$type<{ nodes: Array<{ id: string; label: string; kind: string }>; edges: Array<{ from: string; to: string; permission: string }> }>().default({ nodes: [], edges: [] }),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Timeline events — exposure timeline reconstruction entries
// ---------------------------------------------------------------------------
export const timeline_events = pgTable('timeline_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  exposure_id: text('exposure_id').notNull().references(() => exposures.id),
  kind: text('kind').notNull(), // exposure_start | possible_access | anomalous_access | detection | rotation_start | rotation_complete | containment
  description: text('description').notNull(),
  resource_id: text('resource_id').references(() => resources.id),
  anomalous: boolean('anomalous').default(false).notNull(),
  occurred_at: timestamp('occurred_at').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Access logs — ingested access entries feeding the timeline
// ---------------------------------------------------------------------------
export const access_logs = pgTable('access_logs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  resource_id: text('resource_id').references(() => resources.id),
  principal: text('principal').notNull(),
  ip: text('ip'),
  action: text('action'),
  anomalous: boolean('anomalous').default(false).notNull(),
  occurred_at: timestamp('occurred_at').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Runbooks — rotation runbook per exposure
// ---------------------------------------------------------------------------
export const runbooks = pgTable('runbooks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  exposure_id: text('exposure_id').notNull().references(() => exposures.id),
  title: text('title').notNull(),
  status: text('status').notNull().default('open'), // open | in_progress | complete
  total_tasks: integer('total_tasks').default(0).notNull(),
  verified_tasks: integer('verified_tasks').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Runbook tasks — individual rotate/revoke/verify steps
// ---------------------------------------------------------------------------
export const runbook_tasks = pgTable('runbook_tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  runbook_id: text('runbook_id').notNull().references(() => runbooks.id),
  kind: text('kind').notNull(), // rotate | revoke | verify | notify
  description: text('description').notNull(),
  store_id: text('store_id').references(() => stores.id),
  resource_id: text('resource_id').references(() => resources.id),
  owner_id: text('owner_id').references(() => owners.id),
  status: text('status').notNull().default('pending'), // pending | in_progress | done | verified
  due_at: timestamp('due_at'),
  completed_at: timestamp('completed_at'),
  verified_at: timestamp('verified_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Rotation policies — max-age / rotation rules
// ---------------------------------------------------------------------------
export const rotation_policies = pgTable('rotation_policies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  applies_to_type: text('applies_to_type'), // secret type or null = any
  applies_to_criticality: text('applies_to_criticality'), // criticality or null = any
  max_age_days: integer('max_age_days').notNull(),
  grace_days: integer('grace_days').default(0).notNull(),
  escalation_days: integer('escalation_days'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Rotation debt — computed debt entries
// ---------------------------------------------------------------------------
export const rotation_debt = pgTable('rotation_debt', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  secret_id: text('secret_id').notNull().references(() => secrets.id),
  reason: text('reason').notNull(), // past_max_age | never_rotated | old_copies_live
  age_days: integer('age_days'),
  severity: text('severity').notNull().default('medium'),
  score: real('score').default(0),
  owner_id: text('owner_id').references(() => owners.id),
  resolved: boolean('resolved').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Evidence records — signed containment evidence per closed exposure
// ---------------------------------------------------------------------------
export const evidence_records = pgTable('evidence_records', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  exposure_id: text('exposure_id').notNull().references(() => exposures.id),
  content_hash: text('content_hash').notNull(),
  mttc_minutes: integer('mttc_minutes'),
  completeness_pct: real('completeness_pct').default(0),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  signed_at: timestamp('signed_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Simulations — tabletop simulation runs
// ---------------------------------------------------------------------------
export const simulations = pgTable('simulations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  secret_id: text('secret_id').references(() => secrets.id),
  template: text('template').notNull(), // db_password_leak | ci_token_leak | third_party_breach | custom
  status: text('status').notNull().default('running'), // running | scored | complete
  blast_radius_score: real('blast_radius_score').default(0),
  time_to_contain_minutes: integer('time_to_contain_minutes'),
  tasks_completed: integer('tasks_completed').default(0),
  total_tasks: integer('total_tasks').default(0),
  score: real('score').default(0),
  result: jsonb('result').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Notifications — per-user alerts
// ---------------------------------------------------------------------------
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  kind: text('kind').notNull(), // exposure_declared | task_assigned | task_overdue | runbook_complete | debt_threshold
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  read: boolean('read').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Audit log — tamper-evident activity trail
// ---------------------------------------------------------------------------
export const audit_log = pgTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id'),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing — plans + subscriptions (webhook-inspector pattern)
// ---------------------------------------------------------------------------
export const plans = pgTable('plans', {
  id: text('id').primaryKey(), // 'free' | 'pro'
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
