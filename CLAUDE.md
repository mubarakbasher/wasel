# CLAUDE.md

## Project Overview

**Wasel** — Mikrotik Hotspot Voucher Manager. Mobile app (Flutter) + Node.js backend for operators to manage routers and create Wi-Fi vouchers. Full PRD in `project.pdf`.

## Architecture

1. **Mobile App** — Flutter/Dart, communicates with backend via HTTPS only
2. **Backend** — Node.js + Express + TypeScript, REST API (`/api/v1/`)
3. **FreeRADIUS** — AAA on VPS, vouchers stored as RADIUS users in PostgreSQL
4. **WireGuard** — VPN tunnels between VPS and routers (/30 subnets from 10.10.0.0/16)
5. **RouterOS API** — Router config/sessions over WireGuard (TCP 8728)

Vouchers are RADIUS users (not Mikrotik local hotspot users). Routers delegate auth to FreeRADIUS over WireGuard.

## Tech Stack

- **Mobile:** Flutter, Riverpod, GoRouter, Dio, flutter_secure_storage
- **Backend:** Node.js, Express, TypeScript, PostgreSQL, Redis, Zod
- **Infra:** FreeRADIUS 3.x (rlm_sql_postgresql), WireGuard, Docker Compose

## Key Design Decisions

- JWT auth: 15min access + 7day refresh with rotation, bcrypt cost 12
- AES-256-GCM encryption at rest for router credentials and RADIUS secrets
- Voucher disable = `Auth-Type := Reject` in radcheck; delete = remove + CoA disconnect
- Subscription tiers: Starter (1 router/500 vouchers), Professional (3/2000), Enterprise (10/unlimited)
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

## Mobile Navigation

Bottom tabs: Dashboard, Routers, Vouchers, Settings

## Phase 2 (Not Yet Built)

Admin web panel, push notifications, multi-language (fr/pt/sw/ar), advanced reports, bulk printing, biometric login.
