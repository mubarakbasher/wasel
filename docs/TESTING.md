# Wasel — Local Testing Guide

How to bring up the full Wasel stack (backend + admin panel + mobile app) on a Windows 11 + WSL2 Ubuntu dev machine for end-to-end testing.

For the full setup-from-scratch walkthrough (installing WSL2, Docker, Node, Flutter), see [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md). This document assumes those tools are already installed and focuses on the daily run-everything loop.

---

## 0. Prerequisites (one-time)

- WSL2 Ubuntu 24.04 with Docker, Node 20, Flutter installed.
- Repo cloned into `~/wasel` inside Ubuntu (not `/mnt/c/...` — much slower).
- `.env` at repo root with `POSTGRES_PASSWORD` and `REDIS_PASSWORD`.
- `backend/.env.local` filled in (copy from `backend/.env.local.example`, generate fresh secrets with `openssl rand -hex 32`).
- Branch: `dev`.

```bash
cd ~/wasel
git checkout dev
git pull
```

---

## 1. Start the testing server (infrastructure)

This brings up PostgreSQL, Redis, FreeRADIUS, and MailHog in Docker. They are the four services the backend talks to.

```bash
cd ~/wasel
docker compose -f docker-compose.dev.yml up -d
```

Verify everything is healthy:

```bash
docker compose -f docker-compose.dev.yml ps
```

All four services should show `(healthy)`. If not, give it 10–20 seconds and re-check — Postgres and FreeRADIUS have a startup probe.

| Service | Host port | Purpose |
|---|---|---|
| Postgres | `127.0.0.1:5436` | App + RADIUS data |
| Redis | `127.0.0.1:6380` | Rate-limit + cache |
| FreeRADIUS | `127.0.0.1:1812-1813/udp` | AAA |
| MailHog SMTP | `127.0.0.1:1025` | Backend sends mail here |
| MailHog UI | http://localhost:8025 | Read mail in browser |

**Stop everything later:** `docker compose -f docker-compose.dev.yml down` (keeps data). Add `-v` to also wipe the Postgres + Redis volumes.

---

## 2. Run the backend

In a new terminal:

```bash
cd ~/wasel/backend
npm install        # first time only
npm run dev        # nodemon + ts-node, hot-reload on :3000
```

Migrations run automatically on boot. Watch the output for `listening on 3000` and `db: ok / redis: ok`.

**Smoke test:**

```bash
curl http://127.0.0.1:3000/api/v1/health
```

Expect: `{"success":true,"data":{"status":"ok","checks":{"db":"ok","redis":"ok"},...}}`

**Useful scripts:**
- `npm test` — run the Vitest suite once
- `npm run test:watch` — watch mode
- `npm run lint` — `tsc --noEmit` type check
- `npm run migrate` — re-run migrations manually

---

## 3. Run the admin panel

In a new terminal:

```bash
cd ~/wasel/admin
npm install        # first time only
npm run dev        # Vite HMR on :5173
```

Open http://localhost:5173 in your browser. The admin panel calls the backend at the URL configured in `admin/.env` (defaults to `http://localhost:3000/api/v1` for dev). Log in with an admin user — if you need to seed one, use the registration flow or call the API directly.

**Useful scripts:**
- `npm run build` — production bundle (writes `admin/dist/`)
- `npm run preview` — serve the prod bundle locally for a final check
- `npm run lint` — ESLint

---

## 4. Run the mobile app

The mobile app can run on either the **Android emulator** or a **real Android phone**. Pick one.

### Option A — Android emulator (easiest)

The emulator reaches the host machine via the magic IP `10.0.2.2`.

```bash
cd ~/wasel/mobile
flutter pub get                                                       # first time only
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

### Option B — Real Android phone (USB)

USB-to-Android works most reliably with Flutter on **Windows**, not inside WSL2. So for a real phone:

1. Plug the phone in via USB, enable USB debugging in Developer Options, accept the RSA fingerprint prompt.
2. From **PowerShell** (not WSL2):

   ```powershell
   adb devices                            # confirm your phone is listed
   cd C:\Users\mubar\Desktop\Wasel\mobile
   flutter run --dart-define=API_BASE_URL=http://192.168.1.227:3000/api/v1
   ```

3. Replace `192.168.1.227` with your PC's current Wi-Fi LAN IP if it has changed (`ipconfig | Select-String IPv4`). The phone and PC must be on the same Wi-Fi network — guest/corporate Wi-Fi with client isolation will block this.

The Windows-side portproxy already forwards `0.0.0.0:3000` on the host to the backend running in WSL2, so the phone reaches the backend transparently. If you ever reboot or run `wsl --shutdown`, re-run the portproxy command from `docs/LOCAL_DEV.md`.

**Smoke test from the phone's browser before running Flutter:**

```
http://192.168.1.227:3000/api/v1/health
```

If that loads JSON, the app will connect fine.

### Option C — Real Android phone over Wi-Fi (no USB)

Android 11+. From the phone: Developer Options → Wireless debugging → Pair device with pairing code. Then on Windows:

```powershell
adb pair <phone-ip>:<pair-port>     # one-time, enter the code
adb connect <phone-ip>:<connect-port>
flutter run --dart-define=API_BASE_URL=http://192.168.1.227:3000/api/v1
```

---

## 5. End-to-end smoke test

With all three running:

1. **Admin panel** (http://localhost:5173): log in, confirm dashboard loads.
2. **Mobile app**: register a new operator, log in, add a router (paste setup gets shown but no real router needed for UI testing).
3. **MailHog UI** (http://localhost:8025): confirm registration/verification mail arrived.
4. **Backend logs**: `docker compose -f docker-compose.dev.yml logs -f freeradius` for RADIUS traffic; the backend's nodemon stdout for HTTP traffic.

---

## 6. Resetting state between test runs

Wipe the database and Redis (destructive — all local accounts, vouchers, sessions gone):

```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
# restart `npm run dev` in backend — migrations re-run on boot
```

To wipe only specific tables, connect directly:

```bash
psql -h 127.0.0.1 -p 5436 -U wasel -d wasel    # password from .env
```

---

## 7. Common breakage

| Symptom | Likely cause | Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5436` on backend boot | Docker stack not up | `docker compose -f docker-compose.dev.yml ps`, restart if missing |
| `db: error` in `/health` | Migrations failed | Check backend logs; usually a stale volume — `down -v` and retry |
| Mobile app sees `Connection refused` | Wrong `API_BASE_URL` or firewall | Smoke-test the URL in the phone's browser first |
| Admin panel CORS error | `CORS_ORIGIN` missing your origin | Add it in `backend/.env.local`, restart backend |
| `wsl --shutdown` broke the phone connection | WSL2 IP rotated, portproxy stale | Re-run the `netsh interface portproxy` setup from `docs/LOCAL_DEV.md` |
| Flutter on phone connects fine, then disconnects | Phone went to sleep / Wi-Fi roamed | Wake phone, hot-restart Flutter (`R` in the run terminal) |
| Port already in use on `:3000` / `:5173` | Old `npm run dev` still alive | `lsof -i :3000` (Linux) or `Get-NetTCPConnection -LocalPort 3000` (Windows), kill it |

---

## 8. Branch + promote model

All testing happens on `dev`. When testing passes and you want to ship to the VPS:

```bash
git checkout main
git merge dev --ff-only
git push origin main
```

Then on the VPS:

```bash
git pull origin main
docker compose up -d --build
```

VPS uses the production `docker-compose.yml`, not `docker-compose.dev.yml`. Migrations run automatically on backend boot.
