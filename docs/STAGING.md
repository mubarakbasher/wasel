# Wasel — Staging VPS Runbook

## Context

Production is live with paying operators on a single VPS. There is currently no environment that exercises the full network and hardware path — WireGuard tunnel handshake over the public internet, FreeRADIUS authentication, RouterOS API on port 8728, CoA disconnect on 3799, and Nginx/TLS — before a change reaches paying users.

This runbook stands up a **dedicated, cheap, second VPS** that mirrors production exactly. It is the **pre-merge gate**: deploy the `dev` branch to staging, run the E2E checklist with a physical Mikrotik router, and only then promote `dev` to `main` to prod. The prod VPS is never used for testing. The two hosts share no secrets, no keys, and no state.

What staging validates that local development cannot:
- Public WireGuard handshake from a real Mikrotik router across the internet to the staging IP
- UFW firewall rules (RADIUS ports are scoped to the WG subnet, not reachable from the internet)
- Nginx TLS termination and Let's Encrypt certificate issuance for `api.wa-sel.cloud`
- RouterOS RADIUS auth and CoA disconnect against a real FreeRADIUS instance
- Database migrations applied against a prod-shaped schema (optional: against real volume)

---

## 0. Prerequisites

- Ubuntu 22.04 LTS VPS with root access (minimum 2 GB RAM, 20 GB disk — same spec as prod)
- A DNS A record for `api.wa-sel.cloud` pointing to `<STAGING_VPS_IP>` (or use the raw IP over HTTP with a debug APK — see section 3)
- One physical Mikrotik router **dedicated to staging** (see section 5)
- Access to the Wasel git repository

---

## 1. VPS Initial Setup

### 1.1 Install Docker and Docker Compose

```bash
sudo apt update && sudo apt upgrade -y

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

docker --version
docker compose version
```

### 1.2 Configure WireGuard (host-side config, container reads it)

WireGuard runs inside the Docker container. The host only needs `wireguard-tools` to generate the keypair, and `/etc/wireguard/wg0.conf` for the container to mount.

**Generate a keypair unique to staging. Never reuse the prod keypair.**

```bash
sudo apt install wireguard-tools -y

WG_PRIV=$(wg genkey)
WG_PUB=$(echo "$WG_PRIV" | wg pubkey)
echo "WG_SERVER_PRIVATE_KEY=$WG_PRIV"
echo "WG_SERVER_PUBLIC_KEY=$WG_PUB"
# Save these — you will paste them into backend/.env below.

sudo mkdir -p /etc/wireguard

sudo tee /etc/wireguard/wg0.conf > /dev/null <<EOF
[Interface]
PrivateKey = $WG_PRIV
Address = 10.10.0.1/16
ListenPort = 51820
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth+ -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth+ -j MASQUERADE
EOF

sudo chmod 600 /etc/wireguard/wg0.conf
```

The `eth+` wildcard matches any `eth*` interface. If your VPS uses a different naming convention (e.g., `ens3`), replace `eth+` with `ens+` or your specific interface name. Check with: `ip route | grep default`.

Both staging and prod use `10.10.0.1/16` internally. There is no conflict because they are separate hosts with separate network interfaces.

### 1.3 Open Firewall Ports

This is identical to the prod firewall. Restate it here so the staging VPS is never provisioned without it.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit 22/tcp                                                          comment 'SSH with rate limit'
sudo ufw allow 80/tcp                                                          comment 'HTTP (Let'"'"'s Encrypt)'
sudo ufw allow 443/tcp                                                         comment 'HTTPS'
sudo ufw allow 51820/udp                                                       comment 'WireGuard'
sudo ufw limit from 10.10.0.0/16 to any port 1812,1813 proto udp              comment 'RADIUS auth+accounting (WG only)'
sudo ufw allow from 10.10.0.0/16 to any port 3799 proto udp                   comment 'RADIUS CoA (WG only)'
sudo ufw enable
```

WARNING: RADIUS ports (1812, 1813, 3799) must never be exposed to the public internet. The rules above restrict them to the WireGuard tunnel subnet only.

---

## 2. Clone the Repository and Check Out the `dev` Branch

```bash
cd /opt
git clone <your-repo-url> wasel
cd /opt/wasel

git fetch origin
git checkout dev
git pull origin dev
```

Staging always runs `dev`, not `main`. Never check out `main` on the staging VPS.

---

## 3. Configure Environment

### 3.1 Generate Staging-Only Secrets

Every secret must be generated fresh for staging. **Do not copy any value from prod.** Different `ENCRYPTION_KEY` values mean the two environments cannot read each other's encrypted DB columns — this is intentional and desirable.

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
echo "REDIS_PASSWORD=$(openssl rand -hex 32)"
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
```

Copy all five outputs to a scratch file. You will paste them into the files below.

### 3.2 Create the Compose Env-File

`docker-compose.yml` reads `POSTGRES_PASSWORD` and `REDIS_PASSWORD` from this file. Store it outside the repo with restricted permissions.

```bash
sudo mkdir -p /etc/wasel

sudo tee /etc/wasel/compose.env > /dev/null <<'EOF'
POSTGRES_PASSWORD=<POSTGRES_PASSWORD from 3.1>
REDIS_PASSWORD=<REDIS_PASSWORD from 3.1>
EOF

sudo chmod 600 /etc/wasel/compose.env
```

### 3.3 Create the Backend Env-File

```bash
cp /opt/wasel/backend/.env.example /opt/wasel/backend/.env
nano /opt/wasel/backend/.env
```

Set the following values. Every line marked with a staging-specific note differs from prod.

```env
NODE_ENV=production
PORT=3000

# PostgreSQL — backend uses network_mode:host, connect via localhost
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=wasel
DB_USER=wasel
DB_PASSWORD=8a346067fcd5b58be1aad75a122ba46c6354883049477de50a1453451bc4e498        # staging-only value
DB_POOL_MIN=2
DB_POOL_MAX=10

# Redis — backend uses network_mode:host, connect via localhost
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=d17e43b51853ff8fd2904de559bf9aba610593f376c63b4376e6d99652afb3f4         # staging-only value

# JWT — staging-only secrets
JWT_ACCESS_SECRET=542e9bc2877f8a63c7e14c20491e2de28772a74004ec99b463bc551a24c724af
JWT_REFRESH_SECRET=e47f884d64e2f890ceae96995d995a1ce63a80d15a18dd43d80d32e12708053b
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Encryption — STAGING-ONLY KEY.
# AES-256-GCM encrypts router api_pass_enc, wg_private_key_enc, radius_secret_enc.
# Columns encrypted with this key cannot be decrypted by prod and vice versa.
# Never copy ENCRYPTION_KEY between environments.
ENCRYPTION_KEY=3cee3f2bb4e85f183e2e16572351c891b26eaeec5c49f9570e0895cec9b9a61d

# CORS — staging origins only
CORS_ORIGIN=https://api.wa-sel.cloud

# WireGuard — staging VPS public IP, staging keypair
WG_SERVER_PRIVATE_KEY=qPJsQbKdhVoPH5tH0hqq+e1cvyTwHtBYXXNq/pMoE3g=
WG_SERVER_PUBLIC_KEY=TKEiDLLaS4Grhp/EMZ341LfEEOrk7o/9gdaAgtzrXA8=
WG_SERVER_ENDPOINT=<STAGING_VPS_IP>             # staging VPS IP, not prod
WG_SERVER_PORT=51820

# SMTP — reuse your provider or point at MailHog for smoke testing
# To use MailHog: docker run -d -p 8025:8025 -p 1025:1025 mailhog/mailhog
# Then set SMTP_HOST=127.0.0.1 SMTP_PORT=1025 and visit :8025 for the inbox.
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=<your-resend-api-key>
SMTP_FROM=noreply@wa-sel.cloud

# FreeRADIUS — backend uses network_mode:host, connect via localhost
RADIUS_HOST=127.0.0.1
RADIUS_AUTH_PORT=1812
RADIUS_ACCT_PORT=1813
RADIUS_COA_PORT=3799
```

Secure the file:

```bash
chmod 600 /opt/wasel/backend/.env
```

---

## 4. Build and Start the Stack

Staging uses the same `docker-compose.yml` as production. Do not use `docker-compose.dev.yml` on the staging VPS.

```bash
cd /opt/wasel
docker compose --env-file /etc/wasel/compose.env up -d --build
```

Check that all containers reach a healthy state:

```bash
docker compose ps
```

All services should show `healthy` within 60–90 seconds. If any remain `starting`, check:

```bash
docker compose logs backend
docker compose logs postgres
docker compose logs freeradius
docker compose logs wireguard
```

### 4.1 Database Migrations

Migrations run automatically when the backend container boots via `backend/src/migrations/runner.ts` (called from `server.ts` before the HTTP listener starts). On a fresh DB they will apply all pending SQL files in `backend/src/migrations/sql/` in filename order.

If the backend exits during startup with a migration error, run them manually:

```bash
docker compose exec backend node -e "require('./dist/migrations/runner.js').runMigrations()"
```

### 4.2 Verify the Stack

```bash
# Health endpoint
curl http://localhost:3000/api/v1/health
# Expected: {"status":"ok"}

# WireGuard interface is up
docker compose exec wireguard wg show wg0

# FreeRADIUS process is running
docker compose exec freeradius pgrep -l freeradius
```

---

## 5. Set Up HTTPS

### Option A — Nginx + Let's Encrypt (Recommended)

This is required for release APK builds. Flutter's release mode enforces HTTPS.

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

Create the Nginx config:

```bash
sudo tee /etc/nginx/sites-available/wasel-staging > /dev/null <<'EOF'
server {
    listen 80;
    server_name api.wa-sel.cloud;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/wasel-staging /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Obtain a staging-specific Let's Encrypt certificate
sudo certbot --nginx -d api.wa-sel.cloud
```

The cert is bound to `api.wa-sel.cloud` and is completely independent from the prod cert for `api.wa-sel.com`.

### Option B — Raw IP over HTTP (Debug APKs Only)

If you do not want to set up a subdomain, you can build a debug APK that targets `http://<STAGING_VPS_IP>:3000/api/v1` directly. This requires an `AndroidManifest.xml` network security config to allow cleartext traffic (see `docs/deploy.md` section 4.2). Release builds cannot use this path.

**Recommendation**: use the subdomain (Option A). The cert is free, auto-renews, and is the only path that exercises the full TLS stack that prod uses.

---

## 6. Systemd Autostart

The unit file at `scripts/wasel.service` is version-controlled. It references `/root/wasel` as the working directory. Because staging clones to `/opt/wasel`, install it with a one-line path override:

```bash
sudo sed 's|WorkingDirectory=.*|WorkingDirectory=/opt/wasel|' \
     /opt/wasel/scripts/wasel.service \
     | sudo tee /etc/systemd/system/wasel-staging.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now wasel-staging.service
sudo systemctl status wasel-staging.service
```

Expected: `Active: active (exited)` — correct for `Type=oneshot` with `RemainAfterExit=yes`.

Verify after the next reboot:

```bash
sudo systemctl status wasel-staging.service && \
  docker compose -f /opt/wasel/docker-compose.yml --env-file /etc/wasel/compose.env ps
```

---

## 7. The Dedicated Staging Mikrotik Router

A physical Mikrotik router must be **permanently assigned to staging** and kept off prod.

When you add a router through the staging app, the generated setup script embeds the staging VPS IP (`<STAGING_VPS_IP>`) and the staging WireGuard public key as the WireGuard endpoint. This creates a tunnel to the staging VPS — not the prod VPS.

A RouterOS device can only maintain one WireGuard peer per interface pointing at a given VPN server. Plugging the same physical router into both staging and prod simultaneously is not supported. Keep the staging unit physically separate. Real operators' routers on prod are unaffected.

Both environments use the `10.10.0.0/16` internal subnet. There is no conflict because the WireGuard interfaces live on separate physical hosts.

---

## 8. Optional: Load a Sanitized Prod DB Dump

Loading a prod-shaped database into staging lets you test migrations against real data volume and query plans. This step is **optional** and comes with an important caveat.

**CAVEAT — encrypted columns will not work:** Router credentials (`api_pass_enc`, `wg_private_key_enc`, `radius_secret_enc`) are AES-256-GCM encrypted with `ENCRYPTION_KEY`. Staging has a different `ENCRYPTION_KEY` than prod, so any imported router rows cannot be decrypted on staging. The imported routers will appear in the DB but fail all API calls that touch credentials. For live tunnel tests, always create a fresh router on staging — never rely on imported router rows.

**Procedure (run on prod VPS, copy to staging):**

```bash
# 1. On prod VPS — dump and scrub PII (emails, names, phone numbers)
docker compose exec -T postgres pg_dump -U wasel wasel \
  | sed 's/\(email'\''[^'\'']*'\''\)/email_redacted/g' \
  > /tmp/staging-dump.sql

# 2. Copy to staging VPS
scp /tmp/staging-dump.sql root@<STAGING_VPS_IP>:/tmp/

# 3. On staging VPS — restore
docker compose exec -T postgres psql -U wasel -d wasel < /tmp/staging-dump.sql

rm /tmp/staging-dump.sql
```

The `sed` above is illustrative. Adapt it or use a proper anonymisation script to scrub all PII columns (`email`, `name`, `phone`, `password_hash`) before the file leaves the prod host.

After import: run the pending migrations so the staging schema is up to date with the `dev` branch.

```bash
docker compose exec backend node -e "require('./dist/migrations/runner.js').runMigrations()"
```

---

## 9. Backups on Staging

Staging data is disposable. Do not point staging at the prod backup target and do not configure elaborate retention. A one-liner is sufficient if you want a checkpoint before a risky migration test:

```bash
docker compose exec -T postgres pg_dump -U wasel wasel \
  | gzip > /tmp/staging-checkpoint-$(date +%F).sql.gz
```

Discard these when the test is done. If staging is torn down and rebuilt, the data loss is acceptable — that is the point.

---

## 10. Re-Deploying After `dev` Branch Changes

Every time new commits land on `dev`, re-deploy to staging before touching prod:

```bash
cd /opt/wasel
git pull origin dev
docker compose --env-file /etc/wasel/compose.env up -d --build
```

Migrations auto-run on backend restart. If the backend exits during migration, use the manual fallback from section 4.1.

---

## 11. Staging E2E Smoke Checklist

Run this checklist in order after every staging deploy. All items must pass before promoting to `main`. Record pass/fail and the timestamp.

### 11.1 Register and Login

- [ ] Open the staging app (debug APK pointing at `https://api.wa-sel.cloud/api/v1`)
- [ ] Register a new account with a real or MailHog email address
- [ ] OTP email arrives (check MailHog at `http://<STAGING_VPS_IP>:8025` if using MailHog SMTP)
- [ ] Enter OTP on the verify screen — account becomes verified
- [ ] Login succeeds, app reaches Dashboard

PASS: Dashboard loads with no errors in `docker compose logs backend`.

### 11.2 Manual Subscription Activation

```bash
docker compose exec postgres psql -U wasel -d wasel -c "
  UPDATE subscriptions SET status = 'active', start_date = NOW(), end_date = NOW() + INTERVAL '30 days'
  WHERE user_id = (SELECT id FROM users WHERE email = 'your@staging-test-email.com');
  UPDATE payments SET status = 'approved'
  WHERE user_id = (SELECT id FROM users WHERE email = 'your@staging-test-email.com');
"
```

PASS: App shows active subscription in Settings.

### 11.3 Add the Staging Router and Paste Setup Script

- [ ] Go to Routers tab > Add Router
- [ ] Enter the staging Mikrotik's name
- [ ] Copy the generated setup script — it must contain `<STAGING_VPS_IP>` as the WireGuard endpoint, not the prod IP
- [ ] Paste the script into the Mikrotik terminal (New Terminal in Winbox, or SSH)

PASS: No errors from the Mikrotik terminal.

### 11.4 WireGuard Tunnel Handshake

```bash
docker compose exec wireguard wg show wg0
```

PASS: The staging router's public key appears under `peers`, and `latest handshake` shows a time within the last 2 minutes.

FAIL trigger: `latest handshake` is absent or stale. Check UFW allows `51820/udp`, check the Mikrotik endpoint address is the staging IP, and recheck keys with `wg show wg0` vs. what the setup script embedded.

### 11.5 Router API Health

- [ ] In the app, the staging router status shows `online` (green)

PASS: Backend log shows a successful RouterOS API probe on 8728 over WireGuard.

FAIL trigger: Router shows `degraded` or `offline`. Check `docker compose logs backend` for RouterOS API errors. Verify the Mikrotik allows API access on 8728 (`/ip service enable api`).

### 11.6 Create RADIUS Profile and Voucher

- [ ] Go to Profiles > Create Profile (e.g., "Test — 1M/1M, 3600s timeout")
- [ ] Go to Vouchers tab > select the staging router > tap +
- [ ] Create one voucher with the test profile
- [ ] Note the voucher username and password

PASS: Voucher appears in the list with status `active`.

### 11.7 Connect a Real Phone and Authenticate

- [ ] Connect a phone to the Mikrotik hotspot SSID
- [ ] Enter the voucher username/password at the captive portal
- [ ] Internet access is granted

PASS: FreeRADIUS log shows `Access-Accept`:

```bash
docker compose logs freeradius | grep -i "access-accept"
```

PASS: Accounting starts — `radacct` row created with a null `acctstoptime`:

```bash
docker compose exec postgres psql -U wasel -d wasel -c \
  "SELECT acctsessionid, username, acctstarttime, acctstoptime FROM radacct ORDER BY acctstarttime DESC LIMIT 1;"
```

### 11.8 Disable Voucher — Expect Access-Reject

- [ ] In the app, disable the voucher (toggle off / disable action)
- [ ] On the connected phone, attempt a new authentication (disconnect and reconnect from the hotspot)

PASS: FreeRADIUS log shows `Access-Reject`:

```bash
docker compose logs freeradius | grep -i "access-reject"
```

PASS: `radcheck` for the voucher now contains `Auth-Type := Reject`:

```bash
docker compose exec postgres psql -U wasel -d wasel -c \
  "SELECT username, attribute, value FROM radcheck WHERE username = '<voucher-username>';"
```

### 11.9 Delete Voucher — Expect CoA Disconnect

- [ ] Re-enable the voucher so the phone can reconnect
- [ ] Wait for the phone to authenticate again (verify 11.7 pass state)
- [ ] Delete the voucher from the app

PASS: The app issues a CoA Disconnect-Request on port 3799. The backend log shows the CoA response. Verify:

```bash
docker compose logs backend | grep -i "coa"
```

PASS: The active session ends — `radacct` row now has `acctstoptime` set:

```bash
docker compose exec postgres psql -U wasel -d wasel -c \
  "SELECT acctsessionid, username, acctstarttime, acctstoptime FROM radacct ORDER BY acctstarttime DESC LIMIT 1;"
```

PASS: The phone loses internet access immediately after the delete.

### 11.10 Full Checklist Summary

| Step | Expected result | Pass / Fail |
|------|-----------------|-------------|
| Register + OTP | OTP email received, account verified | |
| Subscription activate | Active status in app | |
| Add router + setup script | No Mikrotik errors, staging IP in script | |
| WireGuard handshake | Peer visible in `wg show wg0`, handshake <2 min | |
| Router API health | App shows `online` | |
| Create profile + voucher | Voucher listed as active | |
| Phone connects + Access-Accept | `radacct` row created | |
| Disable voucher + Access-Reject | `Auth-Type := Reject` in radcheck | |
| Delete voucher + CoA Disconnect | `acctstoptime` set, phone drops | |

---

## 12. Promotion Gate — `dev` to `main` to Prod

This is the workflow that ties staging into the branch model described in `CLAUDE.md`.

```
dev branch  -->  staging VPS  -->  E2E checklist  -->  main branch  -->  prod VPS
```

### Step-by-step

**Before promoting, take a backup on prod:**

```bash
# On the prod VPS — run this first, before any prod changes
sudo mkdir -p /opt/wasel-backups
docker compose -f /opt/wasel/docker-compose.yml exec -T postgres pg_dump -U wasel wasel \
  | gzip \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass file:/etc/wasel/backup.key \
  > /opt/wasel-backups/pre-promote-$(date +%F-%H%M).sql.gz.enc
```

**Deploy to staging and run the checklist:**

```bash
# On the staging VPS
cd /opt/wasel
git pull origin dev
docker compose --env-file /etc/wasel/compose.env up -d --build
```

Run all items in section 11. Only proceed if every item passes.

**Promote `dev` to `main`:**

```bash
# On your local machine (not the VPS)
git checkout main
git merge dev --ff-only
git push origin main
```

If `--ff-only` fails, the branches have diverged. Resolve on `dev`, re-deploy to staging, re-run the checklist, then retry the promotion.

**Deploy to prod:**

```bash
# On the prod VPS
cd /opt/wasel
git pull origin main
docker compose --env-file /etc/wasel/compose.env up -d --build
```

**Verify prod health:**

```bash
curl https://api.wa-sel.com/api/v1/health
docker compose ps
docker compose logs backend | tail -50
```

**Rollback plan:** The prod backup taken before the promote is your restore point. To roll back the code, identify the previous image tag in `docker compose ps` history or from GHCR, update `docker-compose.yml` to pin that tag, and run `docker compose up -d`. For a DB rollback, restore from the pre-promote backup following the procedure in `docs/deploy.md` (Restore from Encrypted Backup).

Nothing reaches `main` or prod until the staging checklist in section 11 passes in full.

---

## 13. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Backend container exits immediately | Check `docker compose logs backend` — most likely a missing or mis-typed env var. Verify `backend/.env` exists and all secrets are non-empty |
| `POSTGRES_PASSWORD must be set` error on compose up | `/etc/wasel/compose.env` is missing or not being passed — confirm `--env-file /etc/wasel/compose.env` is in the command |
| WireGuard container won't start | Check `/etc/wireguard/wg0.conf` exists and is `chmod 600`. Check `docker compose logs wireguard`. Confirm `/lib/modules` is mounted read-only on the host |
| No WireGuard handshake from Mikrotik | Verify the setup script embedded `<STAGING_VPS_IP>` (not the prod IP). Confirm UFW allows `51820/udp`. Run `wg show wg0` to see if the peer is listed at all |
| Router shows `offline` in app | Tunnel is up but API is not responding. Check Mikrotik allows `/ip service` api on port 8728. Check `docker compose logs backend` for RouterOS API errors |
| `Access-Reject` on a freshly created voucher | Check `radcheck` for the voucher: `SELECT * FROM radcheck WHERE username='<voucher>'`. Should have `Cleartext-Password` only, no `Auth-Type := Reject` |
| CoA Disconnect not kicking the session | Confirm UFW allows `3799/udp` from `10.10.0.0/16`. Check Mikrotik has CoA enabled (`/radius incoming set accept=yes`). Check `docker compose logs backend` for CoA errors |
| certbot fails for `api.wa-sel.cloud` | DNS A record not yet propagated. Verify with `dig api.wa-sel.cloud` from a public resolver. The record must resolve to `<STAGING_VPS_IP>` before certbot can complete the HTTP-01 challenge |
| `502 Bad Gateway` from Nginx | Backend container is down. Check `docker compose ps` and `docker compose logs backend` |
| Imported prod router rows not usable | Expected — prod `ENCRYPTION_KEY` differs from staging. Create a fresh router on staging for tunnel tests (see section 8) |
| Health endpoint returns error after reboot | systemd unit may not have started. Check `sudo systemctl status wasel-staging.service` and `docker compose ps` |
