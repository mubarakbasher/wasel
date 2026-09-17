# FreeRADIUS hang remediation (dev → staging)

## Context

On 2026-09-15 prod FreeRADIUS stopped answering all RADIUS for ~5 h (01:20→06:19 UTC) while Docker reported it healthy. A restart fixed it. The incident report is `docs/INCIDENT_2026-09-15_FREERADIUS_HANG.md` (uncommitted). Further read-only prod investigation on 2026-09-16 established the full causal chain:

1. **DB overload.** `backend/src/jobs/validityExpiration.ts` and `backend/src/jobs/usageLimitEnforcement.ts` run every 30 s with no in-flight guard. Every tick does three parallel full scans and hash joins of voucher_meta (1.29 M) × radacct (2.29 M, 1.7 GB) × radcheck (4.27 M). They mostly succeed: in 72 h prod logged 3 failures, 25,575 expirations set, 4,572 limits enforced. The "3 identical queries" seen earlier were one query plus 2 parallel workers, not overlapping runs.
2. **Starved Postgres.** Container capped at 1 GB / 1 CPU on a 2 vCPU / 7.9 GB VPS. `shared_buffers` 128 MB, cache hit ratio 37.5 %, 8.57 TB read from disk in 4 months, CPU-throttled in 18 % of periods.
3. **FreeRADIUS abandons requests.** rlm_sql pool max 10, 32 threads, `max_request_time` 30. Prod logs 300–1,100 "unfinished request" errors per hour, even after the restart.
4. **Use-after-free.** Dynamic clients use `lifetime = 120`. Upstream 3.2.x `listen.c` frees an expired client on a timer (`max_request_time + 20` s) with no reference counting. A request stuck in SQL longer than that still points at freed memory → talloc corruption → main thread infinite loop. The hang started seconds after a burst of "Giving up on old request".
5. **Blind detection.** Healthcheck is `pgrep freeradius`. FreeRADIUS is PID 1, so nothing inside the container can SIGKILL it. The admin status card calls `radmin` with no timeout, so it spins forever.

Verified on prod (read-only): Status-Server to `127.0.0.1:1812` with the localhost secret returns Access-Accept with no log line and no SQL; `radmin -e "show uptime"` prints `Up since <date>`; `del client ipaddr <ipaddr> …` exists; `pgrep` is in the image; prod and staging both read compose vars from `/etc/wasel/compose.env`. Staging VPS is 1 vCPU / 3.9 GB and shares the box with another stack.

## Decisions (user, 2026-09-16)

- Scope: all three tracks. FreeRADIUS self-healing, remove the client-free race, cut Postgres load (job rewrite + Postgres resources).
- Client cache: `lifetime = 0` plus backend eviction with `radmin del client ipaddr <ip>`.
- Alerts: Sentry (email rule) + Uptime Kuma WhatsApp via real container health.
- FreeRADIUS 3.2.10 upgrade: separate follow-up, not in this plan.

Also verified (read-only prod `EXPLAIN`, no execution): the existing job SQL plus `AND vm.radius_username = ANY($1::text[])` becomes index nested loops end to end, with cost ~24–31 k instead of ~430 k. The candidate query below uses only index scans. No new index or migration is needed.

## Track C1 — cheap voucher enforcement (backend)

**Principle:** keep the exact enforcement SQL. Run it filtered to recently active usernames every 30 s, and unfiltered only as a reconciliation pass.

- **New `backend/src/services/voucherEnforcement.service.ts`**: `createRadacctCandidateTracker()` returns `{ collect(): Promise<{ usernames: string[]; commit(): void }> }` with in-memory `watermark` (bigint, init `SELECT COALESCE(MAX(radacctid),0)`), `prevOpen: Set<string>`, `lastSuccessAt`. Each job owns one instance. `commit()` is called only after a successful tick. Export `_reset…` for tests. Candidate SQL (`$1` = watermark − 100 for out-of-order commits, `$2` = lastSuccessAt − 5 min):
  ```sql
  SELECT username, bool_or(acctstoptime IS NULL) AS open, max(radacctid)::text AS max_id FROM (
    SELECT username, acctstoptime, radacctid FROM radacct WHERE acctstoptime IS NULL
    UNION ALL SELECT username, acctstoptime, radacctid FROM radacct WHERE radacctid > $1::bigint
    UNION ALL SELECT username, acctstoptime, radacctid FROM radacct WHERE acctstoptime > $2::timestamptz
  ) s WHERE username <> '' GROUP BY username;
  ```
  Candidates = returned usernames ∪ `prevOpen` (catches a session that closed between ticks without relying on router clocks).
- **`validityExpiration.ts` and `usageLimitEnforcement.ts`**, same shape:
  - `let running = false` single-flight guard shared by fast pass and reconciliation.
  - Fast pass every 30 s: collect → existing SQL with the `ANY($1)` filter → existing apply code → `commit()`. Skip the query if there are no candidates.
  - Reconciliation = existing SQL unfiltered, on a dedicated client inside `BEGIN; SET LOCAL statement_timeout = '300s'` (pool default is 30 s). Runs once at startup (+3 min validity, +5 min usage) and daily (`0 10 2 * * *` / `0 40 2 * * *` UTC). On failure, reschedule +15 min. It covers backend downtime, the first tick after boot, late Stops, and manual DB edits.
  - Validity: skip rows whose `first_login` is null instead of throwing on the whole tick.
  - Keep exported start-function names so `server.ts` and docs stay valid.
  - No hook in `updateVoucher` is needed: reactivation already refuses exhausted vouchers (409), and any later login inserts a radacct row that the fast pass sees.
- **`validityCoaDisconnect.ts`**: add the same `running` guard and `LIMIT 200` (matches `dataUsageCoaDisconnect.ts`).
- **Tests** (Vitest, cronTicks + `__mockPoolQuery` patterns from `jobs/__tests__/dataUsageCoaDisconnect.test.ts`): tracker watermark/prevOpen/commit semantics; fast pass passes the candidate array and skips when empty; guard blocks a concurrent tick; reconciliation runs after its delay, uses `SET LOCAL statement_timeout`, reschedules on failure; Reject transaction sequence and rollback unchanged; null first_login skipped; validityCoa guard + LIMIT.

## Track C2 — Postgres resources (`docker-compose.yml`)

Env-interpolated so staging (1 vCPU / 3.9 GB, shared box) keeps safe defaults and prod sets values in `/etc/wasel/compose.env`:
```yaml
  postgres:
    command: [postgres, -c, "shared_buffers=${POSTGRES_SHARED_BUFFERS:-256MB}", -c, "effective_cache_size=${POSTGRES_EFFECTIVE_CACHE_SIZE:-512MB}",
              -c, "work_mem=${POSTGRES_WORK_MEM:-8MB}", -c, "maintenance_work_mem=${POSTGRES_MAINTENANCE_WORK_MEM:-64MB}",
              -c, "random_page_cost=${POSTGRES_RANDOM_PAGE_COST:-1.1}"]
    shm_size: ${POSTGRES_SHM_SIZE:-128mb}
    mem_limit: ${POSTGRES_MEM_LIMIT:-1g}
    cpus: ${POSTGRES_CPUS:-1.0}
```
Prod values for later promotion: `POSTGRES_MEM_LIMIT=3g`, `POSTGRES_CPUS=1.5`, `POSTGRES_SHARED_BUFFERS=1GB`, `POSTGRES_EFFECTIVE_CACHE_SIZE=2GB`, `POSTGRES_WORK_MEM=16MB`, `POSTGRES_MAINTENANCE_WORK_MEM=128MB`, `POSTGRES_SHM_SIZE=256mb`. Page cache is charged to the cgroup, so the 1 GB cap was also capping the cache.

## Track A — FreeRADIUS self-healing

- **`docker-compose.yml` and `docker-compose.dev.yml`, freeradius service:** `init: true` so FreeRADIUS is no longer PID 1 and can be SIGKILLed from inside. Healthcheck `['CMD', '/usr/local/bin/wasel-healthcheck']`, `interval: 15s`, `timeout: 10s`, `retries: 4`, `start_period: 60s`. Rename image tag to `wasel-freeradius:3.2.8` (dev: `3.2.8-dev`).
- **New `freeradius/healthcheck.sh`** (POSIX sh, copied to `/usr/local/bin/wasel-healthcheck` by `freeradius/Dockerfile`):
  - Find the freeradius PID via `/proc/*/comm`. Key a failure counter file by PID + process start ticks so it resets on restart.
  - Probe: `printf 'Message-Authenticator = 0x00\n' | timeout 6 radclient -x -t 3 -r 1 127.0.0.1:1812 status testing123`. Any `Received Access-` reply = healthy (no SQL, no radpostauth row, no log line; verified on prod).
  - Ignore failures during the first 90 s of process age.
  - Kill threshold depends on the main thread (review finding F2): after 8 consecutive failures (~3 min) if its CPU time grew by ≥ 50 % of wall time since the first failure (spin), else after 30 (~10 min; blocked or stopped, e.g. DB stall, where dynamic-client SQL runs on the main thread). At the threshold: write two passes of per-thread `/proc/<pid>/task/*/stat` state/utime/wchan to `/proc/1/fd/1` prefixed `freeradius-watchdog:`, then `kill -KILL <pid>`. docker-init exits and `restart: unless-stopped` brings the container back.
  - Operator hold: `/tmp/wasel-fr-watchdog-hold` (≤ 30 min) stops counting and killing so a live hang can be profiled.
- **`freeradius/docker-entrypoint.sh`:** clear `/tmp` watchdog counter and hold files; touch a start marker and chmod 0666 only a radmin socket newer than it, waiting up to 60 s. It must NOT delete `radmin.sock` (review finding F1): the `run --rm freeradius freeradius -XC` deploy gate shares the volume and would unlink the live server's socket. FreeRADIUS replaces a stale socket itself.
- **New `.gitattributes`:** `*.sh text eol=lf` (repo has `core.autocrlf=true`).

## Track B — no more timed client frees

- **`freeradius/raddb/clients.conf`:** `lifetime = 0` (upstream: "Lives forever"). Rewrite the comment: why (timer free without refcount, incident 2026-09-15), and that the backend evicts on router create/delete and admin user delete; after a manual `nas` edit run the radmin command or restart FreeRADIUS. Fix the header comment in `freeradius/raddb/sites-enabled/dynamic-clients`.
- **`backend/src/services/freeradius.service.ts`:**
  - `runRadmin(command, timeoutMs = 3000)`: callback `execFile` with `{ timeout, killSignal: 'SIGKILL', maxBuffer }`, add `timedOut` to the result, never throws. Replaces the untimed promisified call.
  - `evictDynamicClient(ip): Promise<'evicted'|'not_cached'|'invalid_ip'|'timeout'|'unavailable'|'error'>`. Require `net.isIPv4(ip) && ip.startsWith('10.10.')`. Run `del client ipaddr <ip>` (syntax verified on prod). Both `No such client` and `not dynamically defined` → not_cached (an uncached IP falls back to the static 10.10.0.0/16 network client, review finding F7), success → evicted. Log, never throw.
  - `getFreeradiusStartTime()`: parse `show uptime` → `Up since <date>` (verified on prod), null on failure.
- **Call sites, after COMMIT, awaited, non-fatal:** `router.service.ts` `createRouter` (allocated tunnel IP, before `addPeer`) and `deleteRouter` (old tunnel IP); `admin.service.ts` user delete (`DELETE FROM nas … RETURNING nasname`, evict each).
- **Tests:** new `services/__tests__/freeradius.service.test.ts` mocking `execFile` with the 4-arg callback (each outcome, invalid IP never spawns, timeout option, uptime parsing). Add `evictDynamicClient` to the `freeradius.service` mocks in `tests/router.test.ts`, `tests/adminRouterForUser.test.ts`, `tests/hotspotTemplate.test.ts`, and assert calls happen after COMMIT and failures don't fail the request.

**Ordering constraint:** Track B's `lifetime = 0` must never reach an environment without the eviction code, or a router re-created on the same IP never authenticates until a FreeRADIUS restart.

## Detection and alerting

- **`radclient.service.ts`:** `sendStatusServer({ timeoutMs })` → `{ responding, outcome, latencyMs }`, same spawn/kill-timer structure as `sendAccessRequest`.
- **`admin.controller.ts` `getFreeradiusStatus`:** add `radius: { responding, outcome, latencyMs }` via `sendStatusServer({ timeoutMs: 2000 })`. With the radmin timeout the endpoint returns within ~3.5 s even when FreeRADIUS is hung.
- **New `backend/src/services/freeradiusMonitor.ts`** (pattern of `wireguardMonitor.ts`), started in `server.ts`, interval `FREERADIUS_MONITOR_INTERVAL_MS` (Zod in `config/index.ts`, default 60000, 0 disables, added to `backend/.env.example`):
  - 2 consecutive probe failures → one `Sentry.captureMessage('FreeRADIUS not answering Status-Server', level error, tag monitor=freeradius)` per episode; recovery → one info message.
  - While responding, a changed `show uptime` value → warning "FreeRADIUS restarted" (first read is baseline only).
  - radmin failing 3× while RADIUS answers → one warning "control socket unreachable" (would break eviction).
  - In-flight guard, `_resetFreeradiusMonitorState()`; tests mirror `services/__tests__/wireguardMonitor.test.ts`.
- **Admin `admin/src/pages/SettingsPage.tsx` FreeradiusCard:** type gains `radius`; request `{ timeout: 10_000 }`; unhealthy when `radius.responding === false`; show "RADIUS: responding (N ms)" or "not responding". Update `admin/src/pages/__tests__/SettingsPage.freeradius.test.tsx` with a not-responding case and the timeout assertion.
- **Uptime Kuma + Sentry config:** Kuma 1.x never pages on an unhealthy container (review finding F4), so a host cron `scripts/freeradius-health-push.sh` pushes the container health to a Kuma Push monitor (heartbeat 120 s, retries 0, WhatsApp). Sentry alert rule on tag `monitor=freeradius`, level ≥ warning → email.

## Docs

- Save this design as `docs/superpowers/specs/2026-09-17-freeradius-hang-remediation-design.md`.
- `docs/INCIDENT_2026-09-15_FREERADIUS_HANG.md`: admin card spun on untimed `radmin`, not radclient; replace "Postgres ruled out" with the DB-overload chain and upstream timer-free mechanism; parallel workers, not overlap; FreeRADIUS was PID 1; final decisions.
- `docs/OBSERVABILITY.md`: §1.3 Kuma row + Sentry tag rule; §2.3 replace "120 s NAS cache"; new "FreeRADIUS hung" runbook (health log, `freeradius-watchdog` lines, `ps -L` → `strace -c` → `perf record -t` → tcpdump in/out, hourly `unfinished request` count as the DB-saturation signal).
- `docs/STAGING.md:267`: replace the `pgrep` check with the healthcheck script + `docker inspect` health; note POSTGRES_* vars.
- `docs/PROJECT_STATE.md`: incident section → root cause established, fixes on dev, staging status, prod checklist pointer. Leave the user's other uncommitted edits alone.
- Stale mentions of the image tag / healthcheck / job mechanics in `docs/TRD.md`, `docs/BACKEND_SCHEMA.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/APP_FLOW.md`.

## Execution (ultracode on: orchestrate with agents)

| Phase | Work | Agent |
|---|---|---|
| 1 (parallel) | clients.conf + dynamic-clients comments; `freeradius.service.ts` + `radclient.service.ts` primitives + tests | radius-networking |
| 1 (parallel) | healthcheck.sh, Dockerfile, entrypoint, both compose files (FreeRADIUS + Postgres), `.gitattributes` | devops-infra |
| 2 (parallel) | tracker + job rewrites + validityCoa guard + tests; eviction call sites; status endpoint; monitor + config + server.ts; mock updates | backend-api |
| 2 (parallel) | FreeradiusCard + test | general-purpose (no admin agent exists) |
| 3 | docs | devops-infra (runbooks), orchestrator (incident, state, spec) |
| 4 | `npm run lint && npm test` in backend and admin, `npm run build` in admin | orchestrator |
| 5 | audit (radmin argv/IP validation, SIGKILL scope, testing123 loopback-only, admin-only endpoint), then architecture review | security-auditor, then code-reviewer |

**Commits on `dev`** (fewer, larger, each deployable in order):
1. `fix(backend,admin): incremental voucher enforcement, radmin timeouts + client eviction, FreeRADIUS monitor and responsiveness`
2. `fix(radius,infra): never-expiring dynamic clients, Status-Server watchdog with init, Postgres resources; docs for the 2026-09-15 incident`

Then push `dev` and deploy to staging (`/opt/wasel`, `docker compose --env-file /etc/wasel/compose.env up -d --build`, after `run --rm --no-deps -T freeradius freeradius -XC`).

## Verification on staging (185.166.39.70, `ssh -i ~/.ssh/wasel_ops`)

1. **Config applied:** `docker compose … config | grep -nE 'shared_buffers|mem_limit|init: true|wasel-healthcheck'`; `SHOW shared_buffers`; `docker inspect -f '{{.HostConfig.Init}} {{.State.Health.Status}}' wasel-freeradius-1`; `/proc/1/comm` in the container is `docker-init`.
2. **Probe + socket:** Status-Server reply from inside freeradius and backend containers; `ls -l /var/run/freeradius/` shows `srw-rw-rw-`; `radmin show uptime`; `del client ipaddr 127.0.0.1` → "not dynamically defined"; `del client ipaddr 10.10.250.2` → "not dynamically defined" (classified not_cached). Run the `-XC` gate and confirm `radmin.sock` survives it.
3. **Simulated hang:** `docker compose exec freeradius sh -c 'kill -STOP $(pgrep -x freeradius)'`; poll health + RestartCount every 30 s. A stopped process is not a spin, so expect unhealthy ~75 s and a restart after ~30 counted failures (~10–12 min), `freeradius-watchdog` thread dump with state `T` and `spinning=no`, socket still 0666 after restart, admin card showed "not responding" and loaded within ~5 s, Sentry error → "restarted" warning → recovery info (if `SENTRY_DSN` set on staging), voucher login works after.
4. **No restart on DB stall:** `docker compose pause postgres; sleep 100; docker compose unpause postgres` → RestartCount unchanged.
5. **Eviction:** with the staging MikroTik authenticating, delete the router (backend log `evicted`), recreate it (same lowest-free IP), apply setup, voucher login works immediately without a FreeRADIUS restart.
6. **Enforcement correctness** with test vouchers and synthetic radacct rows on `nasipaddress '10.10.250.2'` (no nas row, so no CoA to a real router): validity voucher gets `Expiration` within 30 s of a new row; data voucher over limit on an open row gets `Auth-Type := Reject` + status expired; session closed between ticks is caught via prevOpen; a closed over-limit row inserted while the backend is stopped is caught only by the startup reconciliation. Clean up `acctuniqueid LIKE 'wasel-test-%'` and the test vouchers.
7. **Load:** `pg_stat_activity` shows no long job queries; `docker compose logs --since 1h freeradius | grep -c 'unfinished request'` stays near 0.
8. Test gates from Execution phase 4 all green.

## Prod promotion checklist (hand to user; NOT executed without explicit instruction)

1. Staging green; `pg_dump` backup; note current SHA.
2. Add POSTGRES_* prod values to `/etc/wasel/compose.env`; confirm with `docker compose --env-file /etc/wasel/compose.env config`.
3. Merge `dev` → `main` with `--no-ff`; `git pull` in `/root/wasel`; build backend, admin, freeradius; `freeradius -XC`.
4. `up -d backend admin` (~15–30 s API blip). Watch startup reconciliation at +3/+5 min.
5. `up -d freeradius` (~5 s RADIUS blip, routers retransmit). Check health, socket 0666, logins, `unfinished request` rate.
6. Low-traffic window, not 02:10/02:40 UTC: `up -d postgres` (~10–30 s DB blip). Check `SHOW shared_buffers`, limits, throttling trend.
7. Configure Sentry tag rule and Kuma retries.
8. Rollback: old SHA + rebuild; remove POSTGRES_* lines + `up -d postgres`. No schema changes.

## Out of scope (follow-ups)

- FreeRADIUS 3.2.10 upgrade (user decision: separate change).
- 8,551 rejects in 13 h with username `[object HTMLInputElement]` across many routers: a hotspot login page script bug. Current templates in `backend/src/hotspot-templates/` look correct, so likely old or custom pages on routers.
- radacct (1.7 GB since 2025-03) / radpostauth (4.6 M rows) / radcheck (4.3 M rows) retention, and unused or duplicate radacct indexes (`radacct_acctuniqueid_idx` duplicates the unique key; `framedipaddress` and `acctsessionid` indexes have 0 scans).

## Review outcomes (2026-09-17)

Independent review (security, architecture, enforcement correctness, runtime, plan conformance) with adversarial verification. Fixed before commit:

- **F1** entrypoint no longer deletes `radmin.sock` (the `-XC` gate would have broken eviction on the live server).
- **F2** watchdog distinguishes a CPU spin (kill ~3 min) from a blocked/stopped main thread (kill ~10 min) so a DB outage does not cause a restart loop; dash simulation 8/8.
- **F3** failed enforcement transactions destroy their pooled connection (`client.release(true)`) instead of returning a possibly idle-in-transaction client.
- **F4** Kuma alerting via a Push monitor fed by `scripts/freeradius-health-push.sh` (Kuma 1.x ignores unhealthy).
- **F5** STAGING.md Postgres values match compose and this design.
- **F6** eviction still uses the timed free once per eviction; admin user delete now removes WireGuard peers before evicting, like router delete.
- **F7** `not dynamically defined` for a 10.10.x IP means not cached.
- **F8** operator hold file + corrected runbook; **F9** reconciliation test asserts the unfiltered SQL; **F10** radmin syntax in runbook; **F11** exact Sentry message strings in docs.

Open decision (not implemented): an `rlm_sql` `query_timeout` would bound time in SQL below the client free timer and bound main-thread dynamic-client lookups, closing the last use-after-free window, but it changes auth/accounting failure behaviour under DB stalls.
