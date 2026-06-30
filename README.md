# Secret Exposure Blast Radius (SEBR)

> When a credential leaks, instantly compute everything it could touch and drive the rotation to completion with proof.

SEBR is a post-leak incident-response platform. The moment a credential is exposed (committed to a repo, pasted into a ticket, dumped in logs, or leaked in a third-party breach), SEBR answers the three questions that matter at 2am:

1. **What can this secret touch?** Compute the full reachability graph: every resource, service, dataset, and downstream credential the leaked secret unlocks.
2. **Who could have used it, and when?** Reconstruct the exposure window and a realistic access timeline.
3. **Is it actually rotated everywhere?** Drive a rotation runbook to completion with owner assignment, copy-discovery, and signed proof of containment.

The deliverable is a documented containment timeline that cyber-insurers require to pay breach claims and that SOC2 and regulatory auditors require to close findings. SEBR is deterministic analysis over uploaded, connected, or generated data, with a built-in sample-data seeder so any prospect can see the full product working in minutes.

See [`docs/idea.md`](docs/idea.md) for the full product specification, feature list, data model, and API surface.

---

## Features

Secret registry, secret-store inventory, resource catalog, grant edges, a blast-radius graph engine (BFS over grant edges and store-contained secrets with cycle-safe, depth-bounded, explainable traversal), exposure events with a containment state machine, exposure-timeline reconstruction, a rotation runbook engine, reuse detection, copy-discovery, a rotation-debt ledger, rotation policies, signed incident evidence records, a tabletop simulator, owners and assignment, access-log ingestion, notifications, dashboards, reports, an audit log, and a one-click sample-data seeder.

**All features are free for signed-in users.** Stripe billing is wired but optional: checkout, portal, and webhook endpoints return `503` until Stripe is configured, so the platform can monetize later without a rebuild.

---

## Stack

- **Backend:** Node + TypeScript (run directly via `tsx`), Postgres via Drizzle.
- **Frontend:** Next.js 15+ / React 19+ / TypeScript (strict) / Tailwind 4, App Router, located at `web/`. Package manager: pnpm.
- **Auth:** Neon Auth.
- **Deploy:** backend on Render (`render.yaml`), frontend on Vercel.

---

## Local Development

Prerequisites: Node 22.x, pnpm, and a Postgres database (a Neon connection string works).

### Backend

```bash
cd backend
pnpm install
# create backend/.env with DATABASE_URL and FRONTEND_URL (see Env Vars below)
node --import tsx/esm src/index.ts
```

The backend listens on `PORT` (default `3001` locally, `10000` on Render).

### Frontend

```bash
cd web
pnpm install
# create web/.env.local (see Env Vars below)
pnpm dev
```

The web app runs on `http://localhost:3000` and proxies API calls to the backend.

### Docker Compose

```bash
docker compose up
```

Brings up backend (`:3001`) and web (`:3000`) together.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable        | Required | Description                                            |
| --------------- | -------- | ------------------------------------------------------ |
| `DATABASE_URL`  | yes      | Postgres connection string.                            |
| `FRONTEND_URL`  | yes      | Allowed origin for CORS (the web app URL).             |
| `PORT`          | no       | Listen port. Defaults to `3001` (Render sets `10000`). |
| `NODE_ENV`      | no       | `production` in deployed environments.                 |
| `STRIPE_*`      | no       | Optional. Billing returns `503` until configured.      |

### Frontend (`web/.env.local`)

| Variable               | Required | Description                          |
| ---------------------- | -------- | ------------------------------------ |
| `NEXT_PUBLIC_API_URL`  | yes      | Backend base URL.                    |
| `NEON_AUTH_*`          | yes      | Neon Auth configuration.             |

> The database schema must be provisioned separately (the app does not create its own tables). The backend seeds idempotent sample data on first boot via the seeder; create the tables out-of-band first.
