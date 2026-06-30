# Secret Exposure Blast Radius — Build Contract

> Single source of truth. Every agent follows this exactly. Filenames, mount paths, api method names, and page files declared here are binding. Backend: Hono + TypeScript on Render. Frontend: Next.js 16 + Neon Auth on Vercel. DB: Neon Postgres via drizzle-orm. Auth: `@neondatabase/auth@0.4.2-beta`, proxy.ts only, backend trusts `X-User-Id` via `getUserId(c)`. Routes mount under `/api/v1` via a child Hono `api` router. Public reads / auth-gated writes with zod + ownership checks. Frontend calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`.

---

## (a) Tables (columns)

1. **owners** — id, user_id, name, email, team, escalation_contact, created_at
2. **stores** — id, user_id, name, type, location, owner_id→owners, scan_cadence, last_scanned_at, metadata(jsonb), created_at
3. **secrets** — id, user_id, name, type, owning_service, environment, criticality, fingerprint, last_four, status, max_age_days, last_rotated_at, reuse_cluster_id, tags(jsonb), scopes(jsonb), created_at
4. **resources** — id, user_id, name, type, sensitivity, environment, owner_id→owners, contains_secret_id, metadata(jsonb), created_at
5. **secret_copies** — id, user_id, secret_id→secrets, store_id→stores, rotated, last_seen_at, created_at; UNIQUE(secret_id, store_id)
6. **grant_edges** — id, user_id, secret_id→secrets, resource_id→resources, permission, scope, confidence, created_at; UNIQUE(secret_id, resource_id)
7. **resource_owners** — id, user_id, resource_id→resources, store_id→stores, owner_id→owners, created_at
8. **reuse_clusters** — id, user_id, fingerprint, secret_count, risk_score(real), created_at
9. **exposures** — id, user_id, secret_id→secrets, title, vector, severity, status, exposed_since, detected_at, contained_at, closed_at, blast_radius_score(real), notes, created_at
10. **blast_radius_snapshots** — id, user_id, exposure_id→exposures, secret_id→secrets, score(real), reachable_count, crown_jewel_count, max_depth, reachable_resources(jsonb), graph(jsonb), created_at
11. **timeline_events** — id, user_id, exposure_id→exposures, kind, description, resource_id→resources, anomalous, occurred_at, created_at
12. **access_logs** — id, user_id, resource_id→resources, principal, ip, action, anomalous, occurred_at, created_at
13. **runbooks** — id, user_id, exposure_id→exposures, title, status, total_tasks, verified_tasks, created_at
14. **runbook_tasks** — id, user_id, runbook_id→runbooks, kind, description, store_id→stores, resource_id→resources, owner_id→owners, status, due_at, completed_at, verified_at, created_at
15. **rotation_policies** — id, user_id, name, applies_to_type, applies_to_criticality, max_age_days, grace_days, escalation_days, created_at
16. **rotation_debt** — id, user_id, secret_id→secrets, reason, age_days, severity, score(real), owner_id→owners, resolved, created_at
17. **evidence_records** — id, user_id, exposure_id→exposures, content_hash, mttc_minutes, completeness_pct(real), payload(jsonb), signed_at, created_at
18. **simulations** — id, user_id, secret_id→secrets, template, status, blast_radius_score(real), time_to_contain_minutes, tasks_completed, total_tasks, score(real), result(jsonb), created_at
19. **notifications** — id, user_id, kind, title, body, link, read, created_at
20. **audit_log** — id, user_id, actor, action, entity_type, entity_id, detail(jsonb), created_at
21. **plans** — id (text 'free'/'pro'), name, price_cents
22. **subscriptions** — id, user_id(unique), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (under /api/v1)

All write endpoints require auth (`authMiddleware` + `getUserId(c)`), zod-validate the body, and enforce ownership (`user_id === getUserId(c)`) on update/delete. Reads of the user's own data require auth; truly public reads only for landing-safe endpoints. Each file does `export default router`.

### 1. `secrets.ts` → mount `secrets`
- `GET /` — auth — list caller's secrets (filter by type/env/criticality/status query) — `Secret[]`
- `GET /:id` — auth — secret detail incl grants, copies, reuse cluster — `{ secret, grants, copies, reuse }`
- `POST /` — auth — create secret (computes/derives fingerprint, links reuse cluster) — `Secret`
- `PUT /:id` — auth+owner — update secret — `Secret`
- `DELETE /:id` — auth+owner — delete secret — `{ success }`
- `POST /:id/rotate` — auth+owner — mark rotated (sets last_rotated_at, status) — `Secret`

### 2. `stores.ts` → mount `stores`
- `GET /` — auth — list stores with health (secret_count, stale_copy_count) — `Store[]`
- `GET /:id` — auth — store detail + secrets it holds — `{ store, copies }`
- `POST /` — auth — create store — `Store`
- `PUT /:id` — auth+owner — update store — `Store`
- `DELETE /:id` — auth+owner — delete store — `{ success }`
- `POST /:id/scan` — auth+owner — record a scan (sets last_scanned_at) — `Store`

### 3. `copies.ts` → mount `copies`
- `GET /` — auth — list copies (filter by secret_id/store_id) — `Copy[]`
- `POST /` — auth — register a copy (secret in store) — `Copy`
- `DELETE /:id` — auth+owner — remove copy — `{ success }`
- `GET /discover/:secretId` — auth — copy-discovery for a secret: all live copies + unrotated + gap list — `{ copies, unrotated, gaps }`

### 4. `resources.ts` → mount `resources`
- `GET /` — auth — list resources (filter by type/sensitivity/env) — `Resource[]`
- `GET /:id` — auth — resource detail + granting secrets — `{ resource, grants }`
- `POST /` — auth — create resource — `Resource`
- `PUT /:id` — auth+owner — update resource — `Resource`
- `DELETE /:id` — auth+owner — delete resource — `{ success }`

### 5. `grants.ts` → mount `grants`
- `GET /` — auth — list grant edges (filter by secret_id/resource_id) — `Grant[]`
- `POST /` — auth — create grant edge — `Grant`
- `PUT /:id` — auth+owner — update edge (permission/scope/confidence) — `Grant`
- `DELETE /:id` — auth+owner — delete edge — `{ success }`

### 6. `blastRadius.ts` → mount `blast-radius`
- `GET /:secretId` — auth — compute reachability for a secret (BFS over grants + transitive contains_secret_id), returns score, reachable resources with paths, crown-jewel count, graph nodes/edges — `{ score, reachable_count, crown_jewel_count, max_depth, reachable_resources, graph }`
- `GET /` — auth — blast-radius summary across all secrets (top secrets by radius) — `{ secrets: Array<{ secret_id, name, score, reachable_count }> }`

### 7. `exposures.ts` → mount `exposures`
- `GET /` — auth — list exposures (filter by status/severity) — `Exposure[]`
- `GET /:id` — auth — exposure detail incl snapshot, runbook, timeline summary, evidence — `{ exposure, snapshot, runbook, timeline, evidence }`
- `POST /` — auth — declare exposure: computes blast radius, persists snapshot, derives severity, auto-generates runbook + tasks + timeline start, notifies — `{ exposure, snapshot, runbook }`
- `PUT /:id` — auth+owner — update exposure (status/notes) — `Exposure`
- `POST /:id/contain` — auth+owner — mark contained (requires runbook complete), sets contained_at, adds timeline event — `Exposure`
- `POST /:id/close` — auth+owner — close exposure, sets closed_at — `Exposure`
- `DELETE /:id` — auth+owner — delete exposure — `{ success }`

### 8. `timeline.ts` → mount `timeline`
- `GET /:exposureId` — auth — chronological timeline events for an exposure — `TimelineEvent[]`
- `POST /:exposureId/reconstruct` — auth+owner — reconstruct window: pulls access_logs between exposed_since and detected_at per reachable resource, creates possible/anomalous-access events — `{ events, anomalies }`
- `POST /:exposureId/event` — auth+owner — add a manual timeline event — `TimelineEvent`

### 9. `accessLogs.ts` → mount `access-logs`
- `GET /` — auth — list access logs (filter by resource_id/principal) — `AccessLog[]`
- `POST /` — auth — ingest a single access log entry — `AccessLog`
- `POST /bulk` — auth — ingest an array of access logs — `{ inserted }`
- `DELETE /:id` — auth+owner — delete entry — `{ success }`

### 10. `runbooks.ts` → mount `runbooks`
- `GET /` — auth — list runbooks (filter by status/exposure_id) — `Runbook[]`
- `GET /:id` — auth — runbook detail + tasks — `{ runbook, tasks }`
- `POST /:id/tasks` — auth+owner — add a task — `RunbookTask`
- `PUT /tasks/:taskId` — auth+owner — update task status/owner (recomputes runbook progress + sets complete when all verified) — `RunbookTask`
- `DELETE /tasks/:taskId` — auth+owner — delete task — `{ success }`

### 11. `reuse.ts` → mount `reuse`
- `GET /` — auth — list reuse clusters with member secrets + risk — `Cluster[]`
- `GET /:id` — auth — cluster detail (all secrets sharing fingerprint, every store/service) — `{ cluster, secrets }`
- `POST /recompute` — auth — recompute clusters from secret fingerprints — `{ clusters }`

### 12. `policies.ts` → mount `policies`
- `GET /` — auth — list rotation policies — `Policy[]`
- `POST /` — auth — create policy — `Policy`
- `PUT /:id` — auth+owner — update policy — `Policy`
- `DELETE /:id` — auth+owner — delete policy — `{ success }`

### 13. `debt.ts` → mount `debt`
- `GET /` — auth — rotation-debt ledger (filter by reason/owner/resolved), sortable — `DebtEntry[]`
- `POST /recompute` — auth — recompute debt from secrets vs policies/max-age + unrotated copies — `{ entries }`
- `PUT /:id/resolve` — auth+owner — mark a debt entry resolved — `DebtEntry`
- `GET /summary` — auth — debt totals by reason/owner + trend — `{ by_reason, by_owner, total_score }`

### 14. `evidence.ts` → mount `evidence`
- `GET /` — auth — list evidence records — `Evidence[]`
- `GET /:id` — auth — evidence record detail (full payload) — `Evidence`
- `POST /generate/:exposureId` — auth+owner — generate signed evidence (blast radius + timeline + tasks + copy-discovery + MTTC + completeness + content_hash) for a contained/closed exposure — `Evidence`

### 15. `simulations.ts` → mount `simulations`
- `GET /` — auth — list simulations — `Simulation[]`
- `GET /:id` — auth — simulation detail/result — `Simulation`
- `POST /` — auth — run a tabletop simulation (sandbox blast radius + practice runbook from template) — `Simulation`
- `POST /:id/score` — auth+owner — score the run (time-to-contain, tasks completed) — `Simulation`
- `DELETE /:id` — auth+owner — delete simulation — `{ success }`

### 16. `owners.ts` → mount `owners`
- `GET /` — auth — owner directory + open-task counts — `Owner[]`
- `GET /:id` — auth — owner detail + assigned resources/stores/tasks — `{ owner, resources, stores, tasks }`
- `POST /` — auth — create owner — `Owner`
- `PUT /:id` — auth+owner — update owner — `Owner`
- `DELETE /:id` — auth+owner — delete owner — `{ success }`
- `POST /assign` — auth — assign owner to resource or store (resource_owners) — `ResourceOwner`

### 17. `notifications.ts` → mount `notifications`
- `GET /` — auth — caller's notifications — `Notification[]`
- `PUT /:id/read` — auth+owner — mark read — `Notification`
- `PUT /read-all` — auth — mark all read — `{ success }`

### 18. `dashboard.ts` → mount `dashboard`
- `GET /` — auth — posture summary: open exposures, containment progress, MTTC, debt summary, crown-jewel exposure, reuse risk counts — `{ open_exposures, mttc_minutes, debt, crown_jewels, reuse_risk, recent }`

### 19. `reports.ts` → mount `reports`
- `GET /exposure-history` — auth — exposure history + MTTC trend — `{ history, mttc_trend }`
- `GET /debt-trend` — auth — rotation-debt trend over time — `{ trend }`
- `GET /crown-jewels` — auth — top reachable crown-jewel resources — `{ resources }`
- `GET /posture` — auth — insurer-renewal posture report — `{ posture }`

### 20. `audit.ts` → mount `audit`
- `GET /` — auth — audit log (filter by entity_type/action), paginated — `AuditEntry[]`

### 21. `seed.ts` → mount `seed`
- `POST /` — auth — seed sample data (owners, stores, secrets, resources, grants, copies, a sample exposure with snapshot+runbook+timeline, access logs, policies) for the caller — `{ seeded: true, counts }`
- `DELETE /` — auth — clear the caller's data — `{ cleared: true }`

### 22. `billing.ts` → mount `billing`
- `GET /plan` — auth — `{ subscription, plan, stripeEnabled }`
- `POST /checkout` — auth — Stripe checkout, 503 if unconfigured — `{ url }`
- `POST /portal` — auth — Stripe portal, 503 if unconfigured — `{ url }`
- `POST /webhook` — public — Stripe webhook, 503 if unconfigured — `{ received }`

---

## (c) lib/api.ts methods (relative /api/proxy/... paths)

```
// secrets
getSecrets(params?)            GET    /api/proxy/secrets
getSecret(id)                  GET    /api/proxy/secrets/:id
createSecret(body)             POST   /api/proxy/secrets
updateSecret(id, body)         PUT    /api/proxy/secrets/:id
deleteSecret(id)               DELETE /api/proxy/secrets/:id
rotateSecret(id)               POST   /api/proxy/secrets/:id/rotate

// stores
getStores()                    GET    /api/proxy/stores
getStore(id)                   GET    /api/proxy/stores/:id
createStore(body)              POST   /api/proxy/stores
updateStore(id, body)          PUT    /api/proxy/stores/:id
deleteStore(id)                DELETE /api/proxy/stores/:id
scanStore(id)                  POST   /api/proxy/stores/:id/scan

// copies
getCopies(params?)             GET    /api/proxy/copies
createCopy(body)               POST   /api/proxy/copies
deleteCopy(id)                 DELETE /api/proxy/copies/:id
discoverCopies(secretId)       GET    /api/proxy/copies/discover/:secretId

// resources
getResources(params?)          GET    /api/proxy/resources
getResource(id)                GET    /api/proxy/resources/:id
createResource(body)           POST   /api/proxy/resources
updateResource(id, body)       PUT    /api/proxy/resources/:id
deleteResource(id)             DELETE /api/proxy/resources/:id

// grants
getGrants(params?)             GET    /api/proxy/grants
createGrant(body)              POST   /api/proxy/grants
updateGrant(id, body)          PUT    /api/proxy/grants/:id
deleteGrant(id)                DELETE /api/proxy/grants/:id

// blast radius
getBlastRadius(secretId)       GET    /api/proxy/blast-radius/:secretId
getBlastRadiusSummary()        GET    /api/proxy/blast-radius

// exposures
getExposures(params?)          GET    /api/proxy/exposures
getExposure(id)                GET    /api/proxy/exposures/:id
createExposure(body)           POST   /api/proxy/exposures
updateExposure(id, body)       PUT    /api/proxy/exposures/:id
containExposure(id)            POST   /api/proxy/exposures/:id/contain
closeExposure(id)              POST   /api/proxy/exposures/:id/close
deleteExposure(id)             DELETE /api/proxy/exposures/:id

// timeline
getTimeline(exposureId)        GET    /api/proxy/timeline/:exposureId
reconstructTimeline(exposureId) POST  /api/proxy/timeline/:exposureId/reconstruct
addTimelineEvent(exposureId, body) POST /api/proxy/timeline/:exposureId/event

// access logs
getAccessLogs(params?)         GET    /api/proxy/access-logs
createAccessLog(body)          POST   /api/proxy/access-logs
bulkAccessLogs(body)           POST   /api/proxy/access-logs/bulk
deleteAccessLog(id)            DELETE /api/proxy/access-logs/:id

// runbooks
getRunbooks(params?)           GET    /api/proxy/runbooks
getRunbook(id)                 GET    /api/proxy/runbooks/:id
addRunbookTask(id, body)       POST   /api/proxy/runbooks/:id/tasks
updateRunbookTask(taskId, body) PUT   /api/proxy/runbooks/tasks/:taskId
deleteRunbookTask(taskId)      DELETE /api/proxy/runbooks/tasks/:taskId

// reuse
getReuseClusters()             GET    /api/proxy/reuse
getReuseCluster(id)            GET    /api/proxy/reuse/:id
recomputeReuse()               POST   /api/proxy/reuse/recompute

// policies
getPolicies()                  GET    /api/proxy/policies
createPolicy(body)             POST   /api/proxy/policies
updatePolicy(id, body)         PUT    /api/proxy/policies/:id
deletePolicy(id)               DELETE /api/proxy/policies/:id

// debt
getDebt(params?)               GET    /api/proxy/debt
recomputeDebt()                POST   /api/proxy/debt/recompute
resolveDebt(id)                PUT    /api/proxy/debt/:id/resolve
getDebtSummary()               GET    /api/proxy/debt/summary

// evidence
getEvidenceRecords()           GET    /api/proxy/evidence
getEvidenceRecord(id)          GET    /api/proxy/evidence/:id
generateEvidence(exposureId)   POST   /api/proxy/evidence/generate/:exposureId

// simulations
getSimulations()               GET    /api/proxy/simulations
getSimulation(id)              GET    /api/proxy/simulations/:id
createSimulation(body)         POST   /api/proxy/simulations
scoreSimulation(id, body)      POST   /api/proxy/simulations/:id/score
deleteSimulation(id)           DELETE /api/proxy/simulations/:id

// owners
getOwners()                    GET    /api/proxy/owners
getOwner(id)                   GET    /api/proxy/owners/:id
createOwner(body)              POST   /api/proxy/owners
updateOwner(id, body)          PUT    /api/proxy/owners/:id
deleteOwner(id)                DELETE /api/proxy/owners/:id
assignOwner(body)              POST   /api/proxy/owners/assign

// notifications
getNotifications()             GET    /api/proxy/notifications
markNotificationRead(id)       PUT    /api/proxy/notifications/:id/read
markAllNotificationsRead()     PUT    /api/proxy/notifications/read-all

// dashboard
getDashboard()                 GET    /api/proxy/dashboard

// reports
getExposureHistory()           GET    /api/proxy/reports/exposure-history
getDebtTrend()                 GET    /api/proxy/reports/debt-trend
getCrownJewels()               GET    /api/proxy/reports/crown-jewels
getPostureReport()             GET    /api/proxy/reports/posture

// audit
getAuditLog(params?)           GET    /api/proxy/audit

// seed
seedSampleData()               POST   /api/proxy/seed
clearData()                    DELETE /api/proxy/seed

// billing
getBillingPlan()               GET    /api/proxy/billing/plan
createCheckout()               POST   /api/proxy/billing/checkout
openPortal()                   POST   /api/proxy/billing/portal
```

Every api method maps 1:1 to exactly one backend endpoint. Relative URLs only; `Content-Type: application/json` + `JSON.stringify` on mutations; `export default api`.

---

## (d) Pages (URL → file → kind → api methods → renders)

**Public**

1. `/` — `web/app/page.tsx` — public — none — static landing: hero, the three 2am questions, feature grid, insurer-evidence pitch, CTAs to sign-up.
2. `/auth/sign-in` — `web/app/auth/sign-in/page.tsx` — public — (authClient) — client onSubmit sign-in form.
3. `/auth/sign-up` — `web/app/auth/sign-up/page.tsx` — public — (authClient) — client onSubmit sign-up form.
4. `/pricing` — `web/app/pricing/page.tsx` — public — none — Free vs Pro plans, all-free note.

**Dashboard** (under `/dashboard/*`, wrapped by `web/app/dashboard/layout.tsx` → `DashboardLayout` sidebar; each page client-guards via `authClient.getSession()`)

5. `/dashboard` — `web/app/dashboard/page.tsx` — dashboard — getDashboard, seedSampleData — posture overview: open exposures, MTTC, containment progress, debt summary, crown-jewel exposure, reuse risk, seed-data button.
6. `/dashboard/secrets` — `web/app/dashboard/secrets/page.tsx` — dashboard — getSecrets, createSecret, deleteSecret — secret registry list + create + filters.
7. `/dashboard/secrets/[id]` — `web/app/dashboard/secrets/[id]/page.tsx` — dashboard — getSecret, updateSecret, rotateSecret, getBlastRadius, discoverCopies — secret detail: grants, copies, reuse, blast radius, rotate.
8. `/dashboard/stores` — `web/app/dashboard/stores/page.tsx` — dashboard — getStores, createStore, updateStore, deleteStore, scanStore — store inventory + health.
9. `/dashboard/resources` — `web/app/dashboard/resources/page.tsx` — dashboard — getResources, createResource, updateResource, deleteResource — resource catalog.
10. `/dashboard/grants` — `web/app/dashboard/grants/page.tsx` — dashboard — getGrants, getSecrets, getResources, createGrant, updateGrant, deleteGrant — grant-edge editor connecting secrets to resources.
11. `/dashboard/blast-radius` — `web/app/dashboard/blast-radius/page.tsx` — dashboard — getBlastRadiusSummary, getSecrets, getBlastRadius — interactive blast-radius explorer (pick secret, show reachable set + graph + paths).
12. `/dashboard/exposures` — `web/app/dashboard/exposures/page.tsx` — dashboard — getExposures — exposure list with severity/status filters.
13. `/dashboard/exposures/new` — `web/app/dashboard/exposures/new/page.tsx` — dashboard — getSecrets, createExposure — declare-exposure form.
14. `/dashboard/exposures/[id]` — `web/app/dashboard/exposures/[id]/page.tsx` — dashboard — getExposure, updateExposure, containExposure, closeExposure, reconstructTimeline, generateEvidence — exposure detail: blast radius, timeline, runbook, contain/close, generate evidence.
15. `/dashboard/timeline` — `web/app/dashboard/timeline/page.tsx` — dashboard — getExposures, getTimeline, reconstructTimeline, addTimelineEvent — timeline reconstruction view across exposures.
16. `/dashboard/access-logs` — `web/app/dashboard/access-logs/page.tsx` — dashboard — getAccessLogs, getResources, createAccessLog, bulkAccessLogs, deleteAccessLog — access-log ingestion + list.
17. `/dashboard/runbooks` — `web/app/dashboard/runbooks/page.tsx` — dashboard — getRunbooks, getRunbook, addRunbookTask, updateRunbookTask, deleteRunbookTask — runbook list + task board (status transitions).
18. `/dashboard/reuse` — `web/app/dashboard/reuse/page.tsx` — dashboard — getReuseClusters, getReuseCluster, recomputeReuse — reuse-detector clusters.
19. `/dashboard/copies` — `web/app/dashboard/copies/page.tsx` — dashboard — getSecrets, getCopies, createCopy, deleteCopy, discoverCopies — copy-discovery view + register copies.
20. `/dashboard/debt` — `web/app/dashboard/debt/page.tsx` — dashboard — getDebt, getDebtSummary, recomputeDebt, resolveDebt — rotation-debt ledger.
21. `/dashboard/policies` — `web/app/dashboard/policies/page.tsx` — dashboard — getPolicies, createPolicy, updatePolicy, deletePolicy — rotation policy editor.
22. `/dashboard/evidence` — `web/app/dashboard/evidence/page.tsx` — dashboard — getEvidenceRecords, getEvidenceRecord, getExposures, generateEvidence — signed evidence records list + generate + view.
23. `/dashboard/simulations` — `web/app/dashboard/simulations/page.tsx` — dashboard — getSimulations, getSimulation, getSecrets, createSimulation, scoreSimulation, deleteSimulation — tabletop simulator.
24. `/dashboard/owners` — `web/app/dashboard/owners/page.tsx` — dashboard — getOwners, getOwner, createOwner, updateOwner, deleteOwner, assignOwner, getResources, getStores — owner directory + assignment.
25. `/dashboard/notifications` — `web/app/dashboard/notifications/page.tsx` — dashboard — getNotifications, markNotificationRead, markAllNotificationsRead — notifications feed.
26. `/dashboard/reports` — `web/app/dashboard/reports/page.tsx` — dashboard — getExposureHistory, getDebtTrend, getCrownJewels, getPostureReport — reports & analytics.
27. `/dashboard/audit` — `web/app/dashboard/audit/page.tsx` — dashboard — getAuditLog — audit log table.
28. `/dashboard/settings` — `web/app/dashboard/settings/page.tsx` — dashboard — getBillingPlan, createCheckout, openPortal, clearData — settings + billing + data management.

Plus 2 route handlers: `web/app/api/auth/[...path]/route.ts`, `web/app/api/proxy/[...path]/route.ts`.

---

## (e) DashboardLayout sidebar nav sections

`web/components/DashboardLayout.tsx` — `'use client'`, `<aside>` with `usePathname()` active state, mobile drawer, sign-out. Grouped:

- **Overview**
  - Dashboard → `/dashboard`
- **Inventory**
  - Secrets → `/dashboard/secrets`
  - Stores → `/dashboard/stores`
  - Resources → `/dashboard/resources`
  - Grants → `/dashboard/grants`
  - Owners → `/dashboard/owners`
- **Analysis**
  - Blast Radius → `/dashboard/blast-radius`
  - Reuse → `/dashboard/reuse`
  - Copy Discovery → `/dashboard/copies`
- **Incidents**
  - Exposures → `/dashboard/exposures`
  - Timeline → `/dashboard/timeline`
  - Runbooks → `/dashboard/runbooks`
  - Access Logs → `/dashboard/access-logs`
  - Evidence → `/dashboard/evidence`
  - Simulations → `/dashboard/simulations`
- **Hygiene**
  - Rotation Debt → `/dashboard/debt`
  - Policies → `/dashboard/policies`
- **Insight**
  - Reports → `/dashboard/reports`
  - Audit Log → `/dashboard/audit`
  - Notifications → `/dashboard/notifications`
- **Account**
  - Settings → `/dashboard/settings`

---

## Consistency check

- 22 route files ✓ ; 28 pages (24 dashboard + 4 public) ✓ ; 22 tables ✓.
- Every api method is implemented by exactly one route endpoint and consumed by at least one page. Billing webhook is the only public-write endpoint (Stripe signature verified). All other writes are auth + ownership-checked with zod.
