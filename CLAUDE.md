# CLAUDE.md

## Project Overview

**Wasel** — Mikrotik Hotspot Voucher Manager. Flutter mobile app + React admin panel + Node.js/TypeScript backend, fronting a FreeRADIUS + WireGuard + PostgreSQL + Redis networking stack. Operators manage routers and issue prepaid Wi-Fi vouchers; the platform owner runs the admin panel. Full PRD and technical docs live in `docs/` (see the Documentation Index in `docs/PROJECT_SUMMARY.md`).

## Project State

**Before starting or resuming in-flight work (staging deployment, security hardening, deploys, or anything that depends on "where we left off"), read `docs/PROJECT_STATE.md`** — the living snapshot of what's done, what's in progress, the current blocker, and gotchas already hit. `docs/PROJECT_SUMMARY.md` is the fuller handover. Update `PROJECT_STATE.md` whenever that state changes.

## Documentation

All Markdown documentation lives in `docs/`. When creating any new `.md` file (audits, runbooks, plans, design notes, reports), write it to `docs/` — never to the repo root or a feature folder.

**Exceptions that stay in place** (tooling / convention require it): `CLAUDE.md` (root — read as project instructions), and `README.md` files in each project root (`./`, `admin/`, `mobile/`, `landing/`) since GitHub renders them per-directory.

## Architecture

1. **Mobile App** — Flutter/Dart, talks to the backend over HTTPS only
2. **Admin Panel** — React 19 / Vite SPA (platform-owner console), HTTPS only, served by Nginx on 443
3. **Backend** — Node.js + Express + TypeScript, REST API (`/api/v1/`), single source of truth
4. **FreeRADIUS** — AAA on the VPS; vouchers stored as RADIUS users in PostgreSQL
5. **WireGuard** — VPN tunnels between VPS and routers (`/30` subnets from `10.10.0.0/16`)
6. **RouterOS API** — Router config/sessions over WireGuard (TCP 8728)
7. **Landing Page** — `landing/`, public marketing site for `wa-sel.com` (bilingual AR-first Vite/React SPA, no backend dependency); compose service on loopback `:8080` behind the host Nginx

Vouchers are RADIUS users (not Mikrotik-local hotspot users). Routers delegate auth to FreeRADIUS over WireGuard.

## Tech Stack

- **Mobile:** Flutter, Riverpod, GoRouter, Dio, flutter_secure_storage
- **Admin:** React 19, Vite, TypeScript, React Router 7, TanStack React Query 5, Axios, Tailwind CSS, lucide-react
- **Backend:** Node.js, Express, TypeScript, PostgreSQL, Redis, Zod
- **Infra:** FreeRADIUS 3.2.8 (rlm_sql_postgresql), WireGuard, Docker Compose, Nginx + Let's Encrypt

## Key Design Decisions

- JWT auth: 15min access + 7day refresh with rotation, bcrypt cost 12
- AES-256-GCM encryption at rest for router credentials and RADIUS secrets
- Voucher disable = `Auth-Type := Reject` in radcheck; delete = remove rows + CoA disconnect
- **Subscription tiers are driven by the `plans` table (per-environment) — never hardcode router/voucher limits; read them from the active plan. Enterprise unlimited vouchers use the `-1` sentinel.**
- Manual bank transfer payments with admin verification
- Router status: online (handshake <150s + API responds), offline, degraded

## API Groups

| Group | Prefix |
|-------|--------|
| Auth | `/auth/` |
| Routers | `/routers/` |
| Vouchers | `/routers/:id/vouchers/` |
| Profiles | `/profiles/` |
| Sessions | `/routers/:id/sessions/` |
| Subscription | `/subscription/` |
| Dashboard | `/dashboard/` |
| Reports | `/reports/` (Pro/Ent tier-locked) |
| Notifications | `/notifications/` |
| Support | `/support/` |
| Admin | `/admin/*` |
| Public / Health | `/public/...`, `/health`, `/readyz` |

## Mobile Navigation

Bottom tabs: Dashboard, Routers, Vouchers, Settings

## Local Development

A parallel dev stack runs alongside the prod compose. Backend + admin run natively for hot-reload; only infra is in containers.

**Daily loop** (on `dev` branch):
```
docker compose -f docker-compose.dev.yml up -d   # postgres + redis + freeradius + mailhog
(cd backend && npm run dev)                       # nodemon/ts-node on :3000
(cd admin   && npm run dev)                       # Vite HMR on :5173
(cd mobile  && flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1)
```

**Local-only files (gitignored, never push):**
- `.env` (root) — `POSTGRES_PASSWORD` / `REDIS_PASSWORD` for compose interpolation
- `backend/.env.local` — dev secrets (JWT, ENCRYPTION_KEY, WG keys, dev DB/Redis creds)

Backend loads `.env.local` first then `.env`. Prod has no `.env.local` → silently no-op → unchanged.

**Dev ports (non-default to avoid collisions with other projects):**
- Postgres `127.0.0.1:5436` · Redis `127.0.0.1:6380` · FreeRADIUS `127.0.0.1:1812-1813/udp`
- Backend `:3000` · Admin Vite `:5173` · MailHog UI `:8025`

**Branch + deploy model (staging is the pre-merge gate):**
- All local commits land on `dev`.
- Push `dev` → **staging VPS** (`wa-sel.cloud`) → run the E2E checklist in `docs/STAGING.md` (WireGuard handshake, RADIUS auth, RouterOS API, TLS).
- Promote only after staging passes: `git checkout main && git merge dev --ff-only && git push origin main`.
- Prod VPS (`wa-sel.com`): `git pull origin main && docker compose up -d --build` (uses prod `docker-compose.yml`, never the dev one). Migrations auto-run on backend boot.
- **Never push directly to `main`. Prod is live with paying users.**

**Boundary — what stays local:**
- `.env` and `backend/.env.local` — gitignored.
- `docker-compose.dev.yml` — committed but never invoked on a VPS.
- Mobile `--dart-define` overrides — release builds default to `https://api.wa-sel.com/api/v1`.

**Code rule for the dev/prod split to stay clean:** read every connection string / secret / URL from `config` (parsed from the env-file at boot). Never hardcode `localhost`, dev ports, or env-specific values — they break on the VPS.

Full walkthrough in `docs/LOCAL_DEV.md`.

## Sub-Agent Routing

When a task arrives, the orchestrator delegates by domain. **Never let one agent cross domain boundaries** — always delegate. Agent definitions live in `.claude/agents/`.

| Task area | Agent |
|---|---|
| Flutter screens, widgets, Riverpod, GoRouter, Dio client | `wasel-mobile` |
| React 19 admin panel pages, TanStack Query, admin auth/UI | `wasel-admin` |
| Express routes, controllers, services, Zod, JWT issuance, tier enforcement | `wasel-backend` |
| `radcheck` / `radreply` / `radacct` rows, CoA disconnect, sqlcounter, FreeRADIUS module/site config, voucher-as-RADIUS-user attributes | `wasel-radius` |
| WireGuard peers, `/30` tunnel allocation, `wg` CLI, `tunnel_subnet_pool`, RouterOS API (live sessions/sysinfo over the tunnel) | `wasel-wireguard` |
| App-side schema migrations, indexes, Redis keys, query plans | `wasel-db` |
| Docker Compose, CI, VPS, FreeRADIUS container build | `wasel-devops` |
| Pre-merge security review (auth, crypto, secrets, audit logging) | `wasel-security` |

**Testing** is owned by the domain agent doing the work: `wasel-backend` writes Vitest/Supertest, `wasel-mobile` writes flutter_test, `wasel-db` covers migrations. There is no separate test agent.

**Pre-merge gate:** `wasel-security` audits the diff, then the orchestrator does the cross-cutting architecture review. (If you want these as dedicated agents, add `wasel-test` + `wasel-reviewer`.)

> Live sessions span two domains — listing uses the RouterOS API (`wasel-wireguard`), forced disconnect uses CoA (`wasel-radius`). The orchestrator coordinates both for a session feature.

## Parallel Dispatch Rules

**Run in parallel** when tasks are in different domains and touch different files.
Example: backend endpoint + Flutter screen + admin page can all run at once.

**Run sequentially** when there's a data dependency:
- `wasel-db` migration BEFORE the `wasel-backend` endpoint that uses it
- `wasel-backend` endpoint BEFORE the `wasel-mobile` / `wasel-admin` screen that calls it
- Any RADIUS / WireGuard work: `wasel-radius` / `wasel-wireguard` BEFORE `wasel-backend` wires it up

**Always run last:** `wasel-security` audit, then the orchestrator's architecture review, before merge.

## Feature Workflow Template

For any non-trivial feature, the orchestrator's plan should look like:

```
Phase 1 (sequential):
  - wasel-db: migration + indexes
  - wasel-radius / wasel-wireguard: if RADIUS / WG / RouterOS involved

Phase 2 (parallel):
  - wasel-backend: endpoints + Zod schemas
  - wasel-mobile / wasel-admin: screens / pages + providers
  - (each agent writes its own tests)

Phase 3:
  - wasel-security: audit the diff
  - orchestrator: cross-cutting architecture review
```

## Skills

High-frequency procedures live as playbooks in `.claude/skills/<name>/SKILL.md`. Invoke the matching skill before hand-rolling these tasks:

| Task | Skill |
|---|---|
| Add a backend REST endpoint (route + controller + service + Zod + test) | `add-endpoint` |
| Add a SQL migration (index, FK rules, append-only) | `add-migration` |
| Add a Flutter screen (provider + GoRouter wiring) | `add-flutter-screen` |
| Add an admin panel page (TanStack Query + route) | `add-admin-page` |

## Enforcement (hooks)

Project invariants are enforced by hooks in `.claude/settings.json` — secret-file protection (`.env*`, `compose.env`), migration immutability (no edits to applied `src/migrations/sql/` files), no direct push to `main`, and typecheck/lint on edit. Hooks fire for sub-agent tool calls too, so the gates apply to every agent. *(To be populated — next setup step.)*