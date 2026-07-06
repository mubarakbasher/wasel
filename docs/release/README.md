# Release Pack — v1.0 promotion cycle (dev → main)

Generated 2026-07-07 from a full multi-agent scan of the repository (backend, mobile, admin, infra, docs, security, product) plus external market research. Grounding: `dev` @ `518e024` vs `main` @ `92878e2` (2026-04-26).

| Document | What it answers |
|---|---|
| [RELEASE_READINESS.md](RELEASE_READINESS.md) | **How ready is this version?** Scorecard per area, the consolidated blocker checklist, and the exact critical path to promote `dev` → `main` → prod. |
| [MARKETING_PLAN.md](MARKETING_PLAN.md) | **How do we sell it?** Positioning, competitors, pricing strategy, channels (Sudan-focused), launch phases, KPIs, and claims to avoid. |
| [ROADMAP.md](ROADMAP.md) | **What do we build next?** Future development in five horizons, from release hardening to strategic bets, with sources and effort sizes. |

**TL;DR verdict: ~76/100 — code-ready, gate-blocked.** The code on `dev` is production-quality, fully tested at the unit level, and *safer* than what is live today (it carries the Critical RCE fix prod has been missing since April). Nothing can ship until the staging VPS provider opens inbound 80/443 and the STAGING.md §11 E2E gate actually runs. Details and the full checklist in `RELEASE_READINESS.md`.

> Keep these documents updated at each promotion cycle. The readiness checklist is written as checkboxes — tick them as they complete and record the gate run date.
