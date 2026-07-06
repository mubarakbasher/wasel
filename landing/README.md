# Wasel Landing Page

Public marketing site for `wa-sel.com`. Static Vite + React 19 + Tailwind 4 SPA, bilingual Arabic-first (AR default with RTL, EN toggle), no backend dependency.

```bash
npm install
npm run dev      # http://localhost:5174
npm run lint
npm run build    # tsc -b && vite build → dist/
```

**⚠️ Before go-live:** replace the placeholder WhatsApp number and APK download URL in [`src/config.ts`](src/config.ts) — every CTA on the page imports from that one file.

Deploy: built into an nginx container by [`Dockerfile`](Dockerfile), exposed on loopback `127.0.0.1:8080` by the root `docker-compose.yml`, fronted by the host nginx vhost for `wa-sel.com` (see `docs/deploy.md` §3). Copy is bilingual and lives in `src/i18n/strings.ts`; brand tokens in `src/index.css` transcribe `docs/UIUX_DESIGN_BRIEF.md`.
