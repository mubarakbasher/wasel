# Admin panel: Analytics section (Money · Operators · Network and cards) — design

**Date:** 2026-11-15 · **Status:** approved, in implementation on `dev`
**How it was made:** brainstormed with the owner (three screens approved from sketches), three competing technical designs scored by three reviewers, combined, red-teamed twice (21 findings folded in), then read by a fresh reviewer as a builder.

> **(theirs)** = the owner said or approved it. **(my call)** = a default I chose that the owner should check.
> Paths are relative to `C:\Users\mubar\Desktop\Wasel`. Target: `dev` branch + staging only. Prod is not touched.

## 1. Context

The admin dashboard shows only 4 totals, 2 status donuts and one 30-day trend. The owner wants to know the
money, see how each operator is really doing, and see how routers and cards behave. Reading the code showed
that most of this cannot be answered from what is stored today: router up/down history and operator
last-active time are not recorded, deleting an operator erases their payments, and card usage across
2.6 million cards is too heavy to compute on a page load. So this work adds a new Analytics page **and** the
recording and summaries behind it.

## 2. What the owner decided (theirs)

- All three areas, built **now as one delivery** (staging in three steps was offered and rejected).
- Most important job: **know the money**.
- The three screens in section 3, each in its full version (a simpler version was offered and declined).
- **Failure even if it works:** (1) numbers that do not match the Payments page or what was really received;
  (2) Wi-Fi logins or the operators' app getting slower, even briefly.
- Other admins seeing money, and a busy page, are not concerns → visible to every admin, full content.
- All real payments are in SDG; the US-dollar period was testing only → sum approved payments as they are.
- **All subscription money goes through "Approve" on the Payments page**, never by hand → income is
  counted from approved payments only; manual Activate / Extend actions carry no money.
- **Fix the payment-approval bug in this work** (section 5.8): approving a payment must switch on the
  request that payment was made for.

## 3. Screens (approved)

**Money** — period picker `This month | 3 months | 12 months | Custom`
- Cards: Income this month (+% vs last) · Paying operators (true count) · Due to renew next 30 days
  (amount, operators) · Payments waiting (count, amount, oldest).
- Income per month, stacked new / renewal / plan change · Income by plan · Renewal rate per month.
- Table *Renewals due in the next 30 days* (Operator, Plan, Ends, Amount, Paid before) + CSV.
- Table *Operators lost* (Operator, Plan, Ended, Months paid, Total paid) + CSV.

**Operators**
- Cards: Active operators (n of total) · Going quiet · Near card limit · Not started.
- Table: Operator, Plan, Days left, Routers on/all, Cards created, Cards used, Sales value, Change,
  Last active. Sort by any column, search, chips `All | Quiet | Near limit | Not started`, CSV.
- Click an operator → their page gains: cards created and used per day, sales value per day, their routers
  with uptime and drops, their payments and total paid.

**Network and cards**
- Cards: Routers online now (n of total, uptime %) · Keep dropping (5+ drops this week) · Cards used (of
  created) · Sales value of used cards.
- Cards created and used per day · Busiest hours (weekday × hour, Khartoum) · Data used per day.
- Table *Routers, worst first*: Router, Operator, Uptime, Drops, Longest outage, Sessions, Data, Now.
  Search, chips `All | Dropping | Offline now`, CSV.
- Card types in use: by price, by kind (time-limited / data-limited).

"Sales value" is the operators' own card sales (card prices), never mixed with Wasel income (theirs).

## 4. Decisions I made (my call — owner to check)

1. Income is counted on the **approval day**, in Khartoum time. The Payments page gains an "Approved"
   column (table and CSV) so the two can be compared line by line.
2. Paying operators = subscription active, not past its end, **and paid for**. Subscriptions an admin
   granted without a payment are shown beside it as "+N granted", not counted as paying.
3. Renewal rate and Operators lost are based on paid periods only. An operator with only an unpaid request
   (no receipt uploaded) still counts as lost.
4. Deleted operators stay in past income and in Operators lost, marked "(deleted)".
5. Income this month is compared with the **same days** of last month.
6. Going quiet needs at least 20 cards used in the previous period before it can flag.
7. "Worst first" = lowest uptime, then most drops.
8. Card and router numbers refresh **hourly**; money is live. Each tab shows when it was last refreshed.
9. Use-related history (cards used, sales value, sessions, busiest hours, data) starts **2026-10-20**;
   session times before that came from router clocks and are unreliable.
10. Charts are hand-written SVG like the existing two; no chart library is added.
11. English, light theme, same look as the rest of the admin panel.
12. Not included: emailed or scheduled reports, alerts, failed-login analysis, PDF export, changes to the
    operator mobile app, forecasting beyond "due to renew".
13. The dashboard's "Total Revenue" and its revenue trend switch to the same income record as the Money
    tab (includes deleted operators, Khartoum days), so the two pages can never disagree.
14. Periods: Money offers This month / 3 months / 12 months / Custom; Operators and Network offer
    30 days / 3 months / 12 months / Custom (as in the approved sketches). "3 months" = this month so far
    plus the 2 full months before; the previous period is the same span shifted back. The four Money
    cards keep their own fixed meaning and do not follow the picker; charts and tables do.
15. Subscriptions granted without a payment appear in "Renewals due" tagged "granted" with no amount,
    and add nothing to the "Due to renew" total.
16. If any operator has a paid request that was never switched on (see section 5.8, payment-approval bug fix), the Money tab
    shows a notice with their names.

## 5. Design

### 5.1 Approach

Record what cannot be rebuilt at the moment it happens; let small scheduled jobs turn new data into per-day
summaries; make every page read only those summaries and the small live tables. No existing table gets a
new column, index, foreign key or lock. Chosen from three competing designs (scores 20 / 16 / 14 from three
reviewers), then red-teamed twice; all 21 red-team findings are folded in below.

### 5.2 Data model — three new migrations, new empty tables only

`CREATE … IF NOT EXISTS`, no foreign keys (history must survive deletes), no data reads inside a migration.

```sql
-- backend/src/migrations/sql/044_analytics_money.sql
CREATE TABLE income_ledger (
  payment_id UUID PRIMARY KEY, user_id UUID NOT NULL,
  operator_name VARCHAR(100), operator_email VARCHAR(255),
  subscription_id UUID, replaces_subscription_id UUID,
  plan_tier VARCHAR(50) NOT NULL, plan_name VARCHAR(100), duration_months INTEGER,
  amount NUMERIC(12,2) NOT NULL,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('new','renewal','plan_change')),
  approved_at TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ,
  source VARCHAR(10) NOT NULL DEFAULT 'live');          -- 'live' | 'reconcile'
CREATE INDEX idx_income_ledger_approved ON income_ledger (approved_at);
CREATE INDEX idx_income_ledger_user ON income_ledger (user_id, approved_at);
CREATE TABLE operator_activity (user_id UUID PRIMARY KEY, last_active_at TIMESTAMPTZ NOT NULL);

-- 045_analytics_recording.sql
CREATE TABLE analytics_state (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
INSERT INTO analytics_state (key) VALUES ('radacct_cursor'),('monitor_heartbeat') ON CONFLICT DO NOTHING;
CREATE TABLE router_uptime_state (router_id UUID PRIMARY KEY, user_id UUID NOT NULL,
  tracked_since TIMESTAMPTZ NOT NULL, is_up BOOLEAN NOT NULL, changed_at TIMESTAMPTZ NOT NULL,
  untracked_at TIMESTAMPTZ);                             -- set when the router is deleted; row is kept
CREATE TABLE router_outages (id BIGSERIAL PRIMARY KEY, router_id UUID NOT NULL, user_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ, end_reason VARCHAR(20));
CREATE UNIQUE INDEX uq_router_outages_open ON router_outages (router_id) WHERE ended_at IS NULL;
CREATE INDEX idx_router_outages_window ON router_outages (ended_at, started_at);
CREATE TABLE monitor_gaps (id BIGSERIAL PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ NOT NULL);
CREATE TABLE analytics_card_batches (id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL, router_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL, card_count INTEGER NOT NULL, price NUMERIC(10,2), limit_type VARCHAR(10),
  source VARCHAR(10) NOT NULL DEFAULT 'live');           -- 'live' | 'reconcile' | 'backfill'
CREATE INDEX idx_acb_created ON analytics_card_batches (created_at);
CREATE INDEX idx_acb_router ON analytics_card_batches (router_id, created_at);
CREATE TABLE analytics_card_first_use (radius_username VARCHAR(64) PRIMARY KEY, user_id UUID NOT NULL,
  router_id UUID NOT NULL, price NUMERIC(10,2), limit_type VARCHAR(10),
  first_used_at TIMESTAMPTZ NOT NULL, first_radacctid BIGINT NOT NULL);
CREATE INDEX idx_acfu_used ON analytics_card_first_use (first_used_at);

-- 046_analytics_summaries.sql      ("day" = Africa/Khartoum calendar date)
CREATE TABLE analytics_card_daily (day DATE NOT NULL, user_id UUID NOT NULL, router_id UUID NOT NULL,
  limit_type VARCHAR(10), price NUMERIC(10,2),
  cards_created INTEGER NOT NULL DEFAULT 0, cards_used INTEGER NOT NULL DEFAULT 0,
  UNIQUE NULLS NOT DISTINCT (day, user_id, router_id, limit_type, price));
CREATE INDEX idx_acd_user_day ON analytics_card_daily (user_id, day);
CREATE TABLE analytics_usage_hourly (day DATE NOT NULL, hour SMALLINT NOT NULL, router_id UUID, user_id UUID,
  sessions INTEGER NOT NULL, data_bytes BIGINT NOT NULL,
  UNIQUE NULLS NOT DISTINCT (day, hour, router_id));     -- router_id NULL = no matching router; kept 40 days
CREATE TABLE analytics_usage_daily (day DATE NOT NULL, router_id UUID, user_id UUID,
  sessions INTEGER NOT NULL, data_bytes BIGINT NOT NULL, UNIQUE NULLS NOT DISTINCT (day, router_id));
CREATE TABLE analytics_hour_daily (day DATE NOT NULL, hour SMALLINT NOT NULL,
  sessions INTEGER NOT NULL, data_bytes BIGINT NOT NULL, PRIMARY KEY (day, hour));
CREATE TABLE analytics_uptime_daily (day DATE NOT NULL, router_id UUID NOT NULL, user_id UUID NOT NULL,
  observed_seconds INTEGER NOT NULL, down_seconds INTEGER NOT NULL, drops INTEGER NOT NULL,
  longest_outage_seconds INTEGER NOT NULL, PRIMARY KEY (day, router_id));
```

Postgres is 16 (`docker-compose.yml:67`), so `UNIQUE NULLS NOT DISTINCT` is valid.

New config in `backend/src/config/index.ts` (env schema, lines 83-159):
`ANALYTICS_JOBS_ENABLED` (`'true'|'false'` enum, default `'true'`; gates only the two big-table jobs),
`ANALYTICS_TZ` (default `Africa/Khartoum`, always a bound parameter, never interpolated),
`ANALYTICS_USAGE_START_DATE` (default `2026-10-20`), `ANALYTICS_QUIET_MIN_BASE` (default `20`).

### 5.3 Recording at the moment things happen

A hook failure is logged and reported, and never fails the action it sits in.

| What | Where | What is written |
|---|---|---|
| Payment approved | `reviewPayment`, `backend/src/services/admin.service.ts`, between the activation block (`:765-817`) and `COMMIT` (`:819`) | New `backend/src/services/analyticsRecording.service.ts` `recordIncome(client, paymentId, activatedSubscriptionId)`: `SAVEPOINT` → one `INSERT … SELECT … ON CONFLICT (payment_id) DO NOTHING` → `RELEASE`; on error `ROLLBACK TO SAVEPOINT`, approval still commits. Snapshot of operator name/email, tier, `COALESCE(plans.name, plan_tier)`, duration, amount, `approved_at`, `period_end`, kind. |
| Card batch created | `createVouchers`, `backend/src/services/voucher.service.ts`, just before `COMMIT` (`:743`) | One `analytics_card_batches` row under a savepoint (count, price, limit type). `:654` is the only insert into `voucher_meta`. |
| Router up / down | New `backend/src/services/routerUptimeRecorder.ts`, called from `checkRouterStatuses` after the status transaction (`backend/src/services/wireguardMonitor.ts:328-356`) in its own try/catch | See below. Always on (not behind the jobs switch). |
| Operator active | New `backend/src/services/operatorActivity.service.ts` `touchOperatorActivity`, called as `void touch(...).catch(log)` after `issueTokenPair` in `login` (`backend/src/services/auth.service.ts:138`) and `refresh` (`:168-169`), role `user` only | Upsert guarded by `last_active_at < NOW() - INTERVAL '5 minutes'`. Never called from the `authenticate` middleware. `server.ts:39-45` exits the process on an unhandled rejection, hence the explicit `.catch`. |
| Session cursor | `backend/src/server.ts`, once after migrations, regardless of the jobs switch | `UPDATE analytics_state SET value = (SELECT COALESCE(MAX(radacctid),0) FROM radacct) WHERE key='radacct_cursor' AND value IS NULL` (primary-key endpoint lookup). The ingest never reseeds. |

**Income kind:** `new` if the operator has no earlier approved payment; else `plan_change` if the activated
subscription has `previous_subscription_id`; else `renewal`.

**Payment → subscription link:** the live hook receives the id that `reviewPayment` actually activated.
The reconcile uses `s.user_id = p.user_id AND s.start_date = p.reviewed_at` first (both are `NOW()` in the
approval transaction, `admin.service.ts:745`, `:790`, `:809`; `updateSubscription` cannot edit `start_date`),
then `s.created_at = p.created_at` (both `DEFAULT NOW()` in the request transaction,
`backend/src/services/subscription.service.ts:244-275`, `:513-543`).

**Router recorder rules**
- A tick is trusted only if `listPeers` did not throw (new `peersOk` flag set in the catch at
  `wireguardMonitor.ts:140-144`) **and** returned at least one peer (`wireguardPeer.ts:128-130` returns `[]`
  for an empty dump). An untrusted tick writes nothing.
- One transaction per tick with `SET LOCAL statement_timeout='3s'`, `lock_timeout='1s'`, behind a module
  flag (the monitor's `setInterval` has no single-flight, `:484-490`); writes batched with `unnest`.
- Heartbeat in `analytics_state`. A heartbeat older than 180 s inserts a `monitor_gaps` row.
- First sight: an online router with no state row gets one; an offline one is ignored until first seen online.
- Up → offline sets `is_up=false`. After 180 s more (existing grace, `:14`) an outage is inserted with
  `started_at` = the router's last handshake (`routers.last_seen`) when known, else `changed_at`.
- Offline → online closes the outage. A router that left the monitor list gets its outage closed and
  `untracked_at` set (row kept, so past days do not change).

### 5.4 Jobs (`backend/src/jobs/`, registered in `backend/src/server.ts:117-131`)

Big-table statements go through `withGuardedClient` in new `backend/src/services/analyticsDb.ts`: it takes
its own client and itself runs `BEGIN` → `SET LOCAL statement_timeout='15s'`, `enable_seqscan=off` →
callback → `COMMIT`; on error `client.release(true)` (pattern: `backend/src/jobs/validityExpiration.ts:141-172`).
A per-call option allows hash joins where the hashed side is a small array.

| Job | Schedule (UTC) | Does | Touches |
|---|---|---|---|
| `analyticsMoneySync.ts` | `0 7 * * * *` and once 30 s after boot, always on | Calls `updateExpiredSubscriptions()` (`subscription.service.ts:636`); inserts any approved payment missing from the ledger (first run fills all money history); refreshes `period_end` from live subscriptions; prunes `operator_activity` of deleted users; at 04:07 compares count and sum of approved payments with ledger rows of existing operators and reports a mismatch. | Small tables only |
| `analyticsIngest.ts` | `20 2-57/5 * * * *`, skipped 01:10–04:00, gated | Reads new `radacct` rows after the saved cursor (minus a 100-id overlap, as `voucherEnforcement.service.ts:72-77`), `LIMIT 2000`, up to 5 batches; for each, records the card's first use if no earlier session exists. Cursor update is in the same transaction. | `radacct_pkey`, `radacct_username_idx`, `voucher_meta` unique `radius_username`; ~470 rows per run at the prod peak of 5,591 sessions/hour |
| `analyticsRollup.ts` | `0 20 0,4-23 * * *`, gated | Reads first, writes after: each read is its own guarded read-only transaction; results held in memory; then **one short** write transaction per day (delete-and-insert) under `pg_try_advisory_xact_lock`. Hourly: last 3 Khartoum hours of usage + today's card and uptime summaries. 22:20 UTC (just after Khartoum midnight): a full rebuild of the Khartoum day that just ended. 04:20: a full rebuild of the 4 Khartoum days before today, plus the card-count correction, plus pruning `analytics_usage_hourly` older than 40 days. | `radacct_acctstarttime_idx` one hour at a time (≤ ~5,600 rows per statement) |

Ingest statements:

```sql
SELECT radacctid, username, acctstarttime FROM radacct
 WHERE radacctid > $1 - 100 AND username <> '' ORDER BY radacctid LIMIT 2000;
INSERT INTO analytics_card_first_use
SELECT n.username, vm.user_id, vm.router_id, vm.price, vm.limit_type, n.acctstarttime, n.radacctid
  FROM unnest($1::text[], $2::bigint[], $3::timestamptz[]) n(username, radacctid, acctstarttime)
  JOIN voucher_meta vm ON vm.radius_username = n.username
 WHERE NOT EXISTS (SELECT 1 FROM radacct o WHERE o.username = n.username AND o.radacctid < n.radacctid)
ON CONFLICT (radius_username) DO NOTHING;
```

Usage statement (per Khartoum hour, `radacct` alone; tunnel IP → router mapped in code, using
`routers.created_at <= acctstarttime` only for an IP reused inside the window; the fleet is ~390 routers):

```sql
SELECT nasipaddress, COUNT(*) AS sessions,
       COALESCE(SUM(COALESCE(acctinputoctets,0)+COALESCE(acctoutputoctets,0)),0) AS data_bytes
  FROM radacct WHERE acctstarttime >= $1 AND acctstarttime < $2 GROUP BY nasipaddress;
```

`analytics_usage_daily` and `analytics_hour_daily` are derived from `analytics_usage_hourly` in the same
write transaction. `analytics_card_daily` is rebuilt from the two card fact tables only.
`analytics_uptime_daily` comes from a pure fold of state, outages and gaps: observation ends at the
heartbeat while a gap is still open, and gap overlap is subtracted from outage seconds.

Card-count correction (04:20): per router, `count(*)` of `voucher_meta` rows created yesterday through
`idx_voucher_meta_router_keyset` (`036_keyset_pagination_indexes.sql:9-10`), **only for cards created at or
after the moment migration 045 was applied** (`schema_migrations.executed_at`); any excess over recorded
batches becomes a `reconcile` batch.

### 5.5 Backfill of history — `backend/src/scripts/analyticsBackfill.ts`

Modelled on `backend/src/scripts/repairReusedVoucherCodes.ts:19-51`: dry-run by default, `CONFIRM=1` to
write, logs the database identity, progress kept in `analytics_state`, every chunk through
`withGuardedClient`, pause doubles when a chunk takes over 5 s, stops after 3 failures, waits while the
rollup lock is held. Money needs no script (the money job fills it).

1. Cards created: per router, keyset pages of 5,000 on `idx_voucher_meta_router_keyset`, **only cards created
   before migration 045 was applied**, written as `backfill` batches (surviving cards only).
2. First use: the ingest function from the first session of the start date
   (`SELECT radacctid FROM radacct WHERE acctstarttime >= $1 ORDER BY acctstarttime LIMIT 1`, minus 1,000)
   up to the seeded cursor.
3. Usage days since the start date, hour by hour. 4. Card and uptime days rebuilt from facts.

Cannot be recovered: router outages and last-active before launch, payments of operators already deleted,
cards deleted before launch.

### 5.6 API — all under the existing admin guard (`backend/src/routes/admin.routes.ts:26`)

New `backend/src/controllers/analytics.controller.ts`, `backend/src/services/analytics.service.ts`; Zod
schemas in `backend/src/validators/admin.validators.ts`. Query: `period=month|30d|3m|12m` or `from`/`to`
(inclusive Khartoum days, span ≤ 400 days); the server resolves the range and the previous equal period
(`3m`/`12m` = current Khartoum month to date plus the 2/11 full months before). A tab that does not offer
the requested preset falls back to its own first preset.
Every response carries `meta {timezone, range, previous, refreshedAt, stale, usageHistoryStart,
routerHistoryStart, cardHistoryComplete}`. Days and months are returned as `to_char` text, sums cast to
numbers, at most 3 queries in parallel (pool max 10).

| Endpoint | Feeds | Reads |
|---|---|---|
| `GET /admin/analytics/money` | Money tab: `cards`, `income {total, fromDeletedOperators}`, `incomeByMonth`, `incomeByPlan`, `renewalRate`, `renewalsDue`, `lost` | `income_ledger`, `subscriptions`, `plans`, `payments`, `users` |
| `GET /admin/analytics/operators` | Operators tab: `cards`, `rows[]` with server-set `flags {isQuiet, nearLimit, notStarted}` | `users`, `subscriptions`, `plans`, `routers`, `analytics_card_daily`, `operator_activity` |
| `GET /admin/analytics/operators/:id` | Operator page: `daily[]`, `routers[]`, `payments[]` (all statuses, live), `totalPaid` | summaries by `idx_acd_user_day`, `analytics_uptime_daily`, `payments`, ledger |
| `GET /admin/analytics/network` | Network tab: `cards`, `daily[]`, `hours[]`, `cardTypes`, `routers[]` with `flags {dropping, offlineNow}`, `monitorStale` | the summary tables, `routers`, `users` |

CSV exports (same period plus `q`, `filter`, `sort`, `dir`; registered before `/operators/:id`; same row
builder as the screen; `toCsv` from `backend/src/utils/csv.ts:87`; audit-logged; 10,000-row cap):
`/admin/analytics/money/renewals-due/export`, `/money/lost/export`, `/operators/export`,
`/network/routers/export`. `sendCsv` (`backend/src/controllers/admin.controller.ts:55`) is exported for reuse.
`exportPayments` (`admin.controller.ts:119-134`) gains an "Approved at" column.

### 5.7 Definitions

**Money**
- Income: sum of ledger `amount` by Khartoum day of `approved_at`. Income from deleted operators is included
  and also shown as its own line, so the total can be reconciled with the Payments page.
- Paying operators: distinct users with `status='active' AND end_date > NOW()` whose subscription has a
  ledger row; the rest of the truly-active ones are "+N granted".
- Due to renew: truly-active subscriptions ending within 30 days; amount = `plans.price × duration_months`
  read from `plans`; a tier with no plan row uses the operator's last ledger amount and is marked estimated.
  Granted (unpaid) subscriptions are listed with a "granted" tag and add nothing to the amount.
- Paid but never switched on: subscriptions still `pending` whose paired payment (same user, same
  `created_at`) is `approved`. Shown as a notice when the count is above zero.
- Payments waiting: `status='pending' AND receipt_url IS NOT NULL` (same as `admin.service.ts:889`); age from
  `payments.updated_at` (a re-upload resets it).
- Income by plan: grouped by `plan_tier`, labelled with the current plan name, else the snapshot; when two
  slices share a name the tier key is shown too.
- Renewal rate for month M: of paid periods whose end falls in M and is not in the future (live `end_date`
  while the subscription exists, else `period_end`; periods replaced earlier by a plan change excluded), the
  share whose operator has a ledger row approved within 30 days after the end. Provisional until 30 days
  after the month closes.
- Operators lost: latest paid period ended in the range, no later ledger row, no truly-active subscription,
  and no payment that is `pending` with a receipt. Months paid = `SUM(COALESCE(duration_months,1))`.

**Operators**
- Total = users with `role='user'` (as the dashboard, `admin.service.ts:886`). Active = cards used > 0.
- Cards created: counted at creation, so later deletion never lowers it.
- Cards used: cards whose first session (lowest `radacctid`) started in the period, credited to the card's
  own router and owner, frozen at first use.
- Sales value: `SUM(price × cards_used)`; cards with no price count as used, add nothing, reported as `unpricedUsed`.
- Change: used versus the previous equal period; empty when the previous is 0 or predates the usage start.
- Going quiet: previous ≥ `ANALYTICS_QUIET_MIN_BASE` and used ≤ half of it.
- Near card limit: truly-active subscription with `voucher_quota > 0 AND vouchers_used >= 0.8 × voucher_quota`
  (limits come from the subscription row; `-1` unlimited and `0` never flag).
- Not started: no router, or no card on record — and no ledger row, no first-use row, `vouchers_used = 0`.
- Last active: 15-minute resolution (token refresh); empty until the operator's first login after launch.

**Network**
- Online now / Now: live `routers.status`; when the monitor heartbeat is older than 3 minutes the tab shows
  "status unknown" instead (a failed `wg show` marks every router offline in `routers.status`).
- Uptime %: up seconds ÷ observed seconds **within the selected period**, across the routers being tracked
  (a router is tracked from the first time it is seen online after launch); never-connected and
  not-seen-since-launch routers are counted separately. The headline card and the per-router column use the
  same period, so they change together with the picker.
- Drop: an outage confirmed after 180 s, counted on its start day. Keep dropping: ≥ 5 in the last 7 days.
- Sessions, data, busiest hours: by session start, in Khartoum time. Sessions with no matching router stay
  in platform totals only.
- Card types: cards used, by price and by `limit_type`.

### 5.8 Existing behaviour that changes

- **Dashboard "Active subscriptions" drops to the true number.** `getStats` (`admin.service.ts:887`) groups by
  `CASE WHEN status='active' AND end_date <= NOW() THEN 'expired' ELSE status END`; the hourly job also
  flips the rows. `metrics_daily` is right from the next snapshot, so the old trend shows one step down.
- `quotaMonitor` stops warning lapsed operators; lapsed operators stop getting a false "already active"
  409 when they try to subscribe again. Expiry notifications are unchanged.
- Payments page: new "Approved" column in the table and CSV.
- **Dashboard revenue reads the ledger.** `getStats` total revenue (`admin.service.ts:891`) becomes
  `SUM(amount) FROM income_ledger`; the revenue subquery of `getStatsTimeseries` (`:1354-1360`) becomes a
  date-bounded read of `income_ledger` bucketed by Khartoum day. Update `backend/src/tests/statsTimeseries.test.ts`.
  The money job's run at boot fills the ledger before the first dashboard load.
- **Payment-approval bug fix (theirs).** Today `reviewPayment` (`admin.service.ts:765-817`) activates the
  operator's newest `pending_change` row whichever payment is approved; a rejection leaves that row behind
  and `requestSubscription` (`subscription.service.ts:227-240`) does not block on it, so a later payment can
  switch on an old rejected plan change and leave the paid request `pending` forever. New rule, inside the
  same transaction:
  1. Find the subscription created with this payment, matching **in SQL** (never through a JS `Date`,
     which drops microseconds): `SELECT s.id, s.status, s.previous_subscription_id FROM subscriptions s
     JOIN payments p ON p.user_id = s.user_id AND p.created_at = s.created_at WHERE p.id = $1 AND s.status IN
     ('pending','pending_change') FOR UPDATE OF s`.
  2. If found, activate that row (same `start_date` / `end_date` rule as today). For a plan change, cancel
     `previous_subscription_id` as today **and** any other `active` subscription of that operator (my call:
     prevents two active subscriptions when the recorded previous one is no longer the live one).
  3. If not found (legacy rows), fall back to today's behaviour unchanged.
  4. Pass the activated id to `recordIncome`.
  Operators already affected are not repaired automatically; the Money tab notice (decision 16) lists them.

### 5.9 Frontend (`admin/src`)

- Routes: `/analytics` → `/analytics/money`; `/analytics/:tab` renders `AnalyticsPage` inside the protected
  block (`App.tsx:70-84`). Nav item after Dashboard (`lib/nav.ts:29-43`) plus a prefix title rule (`:60-61`).
  Period lives in the query string and survives tab switches.
- New: `pages/AnalyticsPage.tsx`; `components/analytics/{MoneyTab,OperatorsTab,NetworkTab,PeriodPicker,
  FilterChips,RefreshedStamp,OperatorAnalyticsSection}.tsx`; `components/charts/{BarChart,LineChart,ShareBars,
  HeatGrid,chartCore}.tsx`; `lib/{analytics,period,format,tableSort}.ts`; `tests/analyticsFixtures.ts`.
- Changed: `App.tsx`, `lib/nav.ts`, `components/DataTable.tsx` (optional sort, `rowKey`, `emptyMessage`,
  `align`; pagination props stay required), `components/StatCard.tsx` (`sub`, `delta`), `lib/datetime.ts`,
  `pages/UserDetailPage.tsx`, `pages/PaymentsPage.tsx` (Approved column; also invalidates the money query),
  `pages/DashboardPage.tsx` (shared `formatRelative`).
- Charts: shapes in a stretched SVG, all text in HTML positioned by percentage (as
  `components/charts/TrendChart.tsx:28-36`); shared axis ticks, legend, hover tooltip and hidden data table in
  `chartCore`. Series colours blue / violet / slate (green, amber, red already mean status). **Load the
  `dataviz` skill before writing any chart code.**
- Tables: sort, search and chips run in the browser on server-set flags; exports go to the server.
- States: skeletons; previous data dimmed during a period change; `ErrorPanel` with retry; same-height empty
  blocks; Money stamped "Live", other tabs "Figures as of …" (amber when stale); provisional months drawn
  lighter; a notice while router history is young; footnote that days are Khartoum time.
- Operator page: `OperatorAnalyticsSection` after the Routers card (`UserDetailPage.tsx:257`) with its own
  query and its own period picker (default 30 days), so a failure never blocks existing actions; Uptime and
  Drops merged into the existing routers table; `formatQuota` fixes the raw "-1" (`:186`).
- One request per tab; keys `['admin','analytics',tab,periodKey]`.

## 6. Known limits to tell the owner

- Router uptime, drops and "last active" start empty and fill from launch day.
- Cards-created history before launch covers only cards that still exist; cards deleted earlier are gone.
- Cards used, sales value, sessions and busiest hours start on 2026-10-20.
- Past income of operators deleted **before** launch cannot be recovered; from launch on it is kept.
- An outage shorter than about 5 minutes is not counted as a drop.
- "Data used per day" is counted on the day a session started; very long sessions are attributed to their
  start day.
- "Change" and "Going quiet" compare with the previous period, so they stay empty until two full periods
  of use history exist (for the 30-day view: from about 19 December 2026).
