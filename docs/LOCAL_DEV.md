# Local Development on Windows (WSL2 + Native Hot-Reload)

Production runs on the VPS (`main` branch, `git pull` + `docker compose up -d --build`). This doc walks through running the same stack on a Windows 11 dev machine without touching the live VPS.

The model: **infra in Docker, app code on the host.** Postgres, Redis, FreeRADIUS, MailHog (and optionally WireGuard) run in `docker compose -f docker-compose.dev.yml`. The backend and admin run as `npm run dev` directly in WSL2 with hot reload. Real router pairing is opt-in via a profile flag.

---

## 1. One-time WSL2 setup

From PowerShell **as Administrator**:

```powershell
wsl --install -d Ubuntu-24.04
wsl --set-default-version 2
```

Reboot, finish the Ubuntu first-run, then in the Ubuntu shell:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-plugin git build-essential \
                    wireguard-tools freeradius-utils \
                    postgresql-client redis-tools \
                    curl unzip
sudo usermod -aG docker $USER     # log out and back in
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 20 && fnm default 20
sudo snap install flutter --classic
```

Verify:

```bash
docker run --rm hello-world
wg --version
radclient -v
node --version
flutter --version
```

If you use Docker Desktop instead of native `docker.io`: enable Settings → Resources → WSL Integration → Ubuntu-24.04.

---

## 2. Clone into the WSL2 home directory

```bash
cd ~
git clone <repo-url> wasel
cd ~/wasel
git checkout dev          # daily work happens on dev, not main
code .                    # opens VS Code via Remote-WSL
```

**Do not work from `/mnt/c/...`** — the 9P bridge slows `node_modules`, `flutter pub get`, and Docker bind mounts by 10–50×.

---

## 3. Configure local env files

Two files, both gitignored. Copy from the `.example` siblings:

```bash
cp .env.example .env                              # docker compose looks for .env at root
cp backend/.env.local.example backend/.env.local  # backend dotenv chain loads .env.local first
```

For the root `.env`, replace the `REPLACE_WITH_openssl_rand_hex_32` placeholders with any value you like — these only protect your local Postgres/Redis containers (e.g. `POSTGRES_PASSWORD=devpass`).

Then generate fresh secrets and replace the `__GENERATE_WITH_*__` placeholders in `backend/.env.local`:

```bash
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"

WG_PRIV=$(wg genkey)
WG_PUB=$(echo "$WG_PRIV" | wg pubkey)
echo "WG_SERVER_PRIVATE_KEY=$WG_PRIV"
echo "WG_SERVER_PUBLIC_KEY=$WG_PUB"
```

These dev secrets must **never** match production — separate sessions and separate encrypted blobs.

The admin SPA does not need its own env file for daily dev — Vite's existing dev-server proxy at `admin/vite.config.ts:13-17` forwards `/api/*` to `http://localhost:3000` automatically.

---

## 4. The daily loop

Four shells (or four VS Code terminal tabs):

```bash
# 1. Infra (long-lived; leave running)
docker compose -f docker-compose.dev.yml up -d

# 2. Backend (hot reload via nodemon + ts-node, ~1s)
cd backend && npm install && npm run dev

# 3. Admin (Vite HMR, sub-second)
cd admin && npm install && npm run dev

# 4. Mobile (Android emulator example)
cd mobile && flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

Mobile run targets:

| Target | Command |
|--------|---------|
| Android emulator | `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1` |
| iOS simulator | `flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1` |
| Physical phone (same Wi-Fi as laptop) | `flutter run --dart-define=API_BASE_URL=http://<WSL2-LAN-IP>:3000/api/v1` |

Get the LAN IP with `ip -4 addr show eth0` in WSL2. On Windows 11 23H2+ with `networkingMode=mirrored` in `~/.wslconfig`, this resolves to the Windows host LAN IP automatically.

---

## 5. Smoke tests

Run from `~/wasel` after the daily loop is up:

| Check | Command | Expected |
|-------|---------|----------|
| Stack health | `docker compose -f docker-compose.dev.yml ps` | postgres / redis / freeradius / mailhog all healthy |
| Migrations | `docker compose -f docker-compose.dev.yml exec postgres psql -U wasel -d wasel -c "\\dt"` | full table set incl. `radcheck`, `radacct`, `nas`, `voucher_meta` |
| Backend liveness | `curl http://localhost:3000/api/v1/health` | `{"status":"ok"}` |
| Admin SPA | open `http://localhost:5173` | login screen, dashboard renders |
| RADIUS auth | create a test voucher in admin → `radclient -x 127.0.0.1:1812 auth testing123 <<<'User-Name = "vXXX"\nUser-Password = "PPPP"'` | `Access-Accept` |
| Hot reload — backend | save any line in `backend/src/...` | nodemon restarts in <2s |
| Hot reload — admin | save any line in `admin/src/...` | Vite HMR update without full reload |
| Mail capture | trigger any mail-sending flow → open `http://localhost:8025` | message appears |
| Mobile login | run flutter app, log in with the seeded user | dashboard loads |
| Tests | `cd backend && npm test` | full suite passes |

Initial backend boot logs include a `Failed to sync WireGuard peers` warning — this is **expected** because the WireGuard container is profile-gated and not running. Backend continues without it; routers will simply show offline in the UI.

---

## 6. Real router pairing (when you actually need it)

Bring up the WG container only when iterating on router-provisioning code:

```bash
docker compose -f docker-compose.dev.yml --profile router-test up -d wireguard
```

The container claims `wg0` on the WSL2 host kernel; backend's `wg` CLI calls now succeed.

To pair a real Mikrotik on the same LAN as the laptop:

1. Get the WSL2 LAN-reachable IP. With `networkingMode=mirrored` it is the Windows host's LAN IP. Otherwise, from PowerShell **as Administrator**:
   ```powershell
   netsh interface portproxy add v4tov4 listenport=51820 listenaddress=0.0.0.0 connectport=51820 connectaddress=<WSL2-IP>
   netsh advfirewall firewall add rule name="Wasel WG" dir=in action=allow protocol=UDP localport=51820
   ```
2. Update `WG_SERVER_ENDPOINT` in `backend/.env.local` to the laptop's LAN IP.
3. In the mobile app, add a router; the generated setup script bakes that endpoint in.
4. Paste the script into the Mikrotik. Tunnel comes up. Voucher login through the captive portal hits local FreeRADIUS.

When done:

```bash
docker compose -f docker-compose.dev.yml stop wireguard
```

---

## 7. Git workflow

| Branch | Purpose |
|--------|---------|
| `dev` | All local development. Daily commits land here. |
| `main` | Deploy ref. Only fast-forward merges from `dev`, only when ready to ship. |

```bash
# initial setup (one-time)
git checkout main && git pull
git checkout -b dev
git push -u origin dev
git config --local push.default current   # `git push` only pushes the current branch

# daily
git checkout dev
# ...work...
git commit -am "feat: ..."
git push

# shipping to prod
git checkout main && git pull
git merge --ff-only dev
git push origin main
# then on the VPS: git pull && docker compose up -d --build
```

The VPS deploy procedure does not change.

---

## 8. Common breakage

| Symptom | Cause | Fix |
|---------|-------|-----|
| `EADDRINUSE :3000` on backend start | another instance running | `lsof -i :3000` and kill it |
| Backend log: `wg: command not found` | `wireguard-tools` missing | `sudo apt install wireguard-tools` |
| Backend log: `Failed to sync WireGuard peers` | WG container not running (expected for daily UI/API work) | ignore, or bring up WG via profile if you need it |
| Admin shows CORS error in browser console | `CORS_ORIGIN` doesn't include the Vite origin | add `http://localhost:5173` to `CORS_ORIGIN` in `backend/.env.local`, restart backend |
| Mobile app fails with SSL handshake error against `http://...` | trying a release build (cert pinning is on) | rebuild in debug; pinning is gated by `kReleaseMode` in `api_client.dart:86` |
| `ZodError` at backend boot complaining about ENCRYPTION_KEY | placeholder still in `.env.local` | regenerate with `openssl rand -hex 32` and replace |
| Postgres healthcheck flapping after `docker compose down -v` | volume just recreated; init scripts running | wait ~10s for `init-db/` to finish |
| FreeRADIUS won't start with `Address already in use` | another `freeradius` running on the WSL2 host | `sudo systemctl stop freeradius` (Ubuntu may have started it on install) |
