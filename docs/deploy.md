# Wasel — VPS Deployment & Phone Testing Guide

## Prerequisites

- Ubuntu 22.04 LTS VPS with root/sudo access (minimum 2 GB RAM, 20 GB disk)
- A domain name (e.g., `api.wa-sel.com`) pointing to your VPS IP — or use the raw IP
- Your phone on the same network as the VPS (or VPS accessible over the internet)
- Git, Docker, and Docker Compose installed on the VPS

---

## 1. VPS Initial Setup

### 1.1 Install Docker & Docker Compose

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

### 1.2 Configure WireGuard (managed by Docker)

WireGuard runs inside a Docker container — no need to install it on the host.

```bash
# Generate server keys (wireguard-tools only needed for key generation)
sudo apt install wireguard-tools -y

WG_PRIV=$(wg genkey)
WG_PUB=$(echo "$WG_PRIV" | wg pubkey)
echo "WG_SERVER_PRIVATE_KEY=$WG_PRIV"
echo "WG_SERVER_PUBLIC_KEY=$WG_PUB"

# Create the WireGuard config directory and config file
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

The WireGuard Docker container will automatically:
- Load the WireGuard kernel module
- Create and bring up the `wg0` interface
- Enable IP forwarding
- Apply the iptables rules for routing

### 1.3 Open Firewall Ports

Apply the canonical rule set below. It rate-limits SSH, scopes RADIUS ports to the WireGuard subnet only, and sets a default-deny inbound policy. The public API is reached via Nginx on 443, never directly — port 3000 stays closed on the public interface. The one exception is a **WG-subnet-scoped** rule for `3000/tcp`: a router pulls its selected hotspot login-page template from the backend **over the tunnel** (`http://10.10.0.1:3000/...`), so that port must be reachable from `10.10.0.0/16` only. Without it, applying a template reports `failed` because the router's `/tool fetch` can't reach the backend.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit 22/tcp                                                          comment 'SSH with rate limit'
sudo ufw allow 80/tcp                                                          comment 'HTTP (Let'"'"'s Encrypt)'
sudo ufw allow 443/tcp                                                         comment 'HTTPS'
sudo ufw allow 51820/udp                                                       comment 'WireGuard'
sudo ufw limit from 10.10.0.0/16 to any port 1812,1813 proto udp              comment 'RADIUS auth+accounting (WG only)'
sudo ufw allow from 10.10.0.0/16 to any port 3799 proto udp                   comment 'RADIUS CoA (WG only)'
sudo ufw allow from 10.10.0.0/16 to any port 3000 proto tcp                   comment 'Hotspot template fetch — router /tool fetch over WG only'
sudo ufw enable
```

WARNING: RADIUS ports (1812, 1813, 3799) and the backend port (3000) must never be exposed to the public internet. The rules above restrict them to the WireGuard tunnel subnet (10.10.0.0/16) only — 3000 is served publicly only through Nginx on 443.

---

## 2. Deploy the Backend

### 2.1 Clone the Repository

```bash
cd /opt
git clone <your-repo-url> wasel
cd wasel
```

### 2.2 Configure Environment

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

**Set these values in `backend/.env`:**

```env
NODE_ENV=production
PORT=3000

# PostgreSQL — backend uses network_mode:host, so connect via localhost
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=wasel
DB_USER=wasel
DB_PASSWORD=<STRONG_PASSWORD>

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# JWT — generate random secrets
JWT_ACCESS_SECRET=<RUN: openssl rand -hex 32>
JWT_REFRESH_SECRET=<RUN: openssl rand -hex 32>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Encryption key — must be 32 bytes hex (64 hex chars)
ENCRYPTION_KEY=<RUN: openssl rand -hex 32>

# CORS — your phone will connect to this
CORS_ORIGIN=https://wa-sel.com,https://api.wa-sel.com

# WireGuard — ENDPOINT is hostname/IP only (no port)
# STRONGLY prefer a DNS hostname (e.g. wg.wa-sel.com) over a raw IP.
# Every router stores this string in its peer's endpoint-address field, so a
# raw IP means the whole fleet has to be edited by hand if the VPS ever moves.
# With a DNS hostname, one DNS record change repoints every router at once.
WG_SERVER_PRIVATE_KEY=<from step 1.2>
WG_SERVER_PUBLIC_KEY=<from step 1.2>
WG_SERVER_ENDPOINT=wg.wa-sel.com
WG_SERVER_PORT=51820

# SMTP — use Gmail App Password or any SMTP provider
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@wasel.app

# FreeRADIUS — backend uses network_mode:host, so connect via localhost
RADIUS_HOST=127.0.0.1
RADIUS_AUTH_PORT=1812
RADIUS_ACCT_PORT=1813
RADIUS_COA_PORT=3799
```

**Generate secrets quickly:**

```bash
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"

# WireGuard keys
WG_PRIV=$(wg genkey)
WG_PUB=$(echo "$WG_PRIV" | wg pubkey)
echo "WG_SERVER_PRIVATE_KEY=$WG_PRIV"
echo "WG_SERVER_PUBLIC_KEY=$WG_PUB"
```

### 2.3 Set Compose-level Secrets

`docker-compose.yml` reads `POSTGRES_PASSWORD` and `REDIS_PASSWORD` from the environment (or an env-file). On the VPS, set them in `/etc/wasel/compose.env` (chmod 600):

```bash
sudo tee /etc/wasel/compose.env > /dev/null <<'EOF'
POSTGRES_PASSWORD=<STRONG_PASSWORD_matching_DB_PASSWORD_in_backend_.env>
REDIS_PASSWORD=<STRONG_PASSWORD_matching_REDIS_PASSWORD_in_backend_.env>
EOF
sudo chmod 600 /etc/wasel/compose.env
```

Then start compose with:

```bash
docker compose --env-file /etc/wasel/compose.env up -d
```

### 2.4 Build & Start

```bash
docker compose build
docker compose up -d
```

### 2.5 Run Database Migrations

```bash
docker compose exec backend node -e "require('./dist/migrations/runner.js').runMigrations()"
```

If that doesn't work (migrations may need ts-node), run them from the build step:

```bash
# Alternative: run migrations manually from host with Node installed
cd backend
npm ci
npm run migrate
```

### 2.6 Verify Everything is Running

```bash
# Check all containers are healthy
docker compose ps

# Test the health endpoint
curl http://localhost:3000/api/v1/health

# Check logs if something is wrong
docker compose logs backend
docker compose logs postgres
docker compose logs freeradius
```

Expected health response:
```json
{"status":"ok"}
```

### 2.7 Enable Autostart on Reboot (systemd)

Without this step, if the VPS reboots you must SSH in and run `docker compose up -d` manually.
`restart: unless-stopped` in `docker-compose.yml` only restarts individual containers after crashes —
it cannot bring the stack up from a cold host boot.

The unit file is version-controlled in the repo so it can be re-installed from a fresh VPS.

```bash
# Install the unit
sudo cp /root/wasel/scripts/wasel.service /etc/systemd/system/wasel.service
sudo systemctl daemon-reload
sudo systemctl enable --now wasel.service

# Confirm it is active
sudo systemctl status wasel.service
```

Expected output includes `Active: active (exited)` — this is correct for a `Type=oneshot`
unit with `RemainAfterExit=yes`. The containers are running even though the oneshot process
has already exited.

Running `systemctl enable --now` a second time is a no-op (idempotent).

**Verify after the next reboot:**

```bash
# After rebooting the VPS:
sudo systemctl status wasel.service && docker compose -f /root/wasel/docker-compose.yml --env-file /etc/wasel/compose.env ps
```

**To update the unit file** (e.g., after pulling a new version of the repo):

```bash
sudo cp /root/wasel/scripts/wasel.service /etc/systemd/system/wasel.service
sudo systemctl daemon-reload
sudo systemctl restart wasel.service
```

---

## 3. Set Up HTTPS (Recommended)

For phone testing over the internet, you need HTTPS (Flutter's release mode requires it).

### Option A: Nginx Reverse Proxy + Let's Encrypt

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

Create Nginx config:

```bash
sudo nano /etc/nginx/sites-available/wasel
```

```nginx
server {
    listen 80;
    server_name api.wa-sel.com;  # Replace with your domain

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/wasel /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Get SSL certificate
sudo certbot --nginx -d api.wa-sel.com
```

### Option B: Use Raw IP (Debug Testing Only)

If you don't have a domain, you can test with `http://<VPS_IP>:3000` directly. This only works with debug APKs (Flutter debug mode allows HTTP).

### 3.1 Landing page vhost (`wa-sel.com`)

The public marketing site (`landing/`) is built into its own nginx container by the compose stack and listens on loopback `127.0.0.1:8080`. The host nginx fronts it at the apex domain.

**Prereq:** DNS A records for `wa-sel.com` and `www.wa-sel.com` → the VPS IP. Ports 80/443 are already open in the §1.3 UFW rule set.

```bash
sudo nano /etc/nginx/sites-available/wasel-landing
```

```nginx
server {
    listen 80;
    server_name wa-sel.com www.wa-sel.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/wasel-landing /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d wa-sel.com -d www.wa-sel.com
```

**Deploying landing changes:** `docker compose --env-file /etc/wasel/compose.env build landing && docker compose --env-file /etc/wasel/compose.env up -d landing`. The page is fully static (no API, no env vars baked in), so the same image is safe on staging and prod. **Before first go-live:** replace the placeholder WhatsApp/APK links in `landing/src/config.ts`.

---

## 4. Point the Mobile App to Your VPS

### 4.1 Update API Base URL

Edit `mobile/lib/services/api_client.dart`, line 27-29:

```dart
ApiClient._internal() {
    final baseUrl = kDebugMode
        ? 'http://76.13.59.23:3000/api/v1'   // For debug builds
        : 'https://api.wa-sel.com/api/v1';        // For release builds
```

Or for quick testing, hardcode your VPS address:

```dart
final baseUrl = 'http://76.13.59.23:3000/api/v1';
```

### 4.2 Allow Cleartext HTTP on Android (Debug Only)

If testing over HTTP (no HTTPS), Android blocks cleartext traffic by default. Add this:

**Create** `mobile/android/app/src/main/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">YOUR_VPS_IP</domain>
    </domain-config>
</network-security-config>
```

**Edit** `mobile/android/app/src/main/AndroidManifest.xml` — add `networkSecurityConfig` to the `<application>` tag:

```xml
<application
    android:networkSecurityConfig="@xml/network_security_config"
    ...>
```

---

## 5. Build the APK & Install on Phone

### 5.1 Debug APK (Faster, Allows HTTP)

```bash
cd mobile
flutter pub get
flutter build apk --debug
```

Output: `build/app/outputs/flutter-apk/app-debug.apk`

### 5.2 Release APK (Optimized, Requires HTTPS)

```bash
flutter build apk --release
```

Output: `build/app/outputs/flutter-apk/app-release.apk`

### 5.3 Install on Phone

**Option A — USB cable:**
```bash
flutter install
```

**Option B — Transfer APK:**
- Copy the APK from `build/app/outputs/flutter-apk/` to your phone via USB, Google Drive, Telegram, etc.
- Open the APK on your phone and install (enable "Install from unknown sources" if prompted)

**Option C — Direct from connected device:**
```bash
flutter run --release  # Builds and installs on connected device
```

---

## 6. Test the Full Flow

### 6.1 Register & Login

1. Open the app on your phone
2. Tap "Register" — fill in name, email, phone, password
3. Check your email for the 6-digit OTP
4. Enter OTP on the verify screen
5. Login with your credentials

### 6.2 Set Up a Subscription (Manual Approval)

1. Go to Settings > View Plans
2. Select "Starter" plan
3. Note the payment reference code
4. Since there's no admin panel yet, approve manually via SQL:

```bash
docker compose exec postgres psql -U wasel -d wasel -c "
  UPDATE subscriptions SET status = 'active', start_date = NOW(), end_date = NOW() + INTERVAL '30 days'
  WHERE user_id = (SELECT id FROM users WHERE email = 'your@email.com');
  UPDATE payments SET status = 'approved'
  WHERE user_id = (SELECT id FROM users WHERE email = 'your@email.com');
"
```

### 6.3 Add a Router

1. Go to Routers tab > Add Router
2. Enter router name (model and version are optional)
3. View the Setup Guide — copy the Mikrotik CLI commands
4. Paste them into your Mikrotik router's terminal

### 6.4 Create a RADIUS Profile

1. Go to Profiles (from Settings or Routers)
2. Create a profile (e.g., "1-Hour Plan" — 1M up, 2M down, 3600s session timeout)

### 6.5 Create Vouchers

1. Go to Vouchers tab
2. Select your router from the dropdown
3. Tap + to create a single voucher or use bulk create
4. Select the profile you created
5. Tap Create

### 6.6 Test a Voucher

1. Connect a device to your Mikrotik hotspot
2. Enter the voucher username and password on the captive portal
3. Back in the app, go to your router > Active Sessions to see the connected user
4. Try disconnecting the session from the app

---

## 7. Useful Commands

### Logs

```bash
docker compose logs -f backend      # Follow backend logs
docker compose logs -f freeradius   # Follow RADIUS logs
docker compose logs -f postgres     # Follow DB logs
```

### Restart Services

```bash
docker compose restart backend
docker compose restart freeradius
docker compose down && docker compose up -d   # Full restart
```

### Database Access

```bash
docker compose exec postgres psql -U wasel -d wasel

# Useful queries:
SELECT id, email, is_verified FROM users;
SELECT * FROM subscriptions;
SELECT * FROM routers;
SELECT * FROM radcheck LIMIT 10;
SELECT * FROM radacct ORDER BY acctstarttime DESC LIMIT 10;
```

### Rebuild After Code Changes

```bash
git pull
docker compose build backend
docker compose up -d backend

# If migrations were added:
docker compose exec backend node -e "require('./dist/migrations/runner.js').runMigrations()"
```

### WireGuard Status

```bash
docker compose exec wireguard wg show
docker compose logs wireguard
```

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| App shows "No internet connection" | Check VPS firewall (port 3000 open), verify API URL in `api_client.dart` matches your VPS |
| App shows "Connection timed out" | VPS may be unreachable — try `curl http://<VPS_IP>:3000/api/v1/health` from your PC |
| Registration works but no OTP email | Check SMTP config in `.env`, check `docker compose logs backend` for SMTP errors |
| Router shows "offline" | WireGuard tunnel not established — run `docker compose exec wireguard wg show wg0` to check if wg0 exists and peer is listed. Check `docker compose logs wireguard` for errors. Verify port 51820/udp is open. Re-apply setup guide commands on MikroTik |
| WireGuard no handshake | Check: 1) `docker compose exec wireguard wg show wg0` shows the peer, 2) VPS firewall allows 51820/udp, 3) MikroTik endpoint-address is correct (no port in address), 4) Keys match |
| WireGuard container won't start | Check `/etc/wireguard/wg0.conf` exists and has correct format. Check `docker compose logs wireguard`. Ensure `/lib/modules` exists on host (kernel modules needed) |
| Voucher login fails on hotspot | Check FreeRADIUS logs: `docker compose logs freeradius`, verify RADIUS secret matches between router and VPS |
| "502 Bad Gateway" from Nginx | Backend container may be down: `docker compose ps`, `docker compose logs backend` |
| Android blocks HTTP requests | Add `network_security_config.xml` (see section 4.2) or use HTTPS |
| Health endpoint returns error | DB or Redis may not be ready: `docker compose ps` — check all services are "healthy" |

---

## Backups

The nightly backup script (`scripts/backup.sh`) runs at 01:15 UTC via a systemd timer, produces two encrypted artifacts, verifies the DB dump, and uploads to a dedicated Google Drive account. Retention: 7 daily + 4 weekly copies on Drive (~9 GB of the 15 GB free tier), 7 days locally on disk.

> **Backup window: 01:15–01:45 UTC.** Do not deploy or run manual DDL during this window. It runs before the daily backend jobs (02:10, 02:40, 03:30 UTC).

### What is backed up

| Artifact | Contents |
|----------|----------|
| `wasel-db-<date>.dump.gpg` | PostgreSQL custom-format dump (`-Fc`), `radpostauth` rows excluded (1.3 GB login log, schema kept), GnuPG symmetric AES-256 (authenticated encryption — decryption fails hard on tampering) |
| `wasel-settings-<date>.tar.gpg` | Single gzip tar containing: `/root/wasel/backend/.env` (holds ENCRYPTION_KEY), `backend/secrets`, `/etc/wireguard`, `/etc/wasel/compose.env` and related files, plus `backend_uploads.tar.gz` (the uploads volume — payment receipts). GnuPG symmetric AES-256 encrypted. |

The uploads volume is embedded as an inner archive (`backend_uploads.tar.gz`) inside the outer tar. The restore untars the outer archive, then separately untars `backend_uploads.tar.gz` into the volume (see restore procedure below).

### RTO / RPO

| Metric | Target |
|--------|--------|
| RPO (Recovery Point Objective) | 24 hours |
| RTO (Recovery Time Objective) | 2 hours |
| Local backup retention | 7 days (~6 GB on 96 GB disk) |
| Drive backup retention | 7 daily + 4 weekly ≈ 28 days (fits in 15 GB free tier) |

### Install (one-time, on each VPS)

**Step 1 — Create the encryption key**

```bash
mkdir -p /etc/wasel
openssl rand -hex 32 > /etc/wasel/backup.key
chmod 600 /etc/wasel/backup.key
chown root:root /etc/wasel/backup.key
```

Save the key in your password manager immediately. Without it, the backups cannot be opened.

> **The backup key is the master key.** It decrypts everything: the router-credential `ENCRYPTION_KEY`, the Postgres password, the WireGuard private keys — everything in the settings bundle. Keep it in a password manager that is off the server. Never upload it to Google Drive or any cloud storage. If the VPS is compromised and the key is also on the server, all backups are exposed.

**Step 2 — Create `/etc/wasel/backup.env`**

```ini
WASEL_DIR=/root/wasel          # /opt/wasel on staging
BACKUP_ENV=prod                # prod | staging
UPLOAD=1                       # 0 on staging (local-only)
BACKUP_DIR=/root/backups/auto
# Optional overrides:
# RCLONE_REMOTE=gdrive
# DRIVE_DAILY_KEEP=7
# DRIVE_WEEKLY_KEEP=4
# LOCAL_RETAIN_DAYS=7
```

```bash
chmod 600 /etc/wasel/backup.env
```

**Step 3 — Set up Google Drive (one-time)**

The token is generated on your Windows PC and transferred to the server via scp. It never passes through chat.

**On your Windows PC (PowerShell):**

```powershell
# Download rclone 1.68.2 for Windows (amd64) and unzip it.
# Direct URL:
Invoke-WebRequest -Uri "https://downloads.rclone.org/v1.68.2/rclone-v1.68.2-windows-amd64.zip" `
  -OutFile "$env:TEMP\rclone.zip"
Expand-Archive "$env:TEMP\rclone.zip" -DestinationPath "$env:TEMP\rclone"
$rclone = (Get-ChildItem "$env:TEMP\rclone" -Filter rclone.exe -Recurse).FullName

# Authorize with the drive.file scope. The second argument is base64 of
# {"scope":"drive.file"}, exactly as `rclone config create gdrive drive
# scope=drive.file config_is_local=false` prints it.
# This opens your browser: choose "Use another account", sign in with the
# dedicated backup Google account, and click Allow.
# With a scope argument, rclone prints the result as ONE base64 line between
# "--->" and "<---End paste" (not raw JSON). The lines below capture it to a
# file, decode it to the token JSON, and never print the token.
& $rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ" > "$env:TEMP\rclone-auth.txt"
$raw = [IO.File]::ReadAllText("$env:TEMP\rclone-auth.txt")
if ($raw -notmatch '(?s)--->\s*(\S+?)\s*<---') { throw "no token block in rclone output" }
$b = $Matches[1]; $b += ('=' * ((4 - $b.Length % 4) % 4))
$token = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b.Replace('-','+').Replace('_','/'))) | ConvertFrom-Json).token
if (-not ($token | ConvertFrom-Json).refresh_token) { throw "token has no refresh_token" }
[IO.File]::WriteAllText("$env:TEMP\wasel-gdrive-token.json", $token)
Remove-Item "$env:TEMP\rclone-auth.txt"

# Transfer to the server root home directory
scp -i "$env:USERPROFILE\.ssh\wasel_ops" `
  "$env:TEMP\wasel-gdrive-token.json" `
  root@<VPS-IP>:/root/gdrive-token.json

# Delete the local copy immediately
Remove-Item "$env:TEMP\wasel-gdrive-token.json"
```

**On the VPS:**

```bash
mkdir -p /etc/wasel/rclone
chmod 700 /etc/wasel/rclone

# Pinned rclone image (same digest as committed in backup.sh)
RCLONE_IMAGE="rclone/rclone:1.68.2@sha256:74c51b8817e5431bd6d7ed27cb2a50d8ee78d77f6807b72a41ef6f898845942b"

# Create the rclone remote using the token file
docker run --rm \
  -v /etc/wasel/rclone:/config/rclone \
  "${RCLONE_IMAGE}" \
  config create gdrive drive \
    scope=drive.file \
    "token=$(cat /root/gdrive-token.json)" \
    --non-interactive

chmod 600 /etc/wasel/rclone/rclone.conf

# Securely delete the token file — it's now in rclone.conf
shred -u /root/gdrive-token.json

# Verify the remote works (the image's entrypoint is already `rclone`)
docker run --rm -v /etc/wasel/rclone:/config/rclone "${RCLONE_IMAGE}" \
  about gdrive:
```

The rclone config uses Google's own published OAuth client (built-in to rclone). Refresh tokens from the `drive.file` scope do not expire while the app grant is active. rclone stores the refreshed token in `/etc/wasel/rclone/rclone.conf` automatically on each run.

**To revoke a single server's Drive access:** delete `/etc/wasel/rclone/rclone.conf` on that server — the next backup upload attempt will fail (no config). **To revoke all servers at once:** visit Google Account → Security → Third-party apps with account access → remove the rclone grant on the backup Google account. This immediately cuts off every server using that account's OAuth token.

**Step 4 — Install and enable the systemd timer**

```bash
cp /root/wasel/scripts/wasel-backup.service /etc/systemd/system/
cp /root/wasel/scripts/wasel-backup.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wasel-backup.timer
systemctl list-timers wasel-backup.timer
```

**Step 5 — Verify the pinned rclone digest**

The rclone digest `sha256:74c51b8817e5431bd6d7ed27cb2a50d8ee78d77f6807b72a41ef6f898845942b` is committed directly in `scripts/backup.sh` and used by default — no manual pinning needed. To verify it matches the image on this machine:

```bash
docker pull rclone/rclone:1.68.2
docker inspect --format '{{index .RepoDigests 0}}' rclone/rclone:1.68.2
# Should print: rclone/rclone@sha256:74c51b8817e5431bd6d7ed27cb2a50d8ee78d77f6807b72a41ef6f898845942b
```

If you need to use a different rclone version, set `RCLONE_IMAGE=rclone/rclone@sha256:<new-digest>` in `/etc/wasel/backup.env` after auditing the image.

**Step 6 — Verify the script with shellcheck (on the VPS)**

Docker Hub pulls work from the VPS. Run this after the first git pull:

```bash
docker run --rm \
  -v /root/wasel/scripts:/s \
  koalaman/shellcheck:stable \
  /s/backup.sh /s/backup-restore.sh
```

**Step 7 — Optional: heartbeat via healthchecks.io**

```bash
echo "https://hc-ping.com/<your-uuid>" > /etc/wasel/backup-heartbeat.url
chmod 600 /etc/wasel/backup-heartbeat.url
```

The script pings `<url>/start` at start, `<url>` on success, `<url>/fail` on failure.

### Manual run

```bash
# Full run (uploads to Drive):
/bin/bash /root/wasel/scripts/backup.sh

# Local-only (no Drive upload):
UPLOAD=0 /bin/bash /root/wasel/scripts/backup.sh

# Check the last run result:
journalctl -u wasel-backup.service --since "today" -n 50
```

### Restore procedure

**A. Inspect the settings bundle (without extracting)**

> **Never extract a settings bundle into `/` on a running server.** The bundle overwrites `/root/wasel/backend/.env`, `/etc/wireguard`, and `/etc/wasel` config files in place, which will disrupt the running stack. Use `--settings` to list contents, or extract into a scratch directory for inspection. Only extract into `/` on a **fresh replacement VPS** during disaster recovery (step C below).

```bash
/bin/bash /root/wasel/scripts/backup-restore.sh \
  --settings /root/backups/auto/wasel-settings-2026-11-06.tar.gpg
```

**B. Restore drill — DB (always use a throwaway container, never the live Postgres)**

```bash
# Download the dump from Drive if needed:
docker run --rm \
  -v /etc/wasel/rclone:/config/rclone \
  -v /root/backups:/data \
  "rclone/rclone:1.68.2@sha256:74c51b8817e5431bd6d7ed27cb2a50d8ee78d77f6807b72a41ef6f898845942b" \
  copy gdrive:wasel-backups/prod/daily/wasel-db-2026-11-06.dump.gpg /data/

# Run the restore drill — prints row counts, removes the throwaway container:
/bin/bash /root/wasel/scripts/backup-restore.sh \
  /root/backups/wasel-db-2026-11-06.dump.gpg

# Keep the container for further inspection:
/bin/bash /root/wasel/scripts/backup-restore.sh --keep \
  /root/backups/wasel-db-2026-11-06.dump.gpg
```

**C. Disaster recovery (new VPS)**

1. Provision a fresh VPS with Docker.
2. Clone the repo: `git clone ... /root/wasel && git checkout main`
3. Load `backup.key` from your password manager into `/etc/wasel/backup.key` (chmod 600). Do not restore it from the bundle — it is intentionally excluded from the bundle.
4. Restore the settings bundle — this places `backend/.env`, `/etc/wireguard`, etc. at their original paths and puts the uploads archive at `/uploads/backend_uploads.tar.gz`. The `.sha256` file is a transfer/corruption check only; integrity against tampering is guaranteed by gpg's authenticated decryption (the command below will fail with a non-zero exit if the file has been tampered with):

   ```bash
   # Only run this on a FRESH VPS — it overwrites /etc/wireguard, /root/wasel/backend/.env, etc.
   gpg --batch --quiet --pinentry-mode loopback \
     --passphrase-file /etc/wasel/backup.key \
     --no-symkey-cache \
     -d wasel-settings-<date>.tar.gpg | tar -xzf - -C /
   ```

5. Restore the uploads volume from the inner archive, then remove the extracted copy:

   ```bash
   docker volume create wasel_backend_uploads
   docker run --rm \
     -v wasel_backend_uploads:/v \
     -v /uploads/backend_uploads.tar.gz:/uploads.tar.gz:ro \
     alpine:3.20 \
     tar -xzf /uploads.tar.gz -C /v
   rm -r /uploads
   ```

6. Bring Postgres up: `docker compose --env-file /etc/wasel/compose.env -f /root/wasel/docker-compose.yml up -d postgres`
7. Restore the DB:

   ```bash
   gpg --batch --quiet --pinentry-mode loopback \
     --passphrase-file /etc/wasel/backup.key \
     --no-symkey-cache \
     -d wasel-db-<date>.dump.gpg \
     | docker compose --env-file /etc/wasel/compose.env \
         -f /root/wasel/docker-compose.yml \
         exec -T postgres pg_restore -U wasel -d wasel --no-owner --no-privileges
   ```

8. Start the full stack: `docker compose --env-file /etc/wasel/compose.env -f /root/wasel/docker-compose.yml up -d`
9. Run the restore drill (step B above) to verify row counts before cutting DNS.

RTO target: 2 hours. RPO: 24 hours (nightly backup).

### Key rotation

If you suspect the backup key has been exposed, or as a routine rotation:

1. Generate a new key: `openssl rand -hex 32 > /tmp/new-backup.key && chmod 600 /tmp/new-backup.key`
2. Run a full backup with the new key: `BACKUP_KEY_FILE=/tmp/new-backup.key /bin/bash /root/wasel/scripts/backup.sh`
3. Run the restore drill against the new archive to confirm it decrypts correctly.
4. Install the new key: `mv /tmp/new-backup.key /etc/wasel/backup.key`
5. Update your password manager with the new key.
6. Keep the old key in your password manager until the old archives age out of local and Drive retention (default: 28 days). Old archives encrypted with the old key cannot be decrypted with the new one.

---

## Off-Host Log Retention

Docker containers write logs to the host's journald/syslog by default. If the VPS is lost, those logs are gone. Choose one of the following approaches:

### Option A — rsyslog Forward to a Backup VPS

Install and configure rsyslog on the production VPS to forward all Docker container logs to a second VPS:

```bash
sudo apt install rsyslog -y
```

Add `/etc/rsyslog.d/99-wasel-remote.conf`:

```
# Forward all Docker (and other) logs to the backup VPS over TCP
*.* @@backup-host.example.com:514
```

On the **backup VPS**, enable the TCP receiver in `/etc/rsyslog.conf`:

```
module(load="imtcp")
input(type="imtcp" port="514")
```

Restart rsyslog on both hosts:

```bash
sudo systemctl restart rsyslog
```

Restrict port 514/tcp on the backup VPS firewall to the production VPS IP only.

### Option B — Docker Logging Driver to a Managed Service

Configure Docker to ship logs to a managed aggregation service (Fluentd, Loki, Datadog, etc.) by setting the logging driver in `docker-compose.yml` per service, or globally in `/etc/docker/daemon.json`:

```json
{
  "log-driver": "fluentd",
  "log-opts": {
    "fluentd-address": "localhost:24224",
    "tag": "wasel.{{.Name}}"
  }
}
```

Operator must choose and provision the target service. Recommended minimum: Grafana Loki (self-hosted on the backup VPS) or Datadog Free tier. Implementation is deferred pending operator decision — document your choice here once selected.

---

## RADIUS Message-Authenticator

FreeRADIUS is configured to require `Message-Authenticator` on all non-localhost clients (`clients.conf` block `default_wg_routers`). This mitigates the BlastRADIUS attack (CVE-2024-3596).

**RouterOS compatibility:**

- RouterOS 7.x sends `Message-Authenticator` automatically — no action needed.
- RouterOS 6.x operators must explicitly enable it on each RADIUS client:

```
/radius set [find] message-authenticator-required=yes
```

If a RouterOS 6 router stops authenticating after this change, the above command is the fix. Do not disable `require_message_authenticator` on the FreeRADIUS side as a workaround — upgrade RouterOS instead.
