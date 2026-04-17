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

```bash
sudo ufw allow 22/tcp       # SSH
sudo ufw allow 80/tcp       # HTTP (for Let's Encrypt)
sudo ufw allow 443/tcp      # HTTPS
sudo ufw allow 3000/tcp     # Backend API (direct, or remove if using reverse proxy)
sudo ufw allow 51820/udp    # WireGuard

# WARNING: RADIUS ports must never be exposed to the public internet. The rule below restricts them to the WireGuard peer subnet.
# RADIUS — restricted to WireGuard subnet ONLY. Never allow public.
sudo ufw allow from 10.10.0.0/16 to any port 1812,1813,3799 proto udp

sudo ufw enable
```

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
WG_SERVER_PRIVATE_KEY=<from step 1.2>
WG_SERVER_PUBLIC_KEY=<from step 1.2>
WG_SERVER_ENDPOINT=76.13.59.23
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

### 2.3 Update docker-compose.yml Postgres Password

Change the `POSTGRES_PASSWORD` and `RADIUS_DB_PASS` in `docker-compose.yml` to match your `DB_PASSWORD`:

```bash
nano docker-compose.yml
```

Replace every `changeme` with your chosen database password.

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

Regular PostgreSQL backups are essential. The database holds all user accounts, routers, subscriptions, vouchers, and RADIUS records.

### Manual Backup (one-liner)

```bash
mkdir -p /opt/wasel-backups
docker compose exec -T postgres pg_dump -U wasel wasel | gzip > /opt/wasel-backups/$(date +%F).sql.gz
```

### Automated Daily Backup (crontab)

Edit root's crontab with `sudo crontab -e` and add the following line to run daily at 03:00 and prune backups older than 30 days:

```
0 3 * * * docker compose -f /opt/wasel/docker-compose.yml exec -T postgres pg_dump -U wasel wasel | gzip > /opt/wasel-backups/$(date +\%F).sql.gz && find /opt/wasel-backups -name "*.sql.gz" -mtime +30 -delete
```

Note the escaped `\%F` — cron treats unescaped `%` as a newline.

### Restore from Backup

```bash
gunzip -c /opt/wasel-backups/2026-04-17.sql.gz | docker compose exec -T postgres psql -U wasel -d wasel
```

### Off-Host Copies

Local backups do not protect against VPS loss. Copy backups to another host on a regular schedule, e.g.:

```bash
# Push the latest backup to a remote server via scp
scp /opt/wasel-backups/$(date +%F).sql.gz backup-user@backup-host:/path/to/wasel-backups/
```

Consider a dedicated offsite target (another VPS, S3-compatible object storage, or a home server) and rotate credentials independently from the production VPS.
