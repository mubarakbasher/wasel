# Observability & Incident Response

How to **know something broke** (alerts), **see what happened** (errors + logs), and **fix it** (runbook). Covers the four failure classes: backend crashes, container/service death, whole-VPS outage, and mobile app crashes.

## Architecture

| Layer | Tool | Answers |
|---|---|---|
| Error tracking | **Sentry** (SaaS, free tier) | *Why* did the backend/app crash? Full stack trace + request context for every exception |
| Uptime & service alerting | **Uptime Kuma** (self-hosted, `docker-compose.monitoring.yml`) | *Is it up right now?* Alerts to WhatsApp when site/API/container goes down |
| Log viewing | **Dozzle** (self-hosted, same compose file) | *What was happening around the incident?* Searchable live + recent logs of every container |
| VPS dead-man's switch | **healthchecks.io** (SaaS, free) + `scripts/vps-heartbeat.sh` | *Is the VPS itself alive?* Kuma can't report its own host dying |
| WhatsApp delivery | **CallMeBot** (free) | Alert channel for Kuma and healthchecks.io |

Everything is fail-safe: Sentry code is a no-op when `SENTRY_DSN` is unset, and the monitoring stack is a separate compose project that keeps running while the app stack is redeployed.

---

## 1. One-time setup

### 1.1 Sentry (backend + mobile)

1. Create a free account at https://sentry.io → create org `wasel`.
2. Create **two projects**: `wasel-backend` (platform: Node.js → Express) and `wasel-mobile` (platform: Flutter). Each gives you a **DSN** (`https://...@...ingest.sentry.io/...`).
3. **Backend** — add to `backend/.env` on staging first, then prod:
   ```
   SENTRY_DSN=https://<backend-dsn>
   ```
   Then `cd backend && npm install` (adds `@sentry/node`) and redeploy (`docker compose up -d --build backend`).
4. **Mobile** — run `cd mobile && flutter pub get`, then bake the DSN into release builds only:
   ```
   flutter build apk --release --dart-define=SENTRY_DSN=https://<mobile-dsn>
   ```
   Debug builds without the define run with Sentry disabled.
5. In Sentry: **Settings → Alerts** → new alert rule "when a new issue is created → email" (WhatsApp for Sentry comes via the Kuma/healthchecks path; Sentry itself alerts by email).
6. **Verify**: temporarily hit a route that throws, or from the VPS: `docker compose exec backend node -e "throw new Error('sentry smoke test')"` — the event should appear in the Sentry project within seconds.

### 1.2 CallMeBot (WhatsApp channel)

1. From your phone, add CallMeBot's number and follow the activation flow at https://www.callmebot.com/blog/free-api-whatsapp-messages/ — you send it one WhatsApp message and it replies with your **apikey**.
2. Test:
   ```
   curl "https://api.callmebot.com/whatsapp.php?phone=<your-number-with-country-code>&text=test&apikey=<key>"
   ```

### 1.3 Uptime Kuma + Dozzle

```bash
cd /root/wasel
docker compose -f docker-compose.monitoring.yml up -d
```

Access (UIs bind to localhost only — use an SSH tunnel from your laptop):
```bash
ssh -L 3001:127.0.0.1:3001 -L 9999:127.0.0.1:9999 root@<vps-ip>
# Kuma:   http://localhost:3001
# Dozzle: http://localhost:9999
```

First launch: create the Kuma admin account, then:

1. **Notification** (Settings → Notifications → Add): type **CallMeBot**, endpoint `https://api.callmebot.com/whatsapp.php?phone=<number>&apikey=<key>&text=`. Mark "default enabled".
2. **Docker host** (Settings → Docker Hosts → Add): connection type *socket*, path `/var/run/docker.sock`.
3. **Monitors** (all with the WhatsApp notification attached):

   | Name | Type | Target | Interval |
   |---|---|---|---|
   | Site (landing) | HTTP(s) | `https://wa-sel.com` | 60 s |
   | API health | HTTP(s) + keyword `ok` | `https://api.wa-sel.com/api/v1/health` | 60 s |
   | Backend (direct) | HTTP(s) | `http://host.docker.internal:3000/api/v1/health` | 60 s |
   | backend container | Docker Container | `wasel-backend-1` | 60 s |
   | postgres container | Docker Container | `wasel-postgres-1` | 60 s |
   | redis container | Docker Container | `wasel-redis-1` | 60 s |
   | freeradius container | Docker Container | `wasel-freeradius-1` | 60 s |
   | wireguard container | Docker Container | `wireguard` | 60 s |
   | TLS cert expiry | (built into the HTTPS monitors) | — | alerts 14 days before expiry |

   Container names: confirm with `docker ps --format '{{.Names}}'` — compose names them `<project>-<service>-1`.

   Set retries to 2–3 so one blip doesn't page you.

4. Repeat the two public HTTP monitors for staging (`wa-sel.cloud`) if you want staging alerts.

### 1.4 VPS dead-man's switch (whole-VPS-down detection)

Kuma dies with the VPS, so an **external** service must notice silence:

1. Create a free check at https://healthchecks.io — name `wasel-vps`, period **1 minute**, grace **3 minutes**. Copy the ping URL.
2. On the VPS:
   ```bash
   echo "https://hc-ping.com/<uuid>" | sudo tee /etc/wasel/heartbeat.url
   sudo chmod 600 /etc/wasel/heartbeat.url
   chmod +x /root/wasel/scripts/vps-heartbeat.sh
   sudo crontab -e   # add:
   * * * * * /root/wasel/scripts/vps-heartbeat.sh
   ```
3. In healthchecks.io → Integrations → **Webhook**, URL:
   ```
   https://api.callmebot.com/whatsapp.php?phone=<number>&apikey=<key>&text=WASEL+VPS+DOWN+or+backend+dead
   ```
4. **Verify**: stop the cron (comment it out) for 5 minutes → you should get the WhatsApp message. Re-enable.

Note: the heartbeat only fires when the **backend health endpoint answers**, so a silent heartbeat means either the VPS is down, Docker is down, or the backend is dead — your highest-severity page, from a path that shares nothing with the VPS.

---

## 2. Incident runbook — "something crashed, what happened?"

### Step 0 — Which alert did you get?

| Alert | Meaning | Go to |
|---|---|---|
| healthchecks.io "VPS DOWN" | VPS unreachable or backend dead | §2.1 |
| Kuma: Site/API HTTP monitor down | Nginx/TLS/backend path broken | §2.2 |
| Kuma: a container monitor down | One service crashed/unhealthy | §2.3 |
| Sentry email: new backend issue | Exception in the API (may still be "up") | §2.4 |
| Sentry email: new mobile issue | App crashing on users' phones | §2.5 |

### 2.1 VPS down

1. `ping <vps-ip>`; try `ssh root@<vps-ip>`.
2. No SSH → check the Hostinger panel (VPS status, resource graphs, network issues) → restart the VPS from the panel.
3. After reboot the `wasel.service` systemd unit auto-starts the stack. Verify: `docker compose ps` (all healthy), then Kuma monitors turn green.
4. SSH works but backend dead → treat as §2.3 for the backend container.

### 2.2 Site/API down (VPS alive)

```bash
systemctl status nginx                 # nginx up?
curl -sk https://127.0.0.1 -H 'Host: api.wa-sel.com' | head   # TLS/vhost path
curl -s http://127.0.0.1:3000/api/v1/health                   # backend direct
curl -s http://127.0.0.1:3000/readyz                          # DB+Redis readiness
```
- Backend direct works but public URL doesn't → nginx or certificate: `nginx -t`, `journalctl -u nginx -n 50`, `certbot certificates`.
- Backend direct fails → §2.3.

### 2.3 Container crashed / unhealthy

```bash
cd /root/wasel
docker compose ps -a                          # who's dead? exit codes?
docker compose logs --tail=200 <service>      # last words before death
docker inspect --format '{{json .State}}' <container> | jq   # OOMKilled? exit code?
```
Or open **Dozzle** (http://localhost:9999 via tunnel) and read the crashed container's log with search — it shows stopped containers too.

Common patterns:

| Symptom | Likely cause | Fix |
|---|---|---|
| backend exits seconds after start, log shows `Invalid environment variables` | broken/missing `backend/.env` value | fix `.env`, `docker compose up -d backend` |
| backend log `Uncaught exception — exiting` | code bug — **full stack trace is in Sentry** | find the issue in Sentry, hotfix via staging gate |
| `OOMKilled: true` in inspect | memory limit hit | check for leak in Sentry/logs; temporarily raise `mem_limit` |
| postgres `28P01 password authentication failed` | `POSTGRES_PASSWORD` vs `DB_PASSWORD` mismatch (see STAGING.md gotcha) | align secrets; on a fresh volume `docker compose down -v` |
| freeradius up but auth failing | DB reachable? NAS row present? | `docker compose logs freeradius`, check `nas` table, 120 s NAS cache |
| wireguard unhealthy | `wg show wg0` fails in container | `docker compose restart wireguard`; check `/etc/wireguard/wg0.conf` |
| restart loop (`Restarting (1) x seconds ago`) | crash on boot | logs from the *previous* run: `docker logs --tail 200 <container>` still shows them |

After any fix: `docker compose ps` all healthy + Kuma green + `curl https://api.wa-sel.com/api/v1/health`.

### 2.4 Backend exception in Sentry (API still up)

Every unhandled error and 5xx now lands in Sentry with: stack trace, `request_id` tag, user id, method + URL, and environment (staging vs production).

1. Open the issue → **stack trace** tells you the file/line.
2. Copy the `request_id` tag → search it in Dozzle to see the surrounding request logs (the `requestLogger` middleware logs it).
3. Frequency matters: 1 event = maybe a fluke; spike = regression from the last deploy → consider rolling back (`git log`, redeploy previous commit via the normal staging→prod flow).
4. Fix on `dev` → staging gate → promote. Sentry marks the issue "resolved" and re-alerts if it regresses.

### 2.5 Mobile crash in Sentry

1. Issue shows device model, OS version, app version, and Dart stack trace.
2. Check "affected users" count to judge severity.
3. If it's a backend-caused crash (bad response shape), there is usually a paired backend Sentry event around the same timestamp.

### 2.6 After every incident (5 minutes)

- Write one line in `docs/RUNBOOKS.md` → *Incident log*: date, what broke, root cause, fix.
- If the failure mode wasn't caught by an alert, add a Kuma monitor or Sentry alert so it is next time.

---

## 3. Where the evidence lives (quick reference)

| Question | Place |
|---|---|
| Why did the process crash? | Sentry → issue → stack trace |
| What were the last log lines? | Dozzle, or `docker compose logs --tail=200 <svc>` |
| Was it killed (OOM) or did it exit? | `docker inspect --format '{{json .State}}' <container>` |
| What happened on *this specific request*? | Sentry `request_id` tag → search Dozzle |
| When exactly did it go down / come back? | Kuma monitor history |
| Is the DB/Redis reachable right now? | `curl http://127.0.0.1:3000/readyz` |
| Older logs (rotated)? | json-file keeps 3×10 MB per container (`/var/lib/docker/containers/...`); beyond that see deploy.md "Off-Host Log Retention" |

## 4. Costs & limits

- Sentry free tier: ~5k errors/month, 1 user — fine at current scale; errors-only config (no tracing) keeps usage low.
- Uptime Kuma + Dozzle: ~0.5 GB RAM total on the VPS, no external cost.
- healthchecks.io free: 20 checks. CallMeBot: free, personal use.

## 5. Staging first

As with everything: bring the monitoring compose file and `SENTRY_DSN` up on **staging (`wa-sel.cloud`)** first, confirm alerts fire (kill the backend container on purpose), then repeat on prod.
