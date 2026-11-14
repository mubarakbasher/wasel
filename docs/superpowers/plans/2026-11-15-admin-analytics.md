# Admin Analytics Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin Analytics page (Money, Operators, Network and cards) plus the recording, summaries and jobs behind it, and fix payment approval so it activates the request that was paid for.

**Architecture:** Hooks record facts at the moment they happen (income ledger, card batches, router up/down, operator last-active). Scheduled jobs turn new `radacct` rows and those facts into small per-day summary tables. Every admin page load reads only the summaries and the small live tables; no existing table is altered.

**Tech Stack:** Node.js + Express + TypeScript, PostgreSQL 16 (`pg`), node-cron, Zod, Vitest + Supertest (mocked `pg` pool); React 19 + Vite + TanStack Query 5 + Tailwind v4, Vitest + Testing Library. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-admin-analytics-design.md` — read it first; this plan cites it as "spec §n". DDL, hook rules, job schedules and number definitions live there and are not repeated here.

## Global Constraints

- Branch `dev` only; verify on staging (`wa-sel.cloud`). Never touch `main` or prod.
- Migrations `044`–`046` create new empty tables and their indexes only: `IF NOT EXISTS`, no `REFERENCES`, no `ALTER TABLE`, no data reads. Applied migration files are immutable.
- No column or index changes on `radcheck`, `radreply`, `radacct`, `radpostauth`, `radusergroup`, `voucher_meta`, `users`, `routers`, `payments`, `subscriptions`.
- No SQL issued by an `/admin/analytics/*` endpoint may mention `radacct`, `voucher_meta` or `radpostauth`.
- Every statement that reads `radacct` or `voucher_meta` from a job or the backfill runs inside `withGuardedClient` (15 s timeout, `enable_seqscan=off`) and is bounded by a `LIMIT` or a one-hour window.
- The timezone is always the bound parameter `config.ANALYTICS_TZ` (default `Africa/Khartoum`), never interpolated. Days and months leave SQL as text (`to_char(..., 'YYYY-MM-DD')`, `'YYYY-MM'`).
- Recording hooks never fail the action they sit in: savepoint, catch, `logger.error`.
- Plan limits come from the `plans` / `subscriptions` rows; unlimited vouchers is `-1`.
- Response envelope `{ success: true, data, meta }`; validation errors are 400 `VALIDATION_ERROR`.
- SQL lives in services; controllers `try { … } catch (e) { next(e) }`.
- Commits: four, at the points marked **Commit point**. Run the project `verify` skill before each code commit.
- Test commands: backend `cd backend && npx vitest run <path>` and `npx tsc --noEmit`; admin `cd admin && npx vitest run <path>`, `npx tsc --noEmit`, `npm run build`.

## Review Focus

1. **Nothing recorded yet** (fresh deploy, rollup never ran): every endpoint returns zeros and empty arrays with `meta.stale = true`, every percentage whose denominator is 0 is `null`, and every tab renders its empty state with no `NaN`. → tests in Tasks 8, 12, 13, 14.
2. **Operator with no subscription, or a subscription whose tier has no `plans` row**: the row still renders (`planName` falls back to the tier, `daysLeft` null) and Due-to-renew is marked estimated. → Task 8.
3. **Summary rows that point at a deleted operator or router**: Operators and the routers table omit them, platform totals keep them, Money shows the operator as "(deleted)". → Tasks 8, 9.
4. **Bad custom range**: `from > to`, span over 400 days or a malformed date → 400; a future `to` is clamped to today; a previous period that starts before the usage start gives `changePct: null` and never flags "Going quiet". → Tasks 2, 8.
5. **Jobs disabled, overlapping or interrupted**: with `ANALYTICS_JOBS_ENABLED=false` the ingest and rollup issue no query while the router recorder and money sync still run; a second rollup run while one holds the lock exits; an ingest failure leaves the cursor unchanged. → Tasks 5, 6.

## API contract (shared by Task 8 and Tasks 10–14)

Backend declares these in `backend/src/services/analytics.types.ts`; admin declares the same shapes in `admin/src/lib/analytics.ts`.

```ts
export type PeriodPreset = 'month' | '30d' | '3m' | '12m';
export type AnalyticsTab = 'money' | 'operators' | 'network';

export interface AnalyticsMeta {
  timezone: string;                          // config.ANALYTICS_TZ
  period: PeriodPreset | 'custom';
  range: { from: string; to: string };       // inclusive days, 'YYYY-MM-DD'
  previous: { from: string; to: string };
  refreshedAt: string | null;                // ISO; analytics_state 'rollup_last_ok'; money: request time
  stale: boolean;                            // refreshedAt null or older than 270 minutes; money: false
  usageHistoryStart: string;                 // config.ANALYTICS_USAGE_START_DATE
  routerHistoryStart: string | null;         // day of MIN(router_uptime_state.tracked_since)
  cardHistoryComplete: boolean;              // analytics_state 'backfill_cards_done' = 'true'
}

export interface MoneyAnalytics {
  cards: {
    incomeThisMonth: number; incomeSameDaysLastMonth: number; changePct: number | null;
    payingOperators: number; grantedOperators: number;
    dueToRenew: { amount: number; operators: number; estimated: boolean };
    waiting: { count: number; amount: number; oldestSince: string | null };
  };
  income: { total: number; fromDeletedOperators: number };
  incomeByMonth: { month: string; new: number; renewal: number; planChange: number }[];   // 'YYYY-MM'
  incomeByPlan: { planTier: string; planName: string; amount: number; sharePct: number | null }[];
  renewalRate: { month: string; ended: number; renewed: number; ratePct: number | null; provisional: boolean }[];
  renewalsDue: RenewalDueRow[];              // endsAt ascending
  lost: LostOperatorRow[];                   // endedAt descending
  paidNotActivated: { userId: string; operator: string; planName: string; amount: number; approvedAt: string }[];
}
export interface RenewalDueRow { userId: string; operator: string; email: string | null; planTier: string;
  planName: string; endsAt: string; amount: number | null; estimated: boolean; granted: boolean; paidBefore: number }
export interface LostOperatorRow { userId: string; operator: string; email: string | null; deleted: boolean;
  planTier: string; planName: string; endedAt: string; monthsPaid: number; totalPaid: number }

export interface OperatorsAnalytics {
  cards: { active: number; total: number; quiet: number; nearLimit: number; notStarted: number };
  rows: OperatorRow[];
}
export interface OperatorRow { userId: string; operator: string; email: string;
  planTier: string | null; planName: string | null; daysLeft: number | null;
  routersOnline: number; routersTotal: number; cardsCreated: number; cardsUsed: number; salesValue: number;
  changePct: number | null; lastActiveAt: string | null;
  flags: { isQuiet: boolean; nearLimit: boolean; notStarted: boolean } }

export interface OperatorAnalytics {
  daily: { day: string; cardsCreated: number; cardsUsed: number; salesValue: number }[];
  routers: { routerId: string; uptimePct: number | null; drops: number; longestOutageSec: number }[];
  payments: { id: string; planTier: string; amount: number; status: string; createdAt: string; reviewedAt: string | null }[];
  totalPaid: number;
}

export interface NetworkAnalytics {
  cards: { routersOnline: number; routersTotal: number; neverConnected: number; notSeenSinceLaunch: number;
    uptimePct: number | null; dropping: number; cardsUsed: number; cardsCreated: number;
    salesValue: number; unpricedUsed: number };
  monitorStale: boolean;                     // analytics_state 'monitor_heartbeat' older than 3 minutes
  daily: { day: string; cardsCreated: number; cardsUsed: number; dataBytes: number }[];
  hours: { dow: number; hour: number; sessions: number }[];   // dow 0 = Sunday … 6 = Saturday, hour 0–23
  cardTypes: { byPrice: { price: number | null; cardsUsed: number }[];
               byKind: { limitType: string | null; cardsUsed: number }[] };
  routers: RouterRow[];                      // uptimePct ascending (nulls last), then drops descending
}
export interface RouterRow { routerId: string; router: string; userId: string; operator: string;
  uptimePct: number | null; drops: number; longestOutageSec: number; sessions: number; dataBytes: number;
  status: 'online' | 'offline' | 'degraded' | 'unknown'; flags: { dropping: boolean; offlineNow: boolean } }
```

Query for the four GET endpoints: `period?: PeriodPreset`, or `from` + `to` (`YYYY-MM-DD`). Exports add `q?`, `filter?`, `sort?`, `dir?: 'asc' | 'desc'`.

| Method and path (under `/api/v1/admin`) | `data` |
|---|---|
| `GET /analytics/money` | `MoneyAnalytics` |
| `GET /analytics/operators` | `OperatorsAnalytics` |
| `GET /analytics/operators/:id` | `OperatorAnalytics` |
| `GET /analytics/network` | `NetworkAnalytics` |
| `GET /analytics/money/renewals-due/export` | CSV, audit action `analytics.renewals_due.export_csv` |
| `GET /analytics/money/lost/export` | CSV, `analytics.lost_operators.export_csv` |
| `GET /analytics/operators/export` | CSV, `analytics.operators.export_csv`; `filter`: `quiet` \| `near-limit` \| `not-started` |
| `GET /analytics/network/routers/export` | CSV, `analytics.routers.export_csv`; `filter`: `dropping` \| `offline` |

Sort keys — operators: `operator, plan, daysLeft, routersOnline, cardsCreated, cardsUsed, salesValue, changePct, lastActiveAt`; routers: `router, operator, uptimePct, drops, longestOutageSec, sessions, dataBytes, status`.

---

### Task 1: Migrations 044–046

**Files:**
- Create: `backend/src/migrations/sql/044_analytics_money.sql`, `045_analytics_recording.sql`, `046_analytics_summaries.sql`
- Test: `backend/src/tests/analyticsMigrations.test.ts`

**Interfaces:**
- Produces: the tables, columns and indexes exactly as spec §5.2, each `CREATE TABLE` / `CREATE INDEX` written with `IF NOT EXISTS`.

- [ ] **Step 1: Write the failing test** — read the three files as text and assert, per file: every `CREATE TABLE` and `CREATE [UNIQUE] INDEX` is followed by `IF NOT EXISTS`; the text contains no `REFERENCES`, no `ALTER TABLE`, no `DROP`; no statement names `radacct`, `voucher_meta`, `radpostauth`, `users`, `routers`, `payments` or `subscriptions`. For 045: the seed insert lists exactly `'radacct_cursor'` and `'monitor_heartbeat'` and ends `ON CONFLICT DO NOTHING`. For 046: `analytics_usage_hourly` and `analytics_usage_daily` allow a NULL `router_id` and use `UNIQUE NULLS NOT DISTINCT`.
- [ ] **Step 2: Run it** — `npx vitest run src/tests/analyticsMigrations.test.ts` → FAIL (files missing).
- [ ] **Step 3: Write the three SQL files** from spec §5.2, in the style of `003_application_tables.sql`.
- [ ] **Step 4: Run the test** → PASS.
- [ ] **Step 5: Apply on the local dev database** — start `docker compose -f docker-compose.dev.yml up -d postgres`, run the backend's migration runner (the script `backend/package.json` uses for migrations, else boot `npm run dev` once), then `\dt` in the dev Postgres container. Expected: the 14 new tables exist and `schema_migrations` lists 044, 045, 046. Run the runner a second time → no error.

### Task 2: Config, guarded client, period maths

**Files:**
- Modify: `backend/src/config/index.ts:155-159` (append to `envSchema`)
- Create: `backend/src/services/analyticsDb.ts`, `backend/src/services/analyticsPeriod.ts`, `backend/src/services/analytics.types.ts` (the contract above)
- Test: `backend/src/services/__tests__/analyticsDb.test.ts`, `backend/src/services/__tests__/analyticsPeriod.test.ts`

**Interfaces:**
- Produces (config): `ANALYTICS_JOBS_ENABLED: z.enum(['true','false']).default('true')`, `ANALYTICS_TZ: z.string().default('Africa/Khartoum')`, `ANALYTICS_USAGE_START_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2026-10-20')`, `ANALYTICS_QUIET_MIN_BASE: z.coerce.number().int().min(1).default(20)`.
- Produces (`analyticsDb.ts`):
  - `withGuardedClient<T>(fn: (client: PoolClient) => Promise<T>, opts?: { statementTimeoutMs?: number; allowHashJoin?: boolean }): Promise<T>` — takes its own client; runs `BEGIN`, `SET LOCAL statement_timeout`, `SET LOCAL enable_seqscan = off`, and unless `allowHashJoin`, `SET LOCAL enable_hashjoin = off` and `SET LOCAL enable_mergejoin = off`; then `fn`; then `COMMIT` and `release()`. On error: `ROLLBACK` (errors ignored), `release(true)`, rethrow.
  - `getAnalyticsState(key: string, db?: Queryable): Promise<string | null>`, `setAnalyticsState(key: string, value: string, db?: Queryable): Promise<void>` (upsert, sets `updated_at = NOW()`), where `Queryable = Pick<PoolClient, 'query'>` defaulting to `pool`.
  - `analyticsJobsEnabled(): boolean` — `config.ANALYTICS_JOBS_ENABLED === 'true'`.
  - `seedRadacctCursor(): Promise<void>` — the `UPDATE` in spec §5.3 (row "Session cursor").
- Produces (`analyticsPeriod.ts`, pure, no DB):
  - `khartoumToday(now: Date, tz: string): string`
  - `resolvePeriod(q: { period?: PeriodPreset; from?: string; to?: string }, tab: AnalyticsTab, now: Date, tz: string): ResolvedPeriod` with `ResolvedPeriod = { period: PeriodPreset | 'custom'; from: string; to: string; previousFrom: string; previousTo: string; days: number }`; throws `AppError(400, …, 'VALIDATION_ERROR')` for `from > to` or a span over 400 days.
  - `dayBoundsUtc(day: string, tz: string): { start: Date; end: Date }`, `hourBoundsUtc(day: string, hour: number, tz: string): { start: Date; end: Date }`, `addDays(day: string, n: number): string`.
  - Rules: money accepts `month | 3m | 12m`, others accept `30d | 3m | 12m`; an unsupported or missing preset becomes the tab's first one. `month` = first of this month → today, previous = first of last month → the same day-of-month last month (clamped to that month's length). `30d` = today − 29 → today. `3m` / `12m` = first day of the month 2 / 11 months back → today. For everything except `month`, previous = the equal-length span ending the day before `from`. A custom `to` after today is clamped to today.

- [ ] **Step 1: Write the failing tests**

`analyticsDb.test.ts` (mock `pool.connect` to return a client with `query` and `release` spies):
```ts
it('runs BEGIN, the SET LOCALs, the callback, then COMMIT', …)
// client.query call order: 'BEGIN', "SET LOCAL statement_timeout = '15s'", 'SET LOCAL enable_seqscan = off',
// 'SET LOCAL enable_hashjoin = off', 'SET LOCAL enable_mergejoin = off', 'SELECT 1' (from fn), 'COMMIT'; release() called with no argument
it('allowHashJoin leaves hash and merge joins on', …)        // no enable_hashjoin / enable_mergejoin statements
it('destroys the client when the callback throws', …)        // 'ROLLBACK' issued, release called with true, promise rejects
it('seedRadacctCursor only fills a NULL cursor', …)          // SQL contains "key = 'radacct_cursor' AND value IS NULL" and 'MAX(radacctid)'
it('analyticsJobsEnabled is false for the string "false"', …)
```
`analyticsPeriod.test.ts` with `tz = 'Africa/Khartoum'`, `now = new Date('2026-11-15T10:00:00Z')` unless stated:
```ts
expect(khartoumToday(new Date('2026-11-14T22:30:00Z'), tz)).toBe('2026-11-15');
expect(resolvePeriod({}, 'money', now, tz)).toMatchObject({ period: 'month', from: '2026-11-01', to: '2026-11-15', previousFrom: '2026-10-01', previousTo: '2026-10-15' });
expect(resolvePeriod({ period: '30d' }, 'operators', now, tz)).toMatchObject({ from: '2026-10-17', to: '2026-11-15', previousFrom: '2026-09-17', previousTo: '2026-10-16', days: 30 });
expect(resolvePeriod({ period: '3m' }, 'money', now, tz)).toMatchObject({ from: '2026-09-01', previousFrom: '2026-06-17', previousTo: '2026-08-31', days: 76 });
expect(resolvePeriod({ period: '12m' }, 'network', now, tz).from).toBe('2025-12-01');
expect(resolvePeriod({ period: '30d' }, 'money', now, tz).period).toBe('month');
expect(resolvePeriod({ period: 'month' }, 'operators', now, tz).period).toBe('30d');
expect(resolvePeriod({ from: '2026-11-01', to: '2026-12-31' }, 'money', now, tz)).toMatchObject({ period: 'custom', to: '2026-11-15' });
expect(resolvePeriod({}, 'money', new Date('2026-03-31T10:00:00Z'), tz).previousTo).toBe('2026-02-28');
expect(() => resolvePeriod({ from: '2026-11-10', to: '2026-11-01' }, 'money', now, tz)).toThrow();
expect(() => resolvePeriod({ from: '2025-01-01', to: '2026-11-01' }, 'money', now, tz)).toThrow();
expect(dayBoundsUtc('2026-11-15', tz)).toEqual({ start: new Date('2026-11-14T22:00:00Z'), end: new Date('2026-11-15T22:00:00Z') });
expect(hourBoundsUtc('2026-11-15', 23, tz).end).toEqual(new Date('2026-11-15T22:00:00Z'));
```
- [ ] **Step 2: Run both** → FAIL (modules missing).
- [ ] **Step 3: Implement** the config lines, `analyticsDb.ts`, `analyticsPeriod.ts` (use `Intl.DateTimeFormat` with the `timeZone` option; no date library) and `analytics.types.ts`.
- [ ] **Step 4: Run both tests and `npx tsc --noEmit`** → PASS.

### Task 3: Income ledger, payment-approval fix, dashboard money

**Files:**
- Create: `backend/src/services/analyticsRecording.service.ts`
- Modify: `backend/src/services/admin.service.ts` — `reviewPayment` (`:730-819`), `getStats` (`:877-918`), `getStatsTimeseries` (`:1338-1393`)
- Test: create `backend/src/services/__tests__/analyticsRecording.test.ts`; extend `backend/src/tests/adminPayments.test.ts` (beside `:203-209`) and `backend/src/tests/statsTimeseries.test.ts`

**Interfaces:**
- Produces: `recordIncome(client: PoolClient, paymentId: string, activatedSubscriptionId: string | null): Promise<void>` (never throws) and `reconcileIncomeLedger(): Promise<number>` (rows inserted; runs on `pool`). Both run the one statement below.

```sql
-- $1 payment id or NULL (all), $2 activated subscription id or NULL, $3 source ('live' | 'reconcile')
INSERT INTO income_ledger (payment_id, user_id, operator_name, operator_email, subscription_id,
  replaces_subscription_id, plan_tier, plan_name, duration_months, amount, kind, approved_at, period_end, source)
SELECT p.id, p.user_id, u.name, u.email, s.id, s.previous_subscription_id, p.plan_tier,
       COALESCE(pl.name, p.plan_tier), s.duration_months, p.amount,
       CASE WHEN NOT EXISTS (SELECT 1 FROM payments e WHERE e.user_id = p.user_id AND e.status = 'approved'
              AND e.id <> p.id
              AND (COALESCE(e.reviewed_at, e.created_at), e.created_at) < (COALESCE(p.reviewed_at, p.created_at), p.created_at))
            THEN 'new'
            WHEN s.previous_subscription_id IS NOT NULL THEN 'plan_change' ELSE 'renewal' END,
       COALESCE(p.reviewed_at, p.created_at), s.end_date, $3
  FROM payments p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN plans pl ON pl.tier = p.plan_tier
  LEFT JOIN LATERAL (
    SELECT x.id, x.previous_subscription_id, x.duration_months, x.end_date FROM subscriptions x
     WHERE x.user_id = p.user_id
       AND (x.id = $2 OR x.start_date = p.reviewed_at OR x.created_at = p.created_at)
     ORDER BY (x.id = $2) DESC NULLS LAST, (x.start_date = p.reviewed_at) DESC NULLS LAST, x.created_at DESC
     LIMIT 1) s ON TRUE
 WHERE p.status = 'approved' AND ($1::uuid IS NULL OR p.id = $1)
ON CONFLICT (payment_id) DO NOTHING;
```

- `reviewPayment` on approval, replacing the selection at `:765-817` (spec §5.8 "Payment-approval bug fix"):
  1. Pair in SQL: `SELECT s.id, s.status, s.previous_subscription_id FROM subscriptions s JOIN payments p ON p.user_id = s.user_id AND p.created_at = s.created_at WHERE p.id = $1 AND s.status IN ('pending','pending_change') FOR UPDATE OF s`.
  2. Paired row found → activate that id with the existing `start_date = NOW(), end_date = NOW() + (duration_months * INTERVAL '30 days')` update. If it was `pending_change`: `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE (id = $1 OR (user_id = $2 AND status = 'active')) AND id <> $3` with `[previous_subscription_id, user_id, activatedId]`.
  3. No paired row → the existing two selections, unchanged.
  4. Before `COMMIT`: `SAVEPOINT analytics_income` → `recordIncome(client, paymentId, activatedId ?? null)` → `RELEASE SAVEPOINT analytics_income`; on error `ROLLBACK TO SAVEPOINT analytics_income`.
- `getStats`: the subscriptions query groups by `CASE WHEN status = 'active' AND end_date <= NOW() THEN 'expired' ELSE status END`; total revenue becomes `SELECT COALESCE(SUM(amount), 0) AS total FROM income_ledger`.
- `getStatsTimeseries`: parameters `[days, config.ANALYTICS_TZ]`; the date spine is `(NOW() AT TIME ZONE $2)::date - ($1::int - 1)` … `(NOW() AT TIME ZONE $2)::date`; revenue reads `income_ledger` bucketed by `(approved_at AT TIME ZONE $2)::date` with `approved_at >= NOW() - (($1::int + 1) * INTERVAL '1 day')`; the users and vouchers buckets also use `(created_at AT TIME ZONE $2)::date`.

- [ ] **Step 1: Write the failing tests**
```ts
// adminPayments.test.ts
it('approval activates the request created with the payment, not an older rejected plan change', …)
//   queue: payment UPDATE row; pairing SELECT → [{ id: 'sub-C', status: 'pending', previous_subscription_id: null }]
//   expect an UPDATE subscriptions … WHERE id = $1 with ['sub-C']; expect NO query containing "status = 'pending_change'" with ORDER BY created_at DESC
it('the pairing query joins payment and subscription on created_at inside SQL', …)
//   SQL contains 'p.created_at = s.created_at' and its params are exactly [paymentId]
it('a plan change cancels the previous and every other active subscription', …)
//   pairing → pending_change with previous 'sub-A'; expect the cancel UPDATE with ['sub-A', userId, 'sub-B']
it('falls back to the legacy selection when no request is paired', …)
it('writes the ledger row between activation and COMMIT', …)
//   call order ends: 'SAVEPOINT analytics_income', INSERT INTO income_ledger, 'RELEASE SAVEPOINT analytics_income', 'COMMIT'
it('a ledger failure still commits the approval', …)   // INSERT rejects → 'ROLLBACK TO SAVEPOINT analytics_income', then 'COMMIT', HTTP 200
it('a rejection writes no ledger row', …)
// analyticsRecording.test.ts
it('recordIncome passes [paymentId, activatedId, "live"]', …)
it('reconcileIncomeLedger passes [null, null, "reconcile"] and returns rowCount', …)
it('recordIncome swallows a database error and logs it', …)
// statsTimeseries.test.ts
it('reads revenue from income_ledger in the configured timezone', …)   // SQL contains 'income_ledger' and 'AT TIME ZONE $2'; params [30, 'Africa/Khartoum']
it('getStats counts a past-due active subscription as expired and sums the ledger', …)   // SQL contains "end_date <= NOW() THEN 'expired'" and 'FROM income_ledger'
```
- [ ] **Step 2: Run the three files** → the new tests FAIL.
- [ ] **Step 3: Implement** `analyticsRecording.service.ts` and the three `admin.service.ts` changes. Update existing queued-result sequences in `adminPayments.test.ts` for the new pairing query.
- [ ] **Step 4: Run** `npx vitest run src/tests/adminPayments.test.ts src/tests/statsTimeseries.test.ts src/services/__tests__/analyticsRecording.test.ts` and `npx tsc --noEmit` → PASS.

### Task 4: Card batches, operator last-active, cursor seed

**Files:**
- Create: `backend/src/services/analyticsCards.service.ts`, `backend/src/services/operatorActivity.service.ts`
- Modify: `backend/src/services/voucher.service.ts` (just before `COMMIT` at `:743`), `backend/src/services/auth.service.ts` (`:138`, `:169`), `backend/src/server.ts` (after `runMigrations()` at `:97`), `backend/src/tests/setup.ts`
- Test: create `backend/src/services/__tests__/operatorActivity.test.ts`; extend `backend/src/tests/voucher.test.ts` (`:191-196`, `:233-239`) and the auth login/refresh tests

**Interfaces:**
- Consumes: `seedRadacctCursor()` from Task 2.
- Produces: `recordCardBatch(client: PoolClient, b: { userId: string; routerId: string; cardCount: number; price: number | null; limitType: string | null }): Promise<void>` — `SAVEPOINT analytics_cards`, `INSERT INTO analytics_card_batches (user_id, router_id, created_at, card_count, price, limit_type) VALUES ($1,$2,NOW(),$3,$4,$5)`, release; on error roll back to the savepoint and log; never throws.
- Produces: `touchOperatorActivity(userId: string): Promise<void>` — `INSERT INTO operator_activity (user_id, last_active_at) VALUES ($1, NOW()) ON CONFLICT (user_id) DO UPDATE SET last_active_at = NOW() WHERE operator_activity.last_active_at < NOW() - INTERVAL '5 minutes'`; catches and logs its own errors.
- Call sites: `if (user.role === 'user') void touchOperatorActivity(user.id).catch(() => undefined);` after `issueTokenPair` in `login` and `refresh` (`refresh` must hold the tokens in a variable first). `server.ts`: `await seedRadacctCursor()` inside its own try/catch that only logs a warning.
- `setup.ts`: `vi.mock` `operatorActivity.service` globally so its query never consumes queued pool results; its own test uses `vi.importActual`.

- [ ] **Step 1: Write the failing tests**
```ts
it('records one card batch between the voucher_meta insert and COMMIT', …)
//   params [userId, routerId, 50, 500, 'time'] for a batch of 50 cards priced 500 with limitType 'time'
it('a card-batch failure still commits the vouchers', …)
it('touchOperatorActivity throttles to 5 minutes in SQL', …)          // SQL contains "INTERVAL '5 minutes'"
it('touchOperatorActivity resolves when the database rejects', …)     // logger.error called once
it('login touches activity for an operator and not for an admin', …)
it('refresh touches activity for an operator', …)
it('a rejected touch raises no unhandledRejection', …)                // process.on('unhandledRejection') spy not called after a tick
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the touched test files and `npx tsc --noEmit` → PASS.

### Task 5: Router up/down recorder

**Files:**
- Create: `backend/src/services/routerUptimeRecorder.ts`
- Modify: `backend/src/services/wireguardMonitor.ts` — `peersOk` flag at `:136-144`, add `last_seen` to the `SELECT` at `:156`, call the recorder after the status transaction (`:356`)
- Test: create `backend/src/services/__tests__/routerUptimeRecorder.test.ts`; `vi.mock` the recorder in `backend/src/services/__tests__/wireguardMonitor.test.ts`

**Interfaces:**
- Produces:
```ts
export const UPTIME_CONFIRM_MS = 180_000;      // outage confirmed after this long offline
export const HEARTBEAT_GAP_MS = 180_000;       // older heartbeat = monitor was blind
export const HANDSHAKE_BACKDATE_MAX_MS = 300_000;
export interface RouterTick { id: string; userId: string; online: boolean; lastSeen: Date | null }
export interface UptimeState { routerId: string; userId: string; isUp: boolean; changedAt: Date;
  untrackedAt: Date | null; hasOpenOutage: boolean }
export interface UptimeWrites {
  newStates: { routerId: string; userId: string; trackedSince: Date }[];
  setDown: { routerId: string; changedAt: Date }[];
  setUp: { routerId: string; changedAt: Date }[];
  restartConfirmation: { routerId: string; changedAt: Date }[];
  openOutages: { routerId: string; userId: string; startedAt: Date }[];
  closeOutages: { routerId: string; endedAt: Date; reason: 'recovered' | 'removed' }[];
  untrack: { routerId: string; at: Date }[];
  gap: { startedAt: Date; endedAt: Date } | null;
}
export function planUptimeWrites(prev: { states: UptimeState[]; heartbeat: Date | null }, routers: RouterTick[], now: Date): UptimeWrites;   // pure
export async function recordRouterTick(input: { peersOk: boolean; peerCount: number; routers: RouterTick[]; now: Date }): Promise<void>;   // never throws
```
- `recordRouterTick`: returns at once when `!peersOk || peerCount === 0` or when a previous call is still running; otherwise one transaction: `BEGIN`, `SET LOCAL statement_timeout = '3s'`, `SET LOCAL lock_timeout = '1s'`, read states (with open-outage flag) and the heartbeat, apply `planUptimeWrites` with `unnest` batches, set `monitor_heartbeat` to `now`, `COMMIT`. Rules: spec §5.3 "Router recorder rules". Outage `startedAt` = `lastSeen` when it is non-null and `changedAt − lastSeen ≤ HANDSHAKE_BACKDATE_MAX_MS`, else `changedAt`.
- `wireguardMonitor.ts` passes `{ peersOk, peerCount: peers.length, routers: routers.map(r => ({ id, userId: r.user_id, online: newStatus === 'online', lastSeen: handshake time when online else r.last_seen })), now: new Date(nowMs) }` inside its own try/catch.

- [ ] **Step 1: Write the failing tests** (pure reducer with explicit `Date`s, then the DB wrapper on the mocked pool):
```ts
it('an online router with no state row starts being tracked', …)             // newStates has it, trackedSince = now
it('an offline router never seen online is ignored', …)                      // every list empty
it('up → offline marks down and opens no outage yet', …)
it('opens the outage after 180 s, back-dated to the last handshake', …)      // startedAt = lastSeen when within 300 s
it('falls back to changedAt when the last handshake is unknown or old', …)
it('a blip shorter than 180 s leaves no outage', …)                          // setUp only
it('coming back closes the outage as recovered', …)
it('a heartbeat older than 180 s records one gap and restarts pending confirmations', …)
it('a router missing from the tick is untracked and its outage closed as removed', …)   // state row is kept, not deleted
it('writes nothing when peersOk is false', …)                                // pool.connect not called
it('writes nothing when the peer list is empty', …)
it('skips a tick while the previous one is still running', …)
it('swallows a database error', …)                                           // resolves; logger.error called; release called
it('sets the 3 s statement timeout and 1 s lock timeout before any read', …)
it('still records when ANALYTICS_JOBS_ENABLED is false', …)                  // the recorder is not behind the jobs switch
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run src/services/__tests__/routerUptimeRecorder.test.ts src/services/__tests__/wireguardMonitor.test.ts` and `npx tsc --noEmit` → PASS.

**Commit point A** (after Tasks 1–5): `feat(backend): analytics recording (income ledger, card batches, router uptime, last-active) + payment approval fix`.

### Task 6: Jobs — money sync, session ingest, rollup

**Files:**
- Create: `backend/src/services/analyticsUptime.ts`, `backend/src/jobs/analyticsMoneySync.ts`, `backend/src/jobs/analyticsIngest.ts`, `backend/src/jobs/analyticsRollup.ts`
- Modify: `backend/src/server.ts` (register after `startNtpConvergenceJob()` at `:129`)
- Test: `backend/src/services/__tests__/analyticsUptime.test.ts`, `backend/src/jobs/__tests__/analyticsMoneySync.test.ts`, `analyticsIngest.test.ts`, `analyticsRollup.test.ts`

**Interfaces:**
- Consumes: `withGuardedClient`, `getAnalyticsState`, `setAnalyticsState`, `analyticsJobsEnabled` (Task 2); `reconcileIncomeLedger` (Task 3); `dayBoundsUtc`, `hourBoundsUtc`, `khartoumToday`, `addDays` (Task 2); `updateExpiredSubscriptions` (`subscription.service.ts:636`).
- Produces:
```ts
// analyticsUptime.ts (pure)
export interface UptimeDayInput { dayStart: Date; dayEnd: Date; now: Date; heartbeat: Date | null;
  states: { routerId: string; userId: string; trackedSince: Date; untrackedAt: Date | null }[];
  outages: { routerId: string; startedAt: Date; endedAt: Date | null }[];
  gaps: { startedAt: Date; endedAt: Date }[] }
export interface UptimeDayRow { routerId: string; userId: string; observedSeconds: number; downSeconds: number;
  drops: number; longestOutageSeconds: number }
export function foldUptimeDay(input: UptimeDayInput): UptimeDayRow[];
// analyticsMoneySync.ts
export async function runMoneySync(now?: Date): Promise<void>;
export function startAnalyticsMoneySyncJob(): void;     // cron '0 7 * * * *' UTC + setTimeout 30 s after start; not gated
// analyticsIngest.ts
export async function ingestBatch(client: PoolClient, cursor: number, upperBound?: number): Promise<{ nextCursor: number; read: number; inserted: number }>;
export async function runAnalyticsIngest(now?: Date): Promise<void>;
export function startAnalyticsIngestJob(): void;        // cron '20 2-57/5 * * * *' UTC; gated; skipped 01:10–04:00 UTC
// analyticsRollup.ts
export async function rebuildUsageHours(day: string, hours: number[]): Promise<void>;
export async function rebuildCardDay(day: string): Promise<void>;
export async function rebuildUptimeDay(day: string, now?: Date): Promise<void>;
export async function correctCardCounts(day: string): Promise<void>;
export async function runAnalyticsRollup(now?: Date): Promise<void>;
export function startAnalyticsRollupJob(): void;        // cron '0 20 0,4-23 * * *' UTC; gated
```
- `foldUptimeDay`: a router's observation window is `[max(dayStart, trackedSince), min(dayEnd, untrackedAt, end)]` where `end` = `heartbeat` when `now − heartbeat > 180 s` (or `heartbeat` is null → no observation), else `now`. Gap overlap is subtracted from both observed and down seconds. `drops` counts outages whose `startedAt` falls in the day. `longestOutageSeconds` is the full length (to `endedAt`, else to `end`) of the longest outage overlapping the day, minus gap overlap. Routers with zero observed seconds produce no row.
- `runMoneySync`: `updateExpiredSubscriptions()`; `reconcileIncomeLedger()`; refresh `income_ledger.period_end` from `subscriptions.end_date` where they differ; delete `operator_activity` rows whose user no longer exists; when `now` is in UTC hour 4, compare `COUNT(*)`/`SUM(amount)` of approved payments with ledger rows whose `user_id` still exists and `logger.error('Analytics ledger mismatch', …)` on a difference. Every step in its own try/catch.
- `ingestBatch`: the two statements in spec §5.4 "Ingest statements" (the first also takes `AND radacctid <= $upper` when `upperBound` is given); `nextCursor` = highest `radacctid` read, or the old cursor when nothing new. `runAnalyticsIngest`: up to 5 batches, each `withGuardedClient` → `SELECT value FROM analytics_state WHERE key = 'radacct_cursor' FOR UPDATE SKIP LOCKED` (no row → stop) → `ingestBatch` → `setAnalyticsState('radacct_cursor', …, client)`; stops when a batch read fewer than 2,000 rows. A NULL cursor → log and stop (seeding belongs to boot).
- `rebuildUsageHours`: for each hour, one read-only `withGuardedClient` running the usage statement in spec §5.4, 100 ms apart; map `nasipaddress` to a router loaded once from `routers (id, user_id, tunnel_ip, created_at)` — matched only when the router's `created_at` is before the hour's end, else `router_id` NULL. Then one write transaction under `pg_try_advisory_xact_lock(hashtext('analytics_rollup'))` (lock not obtained → return): delete and insert those `(day, hour)` rows in `analytics_usage_hourly`, then delete and re-derive that day in `analytics_usage_daily` and `analytics_hour_daily` from the hourly table.
- `rebuildCardDay`: delete and insert the day in `analytics_card_daily` from `analytics_card_batches` (`created_at` in the day) and `analytics_card_first_use` (`first_used_at` in the day, and on or after `ANALYTICS_USAGE_START_DATE`), grouped by `user_id, router_id, limit_type, price`.
- `rebuildUptimeDay(day, now)`: read `router_uptime_state`, the outages and gaps that overlap the day, and the heartbeat; run `foldUptimeDay`; delete and insert that day in `analytics_uptime_daily` in one transaction under the same advisory lock.
- `correctCardCounts(day)`: guarded `SELECT router_id, user_id, price, limit_type, COUNT(*) FROM voucher_meta WHERE router_id = ANY($1) AND created_at >= $2 AND created_at < $3 GROUP BY 1,2,3,4`, with `$2 = max(dayStart, schema_migrations.executed_at of 045)`; where a group exceeds the recorded batches for the same window, insert the difference as a `reconcile` batch dated one second before the window's end.
- `runAnalyticsRollup(now)`: every run → `rebuildUsageHours` for the last 3 Khartoum hours, `rebuildCardDay(today)`, `rebuildUptimeDay(today)`. UTC hour 22 → also all 24 hours, cards and uptime of yesterday (Khartoum). UTC hour 4 → also the 4 days before today in full, `correctCardCounts(yesterday)` followed by `rebuildCardDay(yesterday)`, and `DELETE FROM analytics_usage_hourly WHERE day < today − 40`. On success `setAnalyticsState('rollup_last_ok', now.toISOString())`. Module `running` flag.

- [ ] **Step 1: Write the failing tests**
```ts
// analyticsUptime.test.ts — dayStart 2026-11-14T22:00Z, dayEnd 2026-11-15T22:00Z
it('a router up all day has 86400 observed and 0 down', …)
it('an outage inside the day counts its seconds and one drop', …)            // 10:00–10:30Z → downSeconds 1800, drops 1, longest 1800
it('an outage that started the day before counts no drop but counts its seconds', …)
it('a gap is removed from observed and from down seconds', …)
it('observation stops at the heartbeat while the monitor is blind', …)       // now − heartbeat = 10 min → end = heartbeat
it('tracking that began mid-day starts the window there', …)
it('an untracked router stops being observed at untrackedAt', …)
it('a router with no observed seconds yields no row', …)
// analyticsIngest.test.ts
it('issues no query when ANALYTICS_JOBS_ENABLED is false', …)
it('is skipped between 01:10 and 04:00 UTC', …)                              // now = 02:30Z → no query
it('reads after the cursor with a 100-id overlap and LIMIT 2000', …)         // SQL contains 'radacctid > $1 - 100' and 'LIMIT 2000'
it('inserts first uses with unnest and ON CONFLICT DO NOTHING', …)
it('updates the cursor before COMMIT in the same transaction', …)
it('leaves the cursor unchanged when the insert fails', …)                   // no cursor UPDATE; release(true)
it('stops when the cursor row is locked by another run', …)
it('does nothing when the cursor is NULL', …)
// analyticsRollup.test.ts
it('issues no query when ANALYTICS_JOBS_ENABLED is false', …)
it('reads radacct one hour at a time grouped by nasipaddress', …)            // SQL contains 'GROUP BY nasipaddress', no JOIN
it('credits a tunnel IP only to a router created before the hour ended', …)
it('writes inside one transaction that holds the advisory lock', …)
it('exits without writing when the advisory lock is taken', …)
it('the 22:00 UTC run rebuilds all 24 hours of the day that just ended', …)
it('the 04:00 UTC run rebuilds four earlier days, corrects card counts and prunes hourly rows', …)
it('records rollup_last_ok only after a successful run', …)
it('the card-count correction never looks before migration 045 was applied', …)
// analyticsMoneySync.test.ts
it('runs expiry, reconcile, period_end refresh and activity prune in order', …)
it('one failing step does not stop the others', …)
it('compares payments with the ledger only in UTC hour 4', …)
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** and register the three jobs in `server.ts`. **Step 4: Run** the four test files and `npx tsc --noEmit` → PASS.

### Task 7: History backfill script

**Files:**
- Create: `backend/src/scripts/analyticsBackfill.ts`
- Test: `backend/src/scripts/__tests__/analyticsBackfill.test.ts`

**Interfaces:**
- Consumes: `ingestBatch`, `rebuildUsageHours`, `rebuildCardDay`, `rebuildUptimeDay` (Task 6); `withGuardedClient`, state helpers (Task 2).
- Produces: `runBackfill(opts: { confirm: boolean; step: 'cards' | 'first-use' | 'usage' | 'days' | 'all'; ignoreWindow: boolean }): Promise<BackfillReport>` with `BackfillReport = { cards: { routers: number; pages: number; batches: number }; firstUse: { fromId: number; toId: number; chunks: number; inserted: number }; usageDays: number; rebuiltDays: number }`; CLI wrapper reading `CONFIRM=1`, `STEP=…`, `IGNORE_WINDOW=1`, modelled on `backend/src/scripts/repairReusedVoucherCodes.ts:19-51`.
- Rules (spec §5.5): dry run by default (reads and counts only); logs `current_database()` and `inet_server_addr()`; refuses outside 04:00–06:00 UTC unless `ignoreWindow`; progress keys in `analytics_state` (`backfill_cards_router`, `backfill_first_use_cursor`, `backfill_usage_day`); pause 250 ms between chunks, doubled after a chunk slower than 5 s; stops after 3 consecutive failures. Step `cards`: per router, keyset pages of 5,000 on `(router_id, created_at DESC, id DESC)` for `created_at <` the moment 045 was applied, grouped by `(created_at, price, limit_type)` into `backfill` batches after deleting that router's earlier `backfill` rows; ends by setting `backfill_cards_done = 'true'`. Step `first-use`: start id = `SELECT radacctid FROM radacct WHERE acctstarttime >= $1 ORDER BY acctstarttime LIMIT 1` minus 1,000; end id = the stored `radacct_cursor`; chunks of 2,000 via `ingestBatch(client, cursor, endId)`. Step `usage`: `rebuildUsageHours(day, [0..23])` for each day from the start date to yesterday. Step `days`: `rebuildCardDay` and `rebuildUptimeDay` for each of those days.

- [ ] **Step 1: Write the failing tests**
```ts
it('a dry run issues no INSERT, UPDATE or DELETE', …)
it('refuses to write outside 04:00–06:00 UTC unless ignoreWindow is set', …)
it('backfills only cards created before migration 045 was applied', …)       // the bound param equals schema_migrations.executed_at
it('replaces a router\'s earlier backfill batches instead of adding to them', …)
it('first-use starts 1,000 ids before the first session of the start date and ends at the stored cursor', …)
it('stops after three consecutive chunk failures', …)
it('resumes from the progress keys', …)
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the test and `npx tsc --noEmit` → PASS.

### Task 8: Analytics API and exports

**Files:**
- Create: `backend/src/services/analytics.service.ts`, `backend/src/services/analyticsTable.ts`, `backend/src/controllers/analytics.controller.ts`, `backend/src/validators/analytics.validators.ts`
- Modify: `backend/src/routes/admin.routes.ts` (new block after `:67`; the four export routes before `/analytics/operators/:id`), `backend/src/controllers/admin.controller.ts` (`export function sendCsv`, and an `Approved At` column from `p.reviewed_at` after `Created At` in `exportPayments` `:123-134`)
- Test: `backend/src/tests/analytics.test.ts`, `backend/src/tests/analyticsGuard.test.ts`, `backend/src/services/__tests__/analyticsTable.test.ts`; extend `backend/src/tests/adminCsvExport.test.ts`

**Interfaces:**
- Consumes: the contract types, `resolvePeriod` (Task 2), `getAnalyticsState` (Task 2), `toCsv` (`backend/src/utils/csv.ts:87`), `auditService.logAction`.
- Produces (`analytics.service.ts`): `getMoneyAnalytics(p: ResolvedPeriod): Promise<{ data: MoneyAnalytics; meta: AnalyticsMeta }>`, `getOperatorsAnalytics(p)`, `getOperatorAnalytics(userId: string, p)` (404 `USER_NOT_FOUND` for an unknown or non-operator id), `getNetworkAnalytics(p)`. Numbers follow spec §5.7 exactly. At most 3 queries in flight at once. All sums and counts are converted to `number`.
- Produces (`analyticsTable.ts`, pure): `applyTableQuery<T>(rows: T[], q: { q?: string; filter?: string; sort?: string; dir?: 'asc' | 'desc' }, spec: { search: (r: T) => string[]; filters: Record<string, (r: T) => boolean>; sorts: Record<string, (r: T) => string | number | null> }): T[]` — nulls sort last in both directions; unknown filter or sort key is ignored.
- Produces (`analytics.validators.ts`): `analyticsPeriodQuerySchema` (`period` enum optional; `from`/`to` `YYYY-MM-DD` optional, both or neither), `analyticsExportQuerySchema` (adds `q` max 100 chars, `filter`, `sort`, `dir`), `analyticsOperatorParamSchema` (`id` uuid).
- CSV columns — renewals due: `Operator, Email, Plan, Ends, Amount, Estimated, Granted, Paid Before`; lost: `Operator, Email, Deleted, Plan, Ended, Months Paid, Total Paid`; operators: `Operator, Email, Plan, Days Left, Routers Online, Routers Total, Cards Created, Cards Used, Sales Value, Change %, Last Active, Going Quiet, Near Limit, Not Started`; routers: `Router, Operator, Uptime %, Drops, Longest Outage (s), Sessions, Data (bytes), Status`. File names `wasel-analytics-<resource>-YYYY-MM-DD.csv`. 10,000-row cap.

- [ ] **Step 1: Write the failing tests** (pattern: `backend/src/tests/statsTimeseries.test.ts:63-191`)
```ts
// analytics.test.ts — for each of the four GET endpoints
it('401 without a token and 403 for a non-admin', …)
it('400 for from without to, a malformed date, from after to, and a span over 400 days', …)
it('returns the envelope with meta.range, meta.previous and meta.timezone', …)
it('returns numbers, not strings, for sums and counts', …)                  // queued rows carry '1240000.00' → body value 1240000
it('returns day and month labels as plain text', …)                         // /^\d{4}-\d{2}-\d{2}$/ and /^\d{4}-\d{2}$/
// money
it('income by month splits new, renewal and plan change', …)
it('changePct is null when the same days last month had no income', …)
it('paying counts only truly-active subscriptions with a ledger row; the rest are granted', …)
it('due to renew falls back to the last ledger amount and marks estimated when the tier has no plan row', …)
it('a granted subscription is listed with amount null and adds nothing to the total', …)
it('renewal rate marks a month provisional until 30 days after it closes and returns null for no ended periods', …)
it('lost excludes an operator with a pending payment that has a receipt and includes one whose request has none', …)
it('lost keeps a deleted operator and flags it', …)
it('lists paid requests that were never activated', …)
// operators
it('flags going quiet only when the previous period reached ANALYTICS_QUIET_MIN_BASE and use halved', …)   // 40 → 20 flags; 19 → 2 does not
it('never flags going quiet when the previous period starts before the usage history', …)
it('near limit ignores quota -1 and 0 and uses 80 percent', …)              // 800 of 1000 flags; 799 does not
it('not started needs no router or no cards, and no ledger row, first use or vouchers_used', …)
it('an operator with no subscription has null plan and daysLeft', …)
it('summary rows of a deleted operator are not listed and do not count in the cards', …)
// network
it('uptimePct is null when nothing was observed', …)
it('status is unknown for every router and monitorStale is true when the heartbeat is older than 3 minutes', …)
it('dropping means 5 or more drops in the last 7 days', …)
it('sessions of a removed router stay in the daily totals but not in the routers list', …)
it('sorts routers by uptime ascending then drops descending', …)
// empty database
it('every endpoint returns zeros, empty arrays and stale: true when no summary exists', …)
// exports
it('each export sets text/csv, the attachment filename and writes an audit row', …)
it('the operators export applies q, filter, sort and dir like the screen', …)
it('export routes are matched before /analytics/operators/:id', …)
// analyticsGuard.test.ts
it('no analytics endpoint SQL mentions radacct, voucher_meta or radpostauth', …)   // call all 8 endpoints, scan every mockPoolQuery SQL string
// analyticsTable.test.ts
it('searches case-insensitively, filters by key, sorts with nulls last in both directions', …)
// adminCsvExport.test.ts
it('the payments export has an Approved At column', …)
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the four test files and `npx tsc --noEmit` → PASS.

### Task 9: Real-Postgres integration suite

**Files:**
- Create: `backend/src/tests/analytics.integration.test.ts` (opt-in, same switch and setup as `backend/src/tests/voucherCodeReuse.integration.test.ts:30-66`)

- [ ] **Step 1: Write the suite**
```ts
it('migrations 044–046 apply twice without error', …)
it('every job statement and the backfill run twice with the same result', …)
it('approving a payment writes one ledger row; approving again adds none', …)
it('history survives deletes', …)
//   approve a payment, create 10 cards, log 3 in (radacct rows), ingest, roll up; snapshot the four endpoints;
//   delete the used cards, the router and the operator; roll up again;
//   income, renewal rate, lost, cards created, cards used, sales value and platform sessions are unchanged
it('the endpoints run in a schema without radacct, voucher_meta and radpostauth', …)
it('ingest after backfill leaves no radacctid unread', …)                    // seed cursor, add rows, backfill to cursor, ingest → every card first-used once
it('EXPLAIN of each guarded statement shows no Seq Scan on radacct or voucher_meta', …)
```
- [ ] **Step 2: Run against the local dev Postgres** → PASS. Fix whatever SQL the mocked suites could not validate.

**Commit point B** (after Tasks 6–9): `feat(backend): analytics jobs, backfill and /admin/analytics API`.

### Task 10: Admin foundations and page shell

**Files (under `admin/src`):**
- Create: `lib/analytics.ts`, `lib/period.ts`, `lib/format.ts`, `lib/tableSort.ts`, `pages/AnalyticsPage.tsx`, `components/analytics/PeriodPicker.tsx`, `FilterChips.tsx`, `RefreshedStamp.tsx`, and one-line placeholder `MoneyTab.tsx`, `OperatorsTab.tsx`, `NetworkTab.tsx` (replaced by Tasks 12–14), `tests/analyticsFixtures.ts`
- Modify: `App.tsx:70-84`, `lib/nav.ts:29-43` and `:60-61`, `components/DataTable.tsx`, `components/StatCard.tsx`, `lib/datetime.ts`, `pages/DashboardPage.tsx:88-98` (import `formatRelative` from `lib/format`)
- Test: `lib/__tests__/format.test.ts`, `period.test.ts`, `tableSort.test.ts`, `nav.test.ts`; `components/__tests__/DataTable.test.tsx`, `StatCard.test.tsx`, `PeriodPicker.test.tsx`; `pages/__tests__/AnalyticsPage.test.tsx`

**Interfaces:**
- Produces (`lib/analytics.ts`): the contract types; `fetchMoney(p: PeriodQuery)`, `fetchOperators(p)`, `fetchNetwork(p)`, `fetchOperator(id, p)` each returning `{ data, meta }`; `analyticsKey(tab: string, p: PeriodQuery): unknown[]` = `['admin','analytics',tab,periodKey(p)]`.
- Produces (`lib/period.ts`): `type PeriodQuery = { period: PeriodPreset } | { from: string; to: string }`; `PRESETS: Record<AnalyticsTab, { key: PeriodPreset; label: string }[]>` (money: This month / 3 months / 12 months; operators and network: 30 days / 3 months / 12 months); `parsePeriod(params: URLSearchParams, tab: AnalyticsTab): PeriodQuery`; `periodToParams(p: PeriodQuery): Record<string, string>`; `periodKey(p): string`.
- Produces (`lib/format.ts`, all `en-GB`): `formatSdg(n)` → `'SDG 1,240,000'`; `formatCompact(n)` → `'1.2M'`; `formatNumber(n)`; `formatPercent(n | null, digits = 0)` → `'93%'` or `'—'`; `formatChange(n | null)` → `'+18%'`, `'-62%'`, `'—'`; `formatDuration(sec)` → `'6 min'`, `'9 h'`, `'2 d'`; `formatBytes(n)` → `'38 GB'`; `formatQuota(n)` → `'Unlimited'` for `-1`; `formatRelative(ts, now)`; `apiErrorMessage(err: unknown): string | undefined`.
- Produces (`lib/tableSort.ts`): `type SortState = { key: string; dir: 'asc' | 'desc' }`; `sortRows<T>(rows: T[], value: (r: T) => string | number | null, dir): T[]` (nulls last in both directions); `matchesSearch(haystack: (string | null)[], q: string): boolean`.
- Produces (`DataTable`): optional `sort?: SortState`, `onSortChange?: (s: SortState) => void`, `rowKey?: (row: T) => string`, `emptyMessage?: string`; `Column<T>` gains `sortValue?: (row: T) => string | number | null` and `align?: 'left' | 'right'`. A column with `sortValue` renders a `<button>` inside `<th aria-sort>`. Existing required props are unchanged.
- Produces (`StatCard`): optional `sub?: ReactNode` and `delta?: { text: string; direction: 'up' | 'down' | 'flat'; good: boolean }`.
- Produces (`lib/datetime.ts`): `formatDay(day: string)` → `'15 Nov'`, `formatMonth(month: string)` → `'Nov 2026'` (plain strings formatted as UTC, never shifted).
- `AnalyticsPage`: route `/analytics` → redirect `/analytics/money`; `/analytics/:tab`; an unknown tab redirects to money. Tab links are `NavLink`s inside a `<nav>`; the period lives in the query string and is kept when switching tabs (a preset the new tab lacks is dropped); `q`, `filter`, `sort`, `dir` are dropped on a tab switch. Nav item `{ label: 'Analytics', path: '/analytics', icon: ChartColumn }` after Dashboard; `pageTitleFor('/analytics/money')` → `'Analytics'`.
- `RefreshedStamp`: props `{ live?: boolean; dataUpdatedAt?: number; refreshedAt?: string | null; stale?: boolean }` → "Live, updated 2m ago" or "Figures as of 15 Nov 2026, 12:20" (amber when stale; "No figures yet" when null).

- [ ] **Step 1: Write the failing tests**
```ts
expect(formatSdg(1240000)).toBe('SDG 1,240,000');   expect(formatPercent(null)).toBe('—');
expect(formatChange(18.4)).toBe('+18%');            expect(formatChange(-62)).toBe('-62%');
expect(formatDuration(360)).toBe('6 min');          expect(formatDuration(32400)).toBe('9 h');
expect(formatBytes(38 * 1024 ** 3)).toBe('38 GB');  expect(formatQuota(-1)).toBe('Unlimited');
expect(parsePeriod(new URLSearchParams('period=30d'), 'money')).toEqual({ period: 'month' });
expect(parsePeriod(new URLSearchParams('from=2026-11-01&to=2026-11-10'), 'network')).toEqual({ from: '2026-11-01', to: '2026-11-10' });
expect(sortRows([{ v: 2 }, { v: null }, { v: 1 }], r => r.v, 'desc').map(r => r.v)).toEqual([2, 1, null]);
expect(pageTitleFor('/analytics/network')).toBe('Analytics');
it('DataTable: clicking a sortable header calls onSortChange and sets aria-sort', …)
it('DataTable: renders unchanged when no sort props are passed', …)
it('StatCard: shows the delta text and sub line', …)
it('PeriodPicker: shows the tab\'s presets, marks the active one, and Custom reveals two date inputs', …)
it('AnalyticsPage: /analytics redirects to /analytics/money', …)
it('AnalyticsPage: the period from the URL reaches the API call', …)        // api.get called with params { period: '3m' }
it('AnalyticsPage: switching tab keeps a shared preset and drops q, filter and sort', …)
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the listed tests, the existing page tests, `npx tsc --noEmit` → PASS.

### Task 11: Chart components

**Files (under `admin/src/components/charts`):**
- Create: `chartCore.tsx`, `BarChart.tsx`, `LineChart.tsx`, `ShareBars.tsx`, `HeatGrid.tsx`
- Test: `__tests__/BarChart.test.tsx`, `LineChart.test.tsx`, `ShareBars.test.tsx`, `HeatGrid.test.tsx`

**Interfaces:**
```ts
export type Series = { key: string; label: string; colorClass: string; dashed?: boolean };   // colorClass = Tailwind text colour
type Common = { ariaLabel: string; height?: number; valueFormat?: (n: number) => string; emptyMessage?: string };
BarChart(props: Common & { data: { label: string; values: Record<string, number>; muted?: boolean }[]; series: Series[]; stacked?: boolean; yMax?: number; axisFormat?: (n: number) => string })
LineChart(props: Common & { points: { label: string; values: Record<string, number | null> }[]; series: Series[]; axisFormat?: (n: number) => string })
ShareBars(props: Common & { items: { label: string; value: number; colorClass?: string }[]; maxItems?: number })
HeatGrid(props: Common & { cells: number[][]; rowLabels: string[]; colLabels: string[]; colorClass?: string })   // cells[row][col]
```
- **Load the `dataviz` skill before writing any chart code.** Technique as `TrendChart.tsx:28-36`: shapes in a stretched SVG, all text in HTML positioned by percentage. `chartCore.tsx` holds the y-axis ticks, legend, hover/focus tooltip and a visually-hidden data table. Series colours: blue, violet, slate (green, amber and red already mean status). Every chart has `role="img"` with `ariaLabel`, and renders a same-height block with `emptyMessage ?? 'No data in this period'` when there is nothing to draw. `muted` bars are drawn lighter (provisional months). No `NaN` attribute may reach the DOM for all-zero or single-point data.

- [ ] **Step 1: Write the failing tests**
```ts
it('BarChart: 3 months × 3 stacked series render 9 bar marks', …)
it('BarChart: a muted bar carries the lighter class', …)
it('BarChart / LineChart / ShareBars / HeatGrid: empty data shows the empty block with the same height', …)
it('BarChart: all-zero data renders without NaN in any attribute', …)
it('LineChart: two series render two paths and a null value breaks the line', …)
it('LineChart: focusing a column shows the tooltip with both series values', …)
it('ShareBars: widths are proportional and the list is cut to maxItems with an "Other" row', …)
it('HeatGrid: 7 × 24 cells render 168 cells; the largest value gets the strongest step', …)
it('each chart exposes role="img" and a hidden data table', …)
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.

### Task 12: Money tab and Payments "Approved" column

**Files (under `admin/src`):**
- Replace: `components/analytics/MoneyTab.tsx`
- Modify: `pages/PaymentsPage.tsx` (`:178-180` add an "Approved" column showing `reviewed_at` via `formatDateTime`, `'—'` when null; `:75` also invalidate `['admin','analytics','money']`)
- Test: `components/analytics/__tests__/MoneyTab.test.tsx`; extend `pages/__tests__/PaymentsPage.test.tsx`

**Interfaces:** consumes Task 10 (`fetchMoney`, `analyticsKey`, format helpers, `DataTable`, `StatCard`, `RefreshedStamp`) and Task 11 (`BarChart`, `ShareBars`). Layout as spec §3 "Money": four cards (they do not follow the picker; "Paying operators" shows `+N granted` as its sub line), income per month (`BarChart` stacked: new / renewal / plan change), income by plan (`ShareBars`), renewal rate (`BarChart`, provisional months `muted`, `yMax: 100`), the two tables with `ExportCsvButton` (`/admin/analytics/money/renewals-due/export`, `/admin/analytics/money/lost/export`), a line "Includes SDG x from deleted operators" when `fromDeletedOperators > 0`, an amber notice listing `paidNotActivated` when non-empty, and the footnote "Income is counted on the day a payment was approved, Khartoum time."

- [ ] **Step 1: Write the failing tests**
```ts
it('shows the four cards with formatted amounts and "+3 granted"', …)
it('shows "—" for the change when changePct is null', …)
it('renders the renewals-due and lost tables with a "granted" tag and a "(deleted)" mark', …)
it('shows the paid-not-activated notice only when the list is non-empty', …)
it('shows the deleted-operators line only when the amount is above zero', …)
it('renders empty states with no NaN when every array is empty and every number is 0', …)
it('shows ErrorPanel and refetches on retry', …)
it('export buttons carry the current period', …)
it('PaymentsPage: the table has an Approved column', …)
```
- [ ] **Step 2–4:** run → FAIL; implement; run → PASS.

### Task 13: Operators tab and operator page section

**Files (under `admin/src`):**
- Replace: `components/analytics/OperatorsTab.tsx`
- Create: `components/analytics/OperatorAnalyticsSection.tsx`
- Modify: `pages/UserDetailPage.tsx` (section after the Routers card `:257`; Uptime and Drops columns merged into the routers table `:210-255`, wrapper `overflow-x-auto`; `formatQuota` at `:186`; error extractor replaced by `apiErrorMessage`)
- Test: `components/analytics/__tests__/OperatorsTab.test.tsx`, `OperatorAnalyticsSection.test.tsx`; extend or create `pages/__tests__/UserDetailPage.test.tsx`

**Interfaces:** consumes Tasks 10–11. Tab layout as spec §3 "Operators": four cards; table with the nine columns, client-side sort (`sortRows`), search on operator and email, chips `All | Quiet | Near limit | Not started` filtering on `row.flags`, `ExportCsvButton` to `/admin/analytics/operators/export` with the period plus `q`, `filter`, `sort`, `dir`; the operator name is a `Link` to `/users/:userId`; client-side paging of 20. `OperatorAnalyticsSection({ userId })`: its own `PeriodPicker` (state local to the section, default `30d`), `LineChart` of cards created and used, `BarChart` of sales value captioned "Operator's own sales, not Wasel income", a payments table with "Total paid".

- [ ] **Step 1: Write the failing tests**
```ts
it('renders the four cards and one row per operator', …)
it('sorting by Cards used reorders rows and nulls stay last', …)
it('the Quiet chip shows only rows flagged isQuiet', …)
it('search matches the operator name and email', …)
it('the export button carries period, q, filter, sort and dir', …)
it('shows "—" for Change and Last active when they are null', …)
it('renders the empty state when there are no operators', …)
it('UserDetailPage still renders its existing cards when the analytics request fails', …)
it('UserDetailPage shows "Unlimited" for a -1 quota', …)
it('OperatorAnalyticsSection: changing the period refetches with the new period', …)
```
- [ ] **Step 2–4:** run → FAIL; implement; run → PASS.

### Task 14: Network and cards tab

**Files (under `admin/src`):**
- Replace: `components/analytics/NetworkTab.tsx`
- Test: `components/analytics/__tests__/NetworkTab.test.tsx`

**Interfaces:** consumes Tasks 10–11. Layout as spec §3 "Network and cards": four cards ("Routers online now" shows `uptimePct` as its sub line and "Status unknown" when `monitorStale`); `LineChart` of cards created and used per day; `HeatGrid` 7 × 24 from `hours` (rows Sat → Fri, columns 0–23); `BarChart` of data per day (`formatBytes`); routers table (eight columns, client-side sort starting as delivered, search on router and operator, chips `All | Dropping | Offline now`, export to `/admin/analytics/network/routers/export`); `ShareBars` for card types by price and by kind. Notices: "Router history began on <routerHistoryStart>" for the first 30 days, or "Router uptime starts recording at launch" when null; "Use history begins on <usageHistoryStart>" when the range starts before it; "Sales value excludes N cards with no price" when `unpricedUsed > 0`.

- [ ] **Step 1: Write the failing tests**
```ts
it('renders the four cards, three charts, the routers table and card types', …)
it('shows "Status unknown" and no online count when monitorStale is true', …)
it('shows "—" for uptime when uptimePct is null', …)
it('the Dropping chip shows only rows flagged dropping', …)
it('shows the launch notice when routerHistoryStart is null', …)
it('shows the use-history notice when the range starts before usageHistoryStart', …)
it('renders empty states with no NaN when every array is empty', …)
```
- [ ] **Step 2–4:** run → FAIL; implement; run → PASS. Then for Tasks 10–14 together: `npx vitest run`, `npx tsc --noEmit`, `npm run build` → all PASS.

**Commit point C** (after Tasks 10–14): `feat(admin): Analytics page (Money, Operators, Network and cards)`.

### Task 15: Reviews

- [ ] **Step 1: Security review** (`security-auditor`) of `git diff f559514..HEAD` plus the working tree: admin guard on every new route; Zod on every query and param; sort and filter whitelists; the timezone only ever a bound parameter; CSV formula guard through `toCsv`; audit rows on the four exports; no secrets or operator data in logs or error messages; the approval change cannot activate a subscription of another user.
- [ ] **Step 2: Architecture review** (`code-reviewer`): job schedules against the existing ones (01:15–01:45, 02:10, 02:40, 03:30, 03:50 UTC, `:50` hourly, `:00` hourly), pool use (max 10), statement shapes and indexes, idempotency of every job and the backfill, the Global Constraints.
- [ ] **Step 3: Fix every confirmed finding**, re-run both test suites, `tsc`, and the admin build.

### Task 16: Staging and project state

- [ ] **Step 1:** Run the project `verify` skill for the backend API and the admin UI (three tabs, a period change, a sort, a chip, an export, the operator page).
- [ ] **Step 2:** Push `dev`, deploy to staging, and run spec-plan verification: the cursor seeds itself at boot; backfill dry run → confirmed run → second run with no change (`IGNORE_WINDOW=1` on staging); one staging login produces one first-use row; the approval-fix scenario (reject a plan change, approve a later request → that request is active and exactly one subscription is active); export payments and check the month's "Approved At" sum equals Money income minus the deleted-operators line; `pg_stat_user_tables.seq_scan` for `radacct`, `voucher_meta`, `radpostauth` does not rise while every tab and export loads.
- [ ] **Step 3:** Update `docs/PROJECT_STATE.md`: what shipped to `dev` and staging, the prod rollout notes from the approved plan (deploy with `ANALYTICS_JOBS_ENABLED=false`, `EXPLAIN` gate, backfill 04:00–06:00 UTC, then enable), the known limits (spec §6), and that the dashboard's "Active subscriptions" number drops at deploy.

**Commit point D:** `docs(state): admin Analytics on dev + staging` (with any review fixes not already committed).

## Execution order

Tasks whose files do not overlap run in parallel:

1. Tasks 1, 2, 10, 11.
2. Tasks 3, 4, 5 (backend) alongside Tasks 12, 13, 14 (admin). → Commit point A.
3. Tasks 6 and 8 in parallel, then Task 7, then Task 9. → Commit points B and C.
4. Task 15, then Task 16. → Commit point D.

Agents: Task 1 `database-schema`; Tasks 2–4, 6–9 `backend-api`; Task 5 `radius-networking`; Tasks 10–14 general agent; Task 15 `security-auditor` then `code-reviewer`.
