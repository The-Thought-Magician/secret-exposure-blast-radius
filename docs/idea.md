# Secret Exposure Blast Radius

> When a credential leaks, instantly compute everything it could touch and drive the rotation to completion with proof.

---

## Overview

Secret Exposure Blast Radius (SEBR) is a post-leak incident-response platform. The moment a credential is exposed (committed to a repo, pasted into a ticket, dumped in logs, or leaked in a third-party breach), SEBR answers the three questions that matter at 2am:

1. **What can this secret touch?** Compute the full reachability graph: every resource, service, dataset, and downstream credential the leaked secret unlocks.
2. **Who could have used it, and when?** Reconstruct the exposure window and the realistic access timeline.
3. **Is it actually rotated everywhere?** Drive a rotation runbook to completion with owner assignment, copy-discovery, and signed proof of containment.

The deliverable is a **documented containment timeline** that cyber-insurers require to pay breach claims and that SOC2 / regulatory auditors require to close findings. SEBR is deterministic analysis over uploaded, connected, or generated data, with a built-in sample-data seeder so any prospect can see the full product working in minutes.

All features are FREE for signed-in users. Stripe billing is wired but optional (returns 503 when unconfigured) so the platform can monetize later without a rebuild.

---

## Problem

When a secret leaks, the response today is chaos:

- **Triage is guesswork.** Nobody has an authoritative map of what a given API key, database password, or service-account token actually grants. Teams reconstruct it by hand, under stress, at 2am.
- **Rotation is incomplete.** A secret is rotated in the primary store but stale copies live on in a CI variable, a Terraform state file, a forgotten Lambda env var, a teammate's `.env`. Partial rotation is the #1 cause of re-breach.
- **There is no containment evidence.** When the cyber-insurer asks "prove the credential was contained and when," teams have Slack threads and memory, not a signed timeline. Claims get delayed or denied.
- **Reuse multiplies blast radius.** The same secret is reused across services, so a single leak is actually N leaks, and nobody has the cross-reference.
- **Rotation debt accumulates silently.** Credentials sit past their max age, never get rotated, and old copies persist with no ledger tracking the risk.

SEBR turns this into a deterministic, auditable workflow: register secrets and what they grant, model the blast-radius graph, and when an exposure is declared, generate the reachability set, the timeline, and a rotation runbook that cannot be closed until every copy is proven rotated.

---

## Target Users

- **Primary buyer:** Incident-response / DART lead or security engineering manager at a cyber-insured mid-market SaaS or fintech (50-1000 engineers) facing SOC2 / regulatory containment expectations.
- **Primary users:** IR responders, security engineers, platform/SRE owners who hold rotation responsibility for specific resources.
- **Secondary users:** Compliance / GRC staff assembling audit evidence; engineering managers who own rotation tasks; CISOs reviewing rotation-debt posture and insurer renewal readiness.

**Demand triggers:** every exposure event, every SOC2 / ISO audit cycle, and every cyber-insurance renewal (where the carrier asks for documented secret-rotation hygiene and a containment-evidence process).

---

## Why this is NOT an existing project

SEBR is **post-leak incident response**, not secrets storage and not expiry forecasting. Given that a secret is *already exposed*, it computes reachability and drives rotation-to-proof with insurer evidence.

Near neighbors and the precise distinction:

- **secrets-management-platform / encryption-key-mgmt** (Vault, AWS Secrets Manager, KMS): these *store and rotate* secrets. SEBR does not store secrets; it consumes the catalog of what exists and what it grants, and activates only *after* one leaks. It is the incident-response layer above a secrets manager, not a replacement for one.
- **oauth-grant-expiry-watchtower:** forecasts token / grant expiry windows ahead of time. SEBR is reactive to an exposure that already happened, computing blast radius and driving containment, not predicting expiry.
- **ci-pipeline-permission-auditor:** audits standing pipeline privilege and least-privilege drift. SEBR is not a privilege auditor; it answers "this specific credential leaked, what does it reach and is rotation done."
- **breach-notification-clock:** tracks regulatory notification deadlines (GDPR 72h, etc.). SEBR tracks *containment* (rotation completion) and produces the evidence record, not the notification SLA timer.

The combination that is unique to SEBR: a **secret registry → blast-radius reachability graph → rotation runbook engine with copy-discovery and completion proof → signed insurer-grade evidence record**, driven by exposure events and reconstructed access timelines.

---

## Major Features

### 1. Secret Registry
Catalog every credential the organization holds.
- Register secrets by type (API key, DB password, OAuth token, service-account key, SSH key, signing key, webhook secret, TLS private key, PAT).
- Each secret records: store/location, owning service, environment (prod/staging/dev), criticality, max-age policy, last-rotated date, fingerprint/last-4.
- Grant model: what each secret unlocks (scopes, resource IDs, permission level).
- Tagging, search, and filtering by type/store/environment/criticality.
- Bulk import from CSV / connected-store sync; sample seeder.
- Secret lifecycle states: active, rotating, retired, compromised.

### 2. Secret Store Connectors / Inventory of Stores
Model the stores where secrets live.
- Register stores (Vault, AWS SM, GCP SM, env file, CI variable group, k8s secret, 1Password vault).
- Per-store metadata: type, owner, location, scan cadence.
- Track which secrets live in which stores (a secret can live in many stores — the basis for copy-discovery).
- Store health: last scanned, secret count, stale-copy count.

### 3. Resource Catalog
Catalog every protectable resource a secret could reach.
- Resources: databases, S3 buckets, payment APIs, internal services, message queues, cloud accounts, third-party SaaS.
- Per-resource: type, sensitivity/data-classification, owner, environment.
- Resources are the *nodes* the blast-radius graph reaches.

### 4. Grant Edges (Secret → Resource mapping)
The edges that make the graph.
- A grant edge connects a secret to a resource with a permission level (read/write/admin) and scope.
- Transitive grants: a secret that unlocks resource A which holds *another* secret that unlocks B (chained reachability).
- Edge confidence (confirmed vs inferred).

### 5. Blast-Radius Graph Engine
The core differentiator.
- Given a secret, compute the full reachability set: direct grants + transitive chains (BFS over grant edges and store-contained secrets).
- Compute blast-radius score: weighted by resource sensitivity, count, transitive depth.
- Identify "crown jewel" resources reachable (PII stores, payment systems, prod DBs).
- Graph visualization data (nodes + edges + depth) for the frontend.
- Cycle-safe traversal; depth-bounded; explainable path list ("secret X → reaches DB Y → which holds secret Z → reaches bucket W").

### 6. Exposure Events
Declare and track leaks.
- Declare an exposure: which secret, exposure vector (git commit, log dump, ticket paste, third-party breach, screen share), detected-at, exposed-since (best estimate).
- Severity auto-derived from the blast-radius score of the exposed secret.
- Exposure state machine: detected → analyzing → contained → closed.
- Link to the generated blast-radius snapshot and rotation runbook.
- Multiple exposures of the same secret over time.

### 7. Exposure Timeline Reconstruction
Build the "who-could-have-used-it" window.
- Given exposed-since and detected-at, build the access window.
- Pull/record access-log entries (uploaded or generated) within the window per reachable resource.
- Timeline events: exposure start, each suspicious/possible access, detection, rotation start, rotation complete, containment.
- Flag anomalous access (access from new IP/principal during window).
- Exportable chronological timeline for the evidence record.

### 8. Rotation Runbook Engine
Drive rotation to completion.
- Auto-generate a runbook from the exposed secret's blast radius: one task per copy/store + one per dependent resource credential.
- Task: rotate-here, revoke-here, verify-here, notify-owner.
- Owner assignment per task (from resource/store owner).
- Task states: pending → in_progress → done → verified.
- Runbook cannot reach "complete" until every task is verified.
- Templated runbook steps per secret type.

### 9. Reuse Detector
The same secret across services.
- Detect secrets sharing a fingerprint/value-hash across multiple stores/services.
- Reuse clusters: group identical secrets and show every place they live.
- On exposure, reuse expands the blast radius automatically (all copies are exposed).
- Reuse risk score; recommendations to de-duplicate.

### 10. Copy-Discovery
Find every live copy before declaring containment.
- For an exposed secret, enumerate all known copies (from stores + reuse clusters).
- "Old copies live" detector: copies in stores not yet rotated.
- Discovery checklist that feeds rotation runbook tasks.
- Gap report: copies with no assigned rotation task.

### 11. Rotation-Debt Ledger
Track standing rotation risk.
- Past-max-age: secrets older than their policy max age.
- Never-rotated: secrets with no last-rotated date.
- Old-copies-live: stores holding pre-rotation copies.
- Debt scoring and trend over time.
- Per-owner debt breakdown; sortable, filterable ledger.

### 12. Rotation Policies
Define max-age and rotation rules.
- Per secret-type or per-criticality max-age policies.
- Policy assignment to secrets; auto-flag violations into the debt ledger.
- Grace windows; escalation thresholds.

### 13. Signed Incident Evidence Record
The insurer deliverable.
- Generate an immutable evidence record per closed exposure: blast radius, timeline, every rotation task with who/when, copy-discovery results, final containment timestamp.
- Content hash / signature for tamper-evidence.
- Insurer-formatted export (containment timeline, mean-time-to-contain, completeness attestation).
- Versioned; downloadable.

### 14. Tabletop Simulator
Practice exposures without a real leak.
- Run a simulated exposure against a chosen secret.
- Generates a sandbox blast radius + practice runbook.
- Scores the team's response (time-to-contain, tasks completed).
- Replayable scenarios; library of templates (DB password leak, CI token leak, third-party breach).
- Simulation results separate from real incidents.

### 15. Owners & Assignment
Map responsibility.
- Owner directory (people/teams) with contact + escalation.
- Resource/store → owner mapping.
- Auto-route rotation tasks to the right owner.
- Owner workload view (open rotation tasks per owner).

### 16. Access-Log Ingestion
Feed the timeline.
- Upload or generate access-log entries (resource, principal, IP, timestamp, action).
- Associate logs with resources for timeline reconstruction.
- Anomaly tagging within exposure windows.

### 17. Notifications & Alerts
Drive urgency.
- Notify on: new exposure declared, task assigned, task overdue, runbook complete, debt threshold crossed.
- Per-user notification feed, mark-read.
- Severity-based routing.

### 18. Dashboards & Posture
At-a-glance state.
- Open exposures, containment progress, mean-time-to-contain.
- Rotation-debt summary, crown-jewel exposure, reuse risk.
- Trend charts.

### 19. Reports & Analytics
Aggregate insight.
- Exposure history, MTTC trend, debt trend, top reachable crown jewels.
- Per-secret-type leak frequency; per-owner rotation performance.
- Insurer-renewal posture report.

### 20. Audit Log
Tamper-evident activity trail.
- Every state change (exposure declared, task verified, evidence signed) recorded with actor + timestamp.
- Filterable; feeds the evidence record.

### 21. Sample Data Seeder
Instant demoability.
- One-click seed of realistic secrets, stores, resources, grant edges, a sample exposure, and access logs.
- Lets a prospect see the full blast-radius + rotation + evidence flow immediately.

### 22. Billing (optional)
Stripe-optional, all-free default.
- Free plan grants all features.
- Pro plan wired via Stripe; checkout/portal/webhook return 503 until configured.

---

## Data Model (tables)

- `secrets` — registered credentials.
- `stores` — secret stores/locations.
- `secret_copies` — which secret lives in which store (copy-discovery basis).
- `resources` — protectable resources (graph nodes).
- `grant_edges` — secret → resource grant (graph edges).
- `owners` — people/teams responsible.
- `resource_owners` — resource/store → owner mapping.
- `exposures` — declared leak events.
- `blast_radius_snapshots` — computed reachability set per exposure.
- `timeline_events` — exposure timeline entries.
- `access_logs` — ingested access entries.
- `runbooks` — rotation runbooks per exposure.
- `runbook_tasks` — individual rotation/revoke/verify tasks.
- `reuse_clusters` — groups of identical secrets.
- `rotation_policies` — max-age/rotation rules.
- `rotation_debt` — computed debt entries.
- `evidence_records` — signed containment evidence.
- `simulations` — tabletop simulation runs.
- `notifications` — per-user alerts.
- `audit_log` — activity trail.
- `plans` — billing plans.
- `subscriptions` — per-user subscription.

---

## API Surface (high level)

- `/api/v1/secrets` — secret registry CRUD + reuse view.
- `/api/v1/stores` — store inventory CRUD + health.
- `/api/v1/copies` — secret-copy mapping + copy-discovery.
- `/api/v1/resources` — resource catalog CRUD.
- `/api/v1/grants` — grant-edge CRUD.
- `/api/v1/blast-radius` — compute reachability per secret.
- `/api/v1/exposures` — exposure lifecycle.
- `/api/v1/timeline` — timeline reconstruction per exposure.
- `/api/v1/access-logs` — log ingestion.
- `/api/v1/runbooks` — runbook + task management.
- `/api/v1/reuse` — reuse clusters.
- `/api/v1/policies` — rotation policies.
- `/api/v1/debt` — rotation-debt ledger.
- `/api/v1/evidence` — evidence records.
- `/api/v1/simulations` — tabletop simulator.
- `/api/v1/owners` — owner directory + assignment.
- `/api/v1/notifications` — alerts.
- `/api/v1/dashboard` — posture summary.
- `/api/v1/reports` — analytics.
- `/api/v1/audit` — audit log.
- `/api/v1/seed` — sample-data seeder.
- `/api/v1/billing` — plan/checkout/portal/webhook.

---

## Frontend Pages (~24)

Public:
1. `/` — landing (static marketing).
2. `/auth/sign-in` — sign in.
3. `/auth/sign-up` — sign up.
4. `/pricing` — plans.

Dashboard (auth-gated, under `/dashboard/*`):
5. `/dashboard` — posture overview.
6. `/dashboard/secrets` — secret registry list.
7. `/dashboard/secrets/[id]` — secret detail (grants, copies, reuse, blast radius).
8. `/dashboard/stores` — store inventory.
9. `/dashboard/resources` — resource catalog.
10. `/dashboard/grants` — grant-edge editor.
11. `/dashboard/blast-radius` — interactive blast-radius explorer.
12. `/dashboard/exposures` — exposure list.
13. `/dashboard/exposures/new` — declare exposure.
14. `/dashboard/exposures/[id]` — exposure detail (radius + timeline + runbook + evidence).
15. `/dashboard/timeline` — timeline reconstruction view.
16. `/dashboard/access-logs` — access-log ingestion/list.
17. `/dashboard/runbooks` — runbook list + task board.
18. `/dashboard/reuse` — reuse-detector clusters.
19. `/dashboard/copies` — copy-discovery view.
20. `/dashboard/debt` — rotation-debt ledger.
21. `/dashboard/policies` — rotation policies.
22. `/dashboard/evidence` — evidence records.
23. `/dashboard/simulations` — tabletop simulator.
24. `/dashboard/owners` — owner directory.
25. `/dashboard/notifications` — notifications feed.
26. `/dashboard/reports` — reports & analytics.
27. `/dashboard/audit` — audit log.
28. `/dashboard/settings` — settings + billing.
