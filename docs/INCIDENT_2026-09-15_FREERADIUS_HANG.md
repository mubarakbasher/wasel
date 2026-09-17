# Prod incident report — FreeRADIUS hang, 2026-09-15

**Status:** root cause established 2026-09-16. Remediation implemented on `dev`, pending staging verification. Nothing in the remediation has been verified on staging yet. Prod promotion happens only on explicit instruction.

**Design spec:** [`superpowers/specs/2026-09-17-freeradius-hang-remediation-design.md`](superpowers/specs/2026-09-17-freeradius-hang-remediation-design.md)

## Summary

Prod FreeRADIUS (`wa-sel.com`, VPS `76.13.59.23`, repo `/root/wasel`) stopped answering all RADIUS traffic for about 5 hours. The process did not crash. Its main thread was stuck in an infinite loop inside `libtalloc`, so Docker kept reporting it healthy. A user-approved restart at 06:19 UTC fixed it.

The trigger was a use-after-free in FreeRADIUS 3.2.x dynamic-client expiry. The conditions that made it likely were our own: a 120 s client lifetime, and a Postgres overloaded by two backend jobs that full-scanned the largest tables every 30 s. Requests stuck in SQL outlived the timer that frees their client.

## Impact

| Item | Value |
|---|---|
| Outage window | 01:20:54 → 06:19 UTC (~5 h) |
| Effect | Zero RADIUS replies. No voucher could log in on any router. Accounting stopped. |
| Admin symptom | The "FreeRADIUS status" card spun forever. `GET /admin/freeradius/status` ran `radmin -e "show clients"` through `execFile` with no timeout. `radmin` blocked on the hung control socket, so the request never returned. No `radclient` probe was involved. |
| Other services | None went down. Backend, Postgres, Redis, WireGuard, admin and landing stayed up. |
| Detection | Manual (user report). No healthcheck, container monitor or alert fired. |

## Timeline (UTC)

| Time | Event |
|---|---|
| Ongoing before the incident | `validityExpiration` and `usageLimitEnforcement` run every 30 s with full scans on a capped Postgres. |
| 2026-09-15 01:20:49 | For one client, in the same second: `Ignoring duplicate packet ... unfinished request in component accounting module sql`, `Module sql(rlm_sql) became unblocked`, and `Received conflicting packet ... Giving up on old request` for four packet IDs. The router retransmitted while the original accounting request was still inside `rlm_sql`. |
| 01:20:54 | Last FreeRADIUS log line (`Adding client 10.10.3.46/32`). Last `radacct` update and last `radpostauth` row. The main thread enters an infinite loop. |
| 01:20:54 → 06:19 | No RADIUS replies. Docker reports the container `healthy`. |
| Before 06:19 | User reports the admin card not loading and RADIUS down. Read-only investigation on the box. |
| 06:19 | `docker compose restart freeradius` (user-approved). Service restored. |
| 2026-09-16 | Further read-only prod investigation establishes the DB-overload chain and the upstream timer-free mechanism. Remediation decisions made with the user. |
| 2026-09-17 | Design spec written. Remediation implemented on `dev`. |

## Causal chain

### 1. Database overload (upstream cause)

`backend/src/jobs/validityExpiration.ts` and `backend/src/jobs/usageLimitEnforcement.ts` ran every 30 s with no in-flight guard. Each tick ran full scans and hash joins across three large tables.

| Table | Size |
|---|---|
| `voucher_meta` | 1.29 M rows |
| `radacct` | 2.29 M rows, 1.7 GB |
| `radcheck` | 4.27 M rows |

The jobs mostly succeeded. An earlier note of "3 identical queries" was one query plus two parallel workers, not overlapping runs.

| Last 72 h of prod job logs | Count |
|---|---|
| Failures | 3 |
| Expirations set | 25,575 |
| Limits enforced | 4,572 |

### 2. Postgres was starved

| Metric | Value |
|---|---|
| Container limit | 1 GB RAM / 1 CPU, on a 2 vCPU / 7.9 GB host |
| `shared_buffers` | 128 MB |
| Cache hit ratio | 37.5 % |
| Read from disk in 4 months | 8.57 TB |
| CPU-throttled periods | 12 M of 65 M (~18 %) |

The cgroup memory limit also counts page cache. The 1 GB cap limited the OS cache as well as Postgres.

### 3. FreeRADIUS requests got stuck and were abandoned

FreeRADIUS uses an `rlm_sql` pool of max 10 connections and `max_request_time = 30`. With slow SQL, requests ran past their limit. Prod logs 300–1,100 "unfinished request" errors per hour, and still does after the restart. Most are in `<core>` module `<queue>`, then `accounting` and `authorize` module `sql`. Routers retransmit, and FreeRADIUS gives up on the old request while its thread may still be inside SQL.

### 4. Use-after-free in dynamic-client expiry (trigger)

Every router is a dynamic client. `freeradius/raddb/clients.conf` declared `10.10.0.0/16` with `dynamic_clients = dynamic_client_server` and `lifetime = 120`. With ~220 NAS rows, clients were freed and re-created about 420 times per hour. Each re-create runs SQL lookups from `sites-enabled/dynamic-clients`.

Upstream FreeRADIUS 3.2.x `src/main/listen.c`, `client_listener_find()`: an expired dynamic client is removed with `client_delete()`. It is then freed by `client_timer_free` on a timer:

```c
when.tv_sec += main_config.max_request_time + 20;
fr_event_insert(el, client_timer_free, client, &when, &client->ev);
```

There is no reference counting. With `max_request_time = 30`, the client is freed 50 s after expiry, whether or not a request still points at it. A request stuck in SQL beyond that window dereferences freed memory. That corrupts a talloc chain, and the next talloc walk in the main thread loops forever.

The hang began 5 seconds after "Giving up on old request" for a client (01:20:49 → 01:20:54).

| Claim | Confidence |
|---|---|
| Where it hung: main thread, talloc chain walk, zero syscalls | High |
| Mechanism: timed client free with no refcount, hit by a request stuck in SQL | High |
| Exact freed object and code path | Not provable. No core dump exists; the process never crashed. |

### 5. On-box evidence (captured during the outage)

- Main thread (tid 906338) in state `R`, ~92 % CPU, 310 CPU-minutes accumulated. All 8 worker threads idle in `futex_wait`.
- `strace -f -p` for 4 s: **zero syscalls**. Pure userspace loop.
- `perf record -t 906338`: **100 % of samples inside `libtalloc.so.2.3.3`**, at a handful of addresses. That is a walk of a talloc parent/child chain that has become cyclic or corrupt. It is the signature of a use-after-free or double-free, not of a busy server.
- `tcpdump -ni any udp port 1812`: inbound Access-Requests from ~40 routers every few seconds, **0 outbound** packets.
- `radacct.max(acctupdatetime)` and `radpostauth.max(authdate)` both frozen at 01:20:54.
- FreeRADIUS's Postgres sessions were all `idle`. This does not clear the database. The DB was idle at inspection only because the hung main thread was no longer sending it work.

### 6. Why nothing detected or recovered it

- **Healthcheck:** `pgrep freeradius || exit 1`. The process existed, so Docker reported `healthy` for 5 h and `restart: unless-stopped` never fired.
- **PID 1:** FreeRADIUS ran as PID 1 with no `init`. A PID 1 process ignores SIGKILL sent from inside its own container, so an in-container watchdog could not have killed it.
- **Uptime Kuma:** the freeradius container monitor reads Docker health, so it stayed green.
- **Admin card:** the untimed `radmin` call hung the request. The card showed a spinner, not an error, and nothing alerted.

## Root cause

A FreeRADIUS 3.2.x use-after-free: dynamic clients are freed on a timer with no reference counting. Two local conditions made it likely. The 120 s client lifetime produced ~420 client frees per hour. DB overload from 30 s full-scan jobs on a starved Postgres kept requests stuck in SQL past the 50 s free timer. The outage lasted 5 h because the healthcheck only checked that the process existed, and the process could not be killed from inside the container.

## What was ruled out

- **Host resources:** 88 GB disk free, 6.7 GB RAM available, no swap use. Load ~3 was the spinning thread. The limit that mattered was the Postgres container cap, not the host.
- **WireGuard / routers:** packets arrived over the tunnels (tcpdump inbound), so tunnels were up. Not the Hostinger black-hole pattern from the earlier outage.
- **Backend:** healthy, 200s on `/health`. The one `401` on `/admin/freeradius/status` was an unauthenticated browser request.
- **Recent deploy:** prod at `33a5b36` for 2–3 days with no FreeRADIUS config change. Containers up 3 days before the hang.
- **Overlapping job runs:** the concurrent queries were one query plus two parallel workers.

Postgres is **not** ruled out. See causal chain steps 1–3.

## Fix applied on prod (user-approved)

`docker compose restart freeradius` at 06:19 UTC. Verified: 36 replies in 6 s on port 1812, `Login OK` lines flowing, process CPU ~0 %. No other prod change.

## Remediation (implemented on `dev`)

**Status:** implemented on `dev`, pending staging verification. Unit tests and typecheck passed locally for each slice. Nothing has been verified on staging. Prod promotion only on explicit instruction. Full detail is in the [design spec](superpowers/specs/2026-09-17-freeradius-hang-remediation-design.md).

### 1. Cheap voucher enforcement (removes the DB overload)

- New `backend/src/services/voucherEnforcement.service.ts` tracks recently active usernames from `radacct`: open sessions, rows above an id watermark, recent stops, plus the previous tick's open set. The candidate query uses only index scans.
- `validityExpiration.ts` and `usageLimitEnforcement.ts` run a fast pass every 30 s. It is the same enforcement SQL, filtered with `AND vm.radius_username = ANY($1)`. It is skipped when there are no candidates.
- A single-flight guard stops overlapping runs.
- The unfiltered SQL still runs as a reconciliation pass: at startup (+3 min validity, +5 min usage) and daily at 02:10 / 02:40 UTC. It runs with `SET LOCAL statement_timeout = '300s'` and retries after 15 min on failure.
- Validity enforcement skips rows with a null `first_login` instead of failing the whole tick.
- `validityCoaDisconnect.ts` gains the same guard and `LIMIT 200` per tick.
- No migration or new index. Read-only prod `EXPLAIN`: filtered query cost ~24–31 k instead of ~430 k.

### 2. Postgres resources (`docker-compose.yml`)

The settings are now env-interpolated. Staging keeps the defaults. Prod values go in `/etc/wasel/compose.env` at promotion.

| Setting | Default (staging) | Prod value at promotion |
|---|---|---|
| `mem_limit` | 1g | 3g |
| `cpus` | 1.0 | 1.5 |
| `shared_buffers` | 256MB | 1GB |
| `effective_cache_size` | 512MB | 2GB |
| `work_mem` | 8MB | 16MB |
| `maintenance_work_mem` | 64MB | 128MB |
| `shm_size` | 128mb | 256mb |
| `random_page_cost` | 1.1 | 1.1 (assumes SSD; confirm with the provider) |

### 3. FreeRADIUS self-healing

- `init: true` on the freeradius service in both compose files. `docker-init` is PID 1, so FreeRADIUS can be killed from inside the container.
- New `freeradius/healthcheck.sh`, installed as `/usr/local/bin/wasel-healthcheck`. It sends Status-Server to `127.0.0.1:1812` with the localhost secret. Any `Access-` reply counts as healthy. The probe does no SQL and writes no log line.
- Healthcheck timing: interval 15 s, timeout 10 s, retries 4, start period 60 s. Failures in the first 90 s of process age are ignored.
- The kill threshold depends on the main thread. If its CPU time grew by at least 50 % of wall time since the first failure (a spin, the 2026-09-15 signature), the watchdog acts after 8 consecutive failures (~3 min). If it is blocked or stopped, it waits for 30 (~10 min). A DB stall blocks threads rather than spinning them, and after a restart the main thread runs the dynamic-client SQL lookups synchronously, so a short threshold would restart FreeRADIUS in a loop during a DB outage.
- At the threshold the script writes a per-thread dump (state, utime, wchan) to the container log, prefixed `freeradius-watchdog:`. It then SIGKILLs FreeRADIUS, and `restart: unless-stopped` brings the container back.
- Tunable without a rebuild: `FR_WATCHDOG_GRACE_S`, `FR_WATCHDOG_KILL_AFTER`, `FR_WATCHDOG_KILL_AFTER_STALLED`, `FR_WATCHDOG_HOLD_MAX_MIN`. They are container env, so changing one recreates the container.
- Operator hold: `touch /tmp/wasel-fr-watchdog-hold` inside the container stops the watchdog counting and killing for up to 30 min, so a live hang can be profiled (`docs/OBSERVABILITY.md` §2.7 step 0). Running `wasel-healthcheck` by hand is not read-only: it shares the kill counter.
- `freeradius/docker-entrypoint.sh` clears the watchdog counter and hold files on start. It then waits up to 60 s for a radmin socket created after the entrypoint started, and sets its mode to 0666. It does not delete `radmin.sock`. FreeRADIUS replaces a stale socket itself. Deleting it would break the live server's socket whenever the deploy gate `docker compose run --rm freeradius freeradius -XC` runs on the shared `freeradius_control` volume.
- Image tag renamed from `wasel-freeradius:3.2.4` to `wasel-freeradius:3.2.8` (dev: `3.2.8-dev`). New `.gitattributes` forces LF on `*.sh`.

### 4. No timed client frees

- `freeradius/raddb/clients.conf`: `lifetime = 0`. Cached dynamic clients never auto-expire, which removes the ~420 timed frees per hour.
- The backend evicts a cached client with `radmin -e "del client ipaddr <ip>"`. It does this after COMMIT on router create (before `addPeer`), router delete, and admin user delete. Eviction only accepts IPv4 addresses in `10.10.`. It never fails the request. An uncached IP is reported as `not_cached`. radmin phrases that as "not dynamically defined", because the lookup falls back to the static `10.10.0.0/16` network client.
- **Eviction still goes through the timed free.** `del client` only marks the client dead (`lifetime = 1`). The next packet from that IP makes `listen.c` delete the client and free it `max_request_time + 20` s later, with no reference counting. So each eviction is only safe when no request from that IP can still be stuck in SQL. Router delete and admin user delete therefore remove the WireGuard peer before evicting: the deleted router can no longer send, and the next packet from that IP normally comes from a different router much later. Router create evicts an IP whose old peer is already gone.
- After a manual `nas` edit, run the `radmin` command above, but only while the DB is healthy. If Postgres is slow, restart FreeRADIUS instead.
- Not done: a `query_timeout` for `rlm_sql`. It would bound how long a request can sit in SQL, below the free timer, and so close the remaining window for good. It changes auth and accounting behaviour under DB stalls, so it needs its own decision.
- **Ordering constraint:** `lifetime = 0` must never reach an environment without the eviction code. Otherwise a router re-created on the same tunnel IP will not authenticate until FreeRADIUS restarts.

### 5. `radmin` timeouts

`runRadmin()` in `backend/src/services/freeradius.service.ts` now has a 3 s timeout with SIGKILL and never throws. New helpers: `evictDynamicClient(ip)` and `getFreeradiusStartTime()` (parses `show uptime`).

### 6. Admin card responsiveness

- `GET /admin/freeradius/status` adds `radius: { responding, outcome, latencyMs }` from a 2 s Status-Server probe. With the `radmin` timeout it returns in ~3.5 s even when FreeRADIUS is hung.
- The admin card uses a 10 s request timeout, so a stuck request shows the error panel with Retry instead of a spinner.
- The card shows Unhealthy when `radius.responding` is `false`. It displays "RADIUS: responding (N ms)" or "RADIUS: not responding (no Status-Server reply)".

### 7. `freeradiusMonitor` Sentry alerts

New `backend/src/services/freeradiusMonitor.ts`, started in `server.ts`. It runs every `FREERADIUS_MONITOR_INTERVAL_MS` (default 60 s; `0` disables). It does not probe immediately at boot.

| Condition | Sentry event (tag `monitor=freeradius`) |
|---|---|
| 2 consecutive Status-Server failures | error "FreeRADIUS not answering Status-Server", once per episode |
| Probe succeeds again | info "FreeRADIUS answering again" |
| `show uptime` value changes while responding | warning "FreeRADIUS restarted" |
| `radmin` fails 3 times while RADIUS answers | warning "FreeRADIUS control socket unreachable" |

At promotion, also configure a Sentry alert rule on tag `monitor=freeradius` (email). For the WhatsApp alert, add the Uptime Kuma **Push** monitor fed by the `scripts/freeradius-health-push.sh` cron (`docs/OBSERVABILITY.md` §1.3). Changing the Docker Container monitor's retries is not enough. Uptime Kuma 1.x turns a running container with `unhealthy` health into Pending, never Down, and sends no notification for it, so that monitor stays silent through a hang.

### Staging verification (not yet run)

The full list is in the design spec under "Verification on staging". Key checks:

- Config applied: `SHOW shared_buffers`, `init` on, `/proc/1/comm` is `docker-init`.
- Simulated hang with `kill -STOP` on FreeRADIUS: unhealthy, watchdog thread dump, automatic restart within ~3 min. The socket keeps 0666 perms after restart. The admin card loads and shows "not responding". Voucher login works afterwards.
- A 100 s `docker compose pause postgres` does not restart FreeRADIUS.
- Router delete + recreate on the same tunnel IP authenticates immediately, with no FreeRADIUS restart.
- Enforcement correctness with test vouchers and synthetic `radacct` rows, including the startup reconciliation.
- `unfinished request` rate near 0 and no long job queries in `pg_stat_activity`.

The prod promotion checklist is in the design spec. It has not been executed.

## Follow-ups (out of scope)

- **FreeRADIUS 3.2.10 upgrade.** Separate change: rebuild `freeradius/Dockerfile` from the new tag and run the `docs/STAGING.md` E2E checklist.
- **Broken hotspot login pages.** 8,551 rejects in 13 h with username `[object HTMLInputElement]`, across many routers. The current templates in `backend/src/hotspot-templates/` look correct, so these are likely old or custom pages on the routers.
- **Retention and indexes.** `radacct` (1.7 GB since 2025-03), `radpostauth` (4.6 M rows) and `radcheck` (4.3 M rows) have no retention. `radacct_acctuniqueid_idx` duplicates the unique key. The `framedipaddress` and `acctsessionid` indexes on `radacct` have 0 scans.

## Upstream references

- [FreeRADIUS 3.2.x `src/main/listen.c` (`client_listener_find`, `client_timer_free`)](https://github.com/FreeRADIUS/freeradius-server/blob/v3.2.x/src/main/listen.c)
- [talloc use-after-free in event_socket_handler() on 3.2.8 (#5859)](https://github.com/freeradius/freeradius-server/issues/5859)
- [dynamic-clients hangs server if DB is unavailable (packetfence #1500)](https://github.com/inverse-inc/packetfence/issues/1500)
- [cache dynamic clients for 300s instead of per-packet lookups (packetfence #9287)](https://github.com/inverse-inc/packetfence/pull/9287)
- [3.2.3 container crashes after status-server (#5326)](https://github.com/FreeRADIUS/freeradius-server/issues/5326)
