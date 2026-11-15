/**
 * Analytics service — reads only the analytics summary tables and small live tables.
 * No SQL in this file may mention radacct, voucher_meta, or radpostauth.
 */
import { pool } from '../config/database';
import { config } from '../config';
import { AppError } from '../middleware/errorHandler';
// getAnalyticsState is no longer called directly in this file; buildMeta uses pool.query directly.
import { addDays, resolvePeriod } from './analyticsPeriod';
import type {
  ResolvedPeriod,
  MoneyAnalytics,
  OperatorsAnalytics,
  OperatorAnalytics,
  NetworkAnalytics,
  AnalyticsMeta,
  OperatorRow,
  RouterRow,
  RenewalDueRow,
  LostOperatorRow,
} from './analytics.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

/** Returns true when the previous comparison period started before the analytics history. */
function isPrevPeriodAvailable(p: ResolvedPeriod): boolean {
  return p.previousFrom >= config.ANALYTICS_USAGE_START_DATE;
}

/**
 * Build an ordered array of YYYY-MM strings covering every calendar month that
 * intersects the range [from, to] (inclusive, YYYY-MM-DD).
 */
function monthSpine(from: string, to: string): string[] {
  const months: string[] = [];
  // Start from the first month of `from`
  let y = parseInt(from.slice(0, 4), 10);
  let m = parseInt(from.slice(5, 7), 10);
  const endMonth = to.slice(0, 7); // YYYY-MM
  while (true) {
    const label = `${y}-${String(m).padStart(2, '0')}`;
    months.push(label);
    if (label >= endMonth) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

/**
 * Returns true when a YYYY-MM month is provisional (not yet 30 days after it closed).
 * A month closes on the first day of the next month; it is provisional until
 * (firstDayOfNextMonth + 30 days) > now.
 */
function isMonthProvisional(yyyyMm: string, now: Date): boolean {
  const [y, m] = yyyyMm.split('-').map(Number);
  const nextMonthMs = Date.UTC(y, m /* 0-based next month = m */, 1); // first day of next month
  const provisionalUntil = nextMonthMs + 30 * 86_400_000;
  return provisionalUntil > now.getTime();
}

async function buildMeta(
  p: ResolvedPeriod,
  overrides?: { refreshedAt?: string | null; stale?: boolean },
): Promise<{ meta: AnalyticsMeta; heartbeat: string | null }> {
  // One query for all analytics_state keys we need.
  const stateRes = await pool.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM analytics_state WHERE key = ANY($1::text[])`,
    [['rollup_last_ok', 'monitor_heartbeat', 'backfill_cards_done']],
  );
  const stateMap = new Map(stateRes.rows.map((r) => [r.key, r.value]));
  const rollupOk = stateMap.get('rollup_last_ok') ?? null;
  const heartbeat = stateMap.get('monitor_heartbeat') ?? null;
  const backfillDone = stateMap.get('backfill_cards_done') ?? null;

  const routerHistoryRow = await pool.query<{ day: string | null }>(
    `SELECT to_char(MIN(tracked_since), 'YYYY-MM-DD') AS day FROM router_uptime_state`,
  );

  const isStale = overrides?.stale !== undefined
    ? overrides.stale
    : rollupOk === null || (Date.now() - new Date(rollupOk).getTime() > 270 * 60 * 1000);

  const meta: AnalyticsMeta = {
    timezone: config.ANALYTICS_TZ,
    period: p.period,
    range: { from: p.from, to: p.to },
    previous: { from: p.previousFrom, to: p.previousTo },
    refreshedAt: overrides?.refreshedAt !== undefined ? overrides.refreshedAt : rollupOk,
    stale: isStale,
    usageHistoryStart: config.ANALYTICS_USAGE_START_DATE,
    routerHistoryStart: routerHistoryRow.rows[0]?.day ?? null,
    cardHistoryComplete: backfillDone === 'true',
  };
  return { meta, heartbeat };
}

// ---------------------------------------------------------------------------
// Money analytics
// ---------------------------------------------------------------------------

export async function getMoneyAnalytics(
  p: ResolvedPeriod,
): Promise<{ data: MoneyAnalytics; meta: AnalyticsMeta }> {
  const tz = config.ANALYTICS_TZ;

  // Compute both "this month" and "same days last month" ranges in the configured
  // timezone so month boundaries are consistent on both sides.
  const monthPeriod = resolvePeriod({ period: 'month' }, 'money', new Date(), tz);

  // Batch 1: meta (2 sequential queries internally) — await before firing data queries.
  const { meta: metaResult } = await buildMeta(p, {
    refreshedAt: new Date().toISOString(),
    stale: false,
  });

  // Batch 2: moneyCards + incomeAgg (≤3 in flight)
  const [moneyCards, incomeAgg] = await Promise.all([
    // Cards section: income this month, same days last month, paying/granted
    pool.query<{
      income_this_month: string;
      income_prev_month: string;
      paying_operators: string;
      granted_operators: string;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN (approved_at AT TIME ZONE $5)::date >= $3::date
                                AND (approved_at AT TIME ZONE $5)::date <= $4::date
                            THEN amount END), 0) AS income_this_month,
         COALESCE(SUM(CASE WHEN (approved_at AT TIME ZONE $5)::date >= $1::date
                                AND (approved_at AT TIME ZONE $5)::date <= $2::date
                            THEN amount END), 0) AS income_prev_month,
         (SELECT COUNT(DISTINCT s.user_id) FROM subscriptions s
           WHERE s.status = 'active' AND s.end_date > NOW()
             AND EXISTS (SELECT 1 FROM income_ledger il WHERE il.subscription_id = s.id)) AS paying_operators,
         (SELECT COUNT(*) FROM subscriptions s2
           WHERE s2.status = 'active' AND s2.end_date > NOW()
             AND NOT EXISTS (SELECT 1 FROM income_ledger il2 WHERE il2.subscription_id = s2.id)) AS granted_operators
       FROM income_ledger`,
      [
        monthPeriod.previousFrom,
        monthPeriod.previousTo,
        monthPeriod.from,
        monthPeriod.to,
        tz,
      ],
    ),
    // Income total and from deleted operators
    pool.query<{ total: string; from_deleted: string }>(
      `SELECT
         COALESCE(SUM(amount), 0) AS total,
         COALESCE(SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM users u WHERE u.id = il.user_id) THEN amount END), 0) AS from_deleted
       FROM income_ledger il
       WHERE (approved_at AT TIME ZONE $1)::date >= $2::date AND (approved_at AT TIME ZONE $1)::date <= $3::date`,
      [tz, p.from, p.to],
    ),
  ]);

  // Batch 3: by month, by plan, renewal rate
  const [byMonthRows, byPlanRows, renewalRateRows] = await Promise.all([
    pool.query<{ month: string; new: string; renewal: string; plan_change: string }>(
      `SELECT to_char(approved_at AT TIME ZONE $1, 'YYYY-MM') AS month,
              COALESCE(SUM(CASE WHEN kind = 'new' THEN amount END), 0) AS "new",
              COALESCE(SUM(CASE WHEN kind = 'renewal' THEN amount END), 0) AS renewal,
              COALESCE(SUM(CASE WHEN kind = 'plan_change' THEN amount END), 0) AS plan_change
         FROM income_ledger
        WHERE (approved_at AT TIME ZONE $1)::date >= $2::date AND (approved_at AT TIME ZONE $1)::date <= $3::date
        GROUP BY 1 ORDER BY 1`,
      [tz, p.from, p.to],
    ),
    pool.query<{ plan_tier: string; plan_name: string; amount: string; share_pct: string | null }>(
      `WITH totals AS (
         SELECT plan_tier, COALESCE(pl.name, il.plan_tier) AS plan_name, COALESCE(SUM(il.amount), 0) AS amount
           FROM income_ledger il LEFT JOIN plans pl ON pl.tier = il.plan_tier
          WHERE (il.approved_at AT TIME ZONE $1)::date >= $2::date AND (il.approved_at AT TIME ZONE $1)::date <= $3::date
          GROUP BY il.plan_tier, pl.name
       ), grand AS (SELECT SUM(amount) AS total FROM totals)
       SELECT t.plan_tier, t.plan_name, t.amount,
              CASE WHEN g.total > 0 THEN ROUND(t.amount / g.total * 100, 2) END AS share_pct
         FROM totals t, grand g ORDER BY t.amount DESC`,
      [tz, p.from, p.to],
    ),
    pool.query<{ month: string; ended: string; renewed: string; provisional: boolean }>(
      `WITH periods AS (
         SELECT il.user_id,
                to_char(COALESCE(s.end_date, il.period_end) AT TIME ZONE $1, 'YYYY-MM') AS month,
                COALESCE(s.end_date, il.period_end) AS ends_at
           FROM income_ledger il
           LEFT JOIN subscriptions s ON s.id = il.subscription_id AND s.status NOT IN ('cancelled')
          WHERE il.replaces_subscription_id IS NULL   -- exclude plan-change rows themselves
            AND NOT EXISTS (
              SELECT 1 FROM income_ledger pc
              WHERE pc.replaces_subscription_id = il.subscription_id
                AND il.subscription_id IS NOT NULL
                AND pc.approved_at < COALESCE(s.end_date, il.period_end)
            )
       ), monthly AS (
         SELECT month,
                COUNT(*) AS ended,
                COUNT(CASE WHEN EXISTS (
                  SELECT 1 FROM income_ledger r WHERE r.user_id = p.user_id
                    AND r.approved_at > p.ends_at AND r.approved_at <= p.ends_at + INTERVAL '30 days'
                ) THEN 1 END) AS renewed,
                (to_date(month || '-01', 'YYYY-MM-DD') + INTERVAL '1 month' + INTERVAL '30 days') > NOW() AS provisional
           FROM periods p
          WHERE to_date(month || '-01', 'YYYY-MM-DD') >= $2::date
            AND to_date(month || '-01', 'YYYY-MM-DD') <= $3::date + INTERVAL '1 month'
            AND p.ends_at <= NOW()
          GROUP BY month, provisional
       )
       SELECT month, ended, renewed, provisional FROM monthly ORDER BY month`,
      [tz, p.from, p.to],
    ),
  ]);

  // Batch 4: renewals due, lost, waiting (≤3 in flight)
  const [renewalsDueRows, lostRows, waitingRow] = await Promise.all([
    pool.query<{
      user_id: string; operator: string; email: string | null; plan_tier: string; plan_name: string;
      ends_at: string; amount: string | null; estimated: boolean; granted: boolean; paid_before: string;
    }>(
      `SELECT s.user_id, u.name AS operator, u.email,
              s.plan_tier,
              COALESCE(pl.name, s.plan_tier) AS plan_name,
              to_char(s.end_date, 'YYYY-MM-DD') AS ends_at,
              CASE WHEN EXISTS (SELECT 1 FROM income_ledger il WHERE il.user_id = s.user_id)
                   THEN COALESCE(pl.price * s.duration_months, (SELECT il.amount FROM income_ledger il WHERE il.user_id = s.user_id ORDER BY il.approved_at DESC LIMIT 1)) END AS amount,
              pl.price IS NULL AS estimated,
              NOT EXISTS (SELECT 1 FROM income_ledger il2 WHERE il2.subscription_id = s.id) AS granted,
              COALESCE((SELECT COUNT(*) FROM income_ledger il3 WHERE il3.user_id = s.user_id), 0) AS paid_before
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN plans pl ON pl.tier = s.plan_tier
        WHERE s.status = 'active' AND s.end_date > NOW() AND s.end_date <= NOW() + INTERVAL '30 days'
        ORDER BY s.end_date ASC`,
      [],
    ),
    pool.query<{
      user_id: string; operator: string; email: string | null; deleted: boolean;
      plan_tier: string; plan_name: string; ended_at: string; months_paid: string; total_paid: string;
    }>(
      `WITH last_period AS (
         SELECT DISTINCT ON (il.user_id)
                il.user_id,
                COALESCE(s.end_date, il.period_end) AS ended_at,
                il.plan_tier,
                COALESCE(pl.name, il.plan_tier) AS plan_name
           FROM income_ledger il
           LEFT JOIN subscriptions s ON s.id = il.subscription_id
           LEFT JOIN plans pl ON pl.tier = il.plan_tier
          WHERE (COALESCE(s.end_date, il.period_end) AT TIME ZONE $1)::date >= $2::date
            AND (COALESCE(s.end_date, il.period_end) AT TIME ZONE $1)::date <= $3::date
          ORDER BY il.user_id, COALESCE(s.end_date, il.period_end) DESC
       )
       SELECT lp.user_id, COALESCE(u.name, il2.operator_name, '(deleted)') AS operator,
              COALESCE(u.email, il2.operator_email) AS email,
              u.id IS NULL AS deleted,
              lp.plan_tier, lp.plan_name,
              to_char(lp.ended_at, 'YYYY-MM-DD') AS ended_at,
              COALESCE(SUM(COALESCE(il2.duration_months, 1)), 0) AS months_paid,
              COALESCE(SUM(il2.amount), 0) AS total_paid
         FROM last_period lp
         LEFT JOIN users u ON u.id = lp.user_id
         JOIN income_ledger il2 ON il2.user_id = lp.user_id
        WHERE NOT EXISTS (SELECT 1 FROM income_ledger il3 WHERE il3.user_id = lp.user_id AND il3.approved_at > lp.ended_at)
          AND NOT EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.user_id = lp.user_id AND s2.status = 'active' AND s2.end_date > NOW())
          AND NOT EXISTS (SELECT 1 FROM payments p2 WHERE p2.user_id = lp.user_id AND p2.status = 'pending' AND p2.receipt_url IS NOT NULL)
        GROUP BY lp.user_id, u.name, u.email, u.id, lp.plan_tier, lp.plan_name, lp.ended_at, il2.operator_name, il2.operator_email
        ORDER BY lp.ended_at DESC`,
      [tz, p.from, p.to],
    ),
    pool.query<{ count: string; amount: string; oldest_since: string | null }>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount,
              to_char(MIN(updated_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS oldest_since
         FROM payments WHERE status = 'pending' AND receipt_url IS NOT NULL`,
      [],
    ),
  ]);

  // Batch 5: paidNotActivated (1 query)
  const paidNotActivatedRows = await pool.query<{
    user_id: string; operator: string; plan_name: string; amount: string; approved_at: string;
  }>(
    `SELECT DISTINCT ON (p.id)
            p.user_id, COALESCE(u.name, '(deleted)') AS operator,
            COALESCE(pl.name, p.plan_tier) AS plan_name, p.amount,
            to_char(p.reviewed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS approved_at
       FROM payments p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN plans pl ON pl.tier = p.plan_tier
       JOIN subscriptions s ON s.user_id = p.user_id AND s.created_at = p.created_at
      WHERE p.status = 'approved' AND s.status IN ('pending', 'pending_change')
      ORDER BY p.id, p.reviewed_at DESC`,
    [],
  );

  const totalIncome = num(incomeAgg.rows[0]?.total);

  const data: MoneyAnalytics = {
    cards: {
      incomeThisMonth: num(moneyCards.rows[0]?.income_this_month),
      incomeSameDaysLastMonth: num(moneyCards.rows[0]?.income_prev_month),
      changePct: pct(
        num(moneyCards.rows[0]?.income_this_month) - num(moneyCards.rows[0]?.income_prev_month),
        num(moneyCards.rows[0]?.income_prev_month),
      ),
      payingOperators: num(moneyCards.rows[0]?.paying_operators),
      grantedOperators: num(moneyCards.rows[0]?.granted_operators),
      dueToRenew: {
        amount: renewalsDueRows.rows.reduce((s, r) => s + (r.granted ? 0 : num(r.amount)), 0),
        operators: renewalsDueRows.rows.filter((r) => !r.granted).length,
        estimated: renewalsDueRows.rows.some((r) => r.estimated && !r.granted),
      },
      waiting: {
        count: num(waitingRow.rows[0]?.count),
        amount: num(waitingRow.rows[0]?.amount),
        oldestSince: waitingRow.rows[0]?.oldest_since ?? null,
      },
    },
    income: {
      total: totalIncome,
      fromDeletedOperators: num(incomeAgg.rows[0]?.from_deleted),
    },
    incomeByMonth: (() => {
      const spine = monthSpine(p.from, p.to);
      const byMonthMap = new Map(byMonthRows.rows.map((r) => [r.month, r]));
      return spine.map((month) => {
        const r = byMonthMap.get(month);
        return {
          month,
          new: r ? num(r.new) : 0,
          renewal: r ? num(r.renewal) : 0,
          planChange: r ? num(r.plan_change) : 0,
        };
      });
    })(),
    incomeByPlan: byPlanRows.rows.map((r) => ({
      planTier: r.plan_tier,
      planName: r.plan_name,
      amount: num(r.amount),
      sharePct: r.share_pct !== null ? num(r.share_pct) : null,
    })),
    renewalRate: (() => {
      const spine = monthSpine(p.from, p.to);
      const now = new Date();
      const byRateMap = new Map(renewalRateRows.rows.map((r) => [r.month, r]));
      return spine.map((month) => {
        const r = byRateMap.get(month);
        const provisional = isMonthProvisional(month, now);
        if (r) {
          return {
            month,
            ended: num(r.ended),
            renewed: num(r.renewed),
            ratePct: num(r.ended) > 0 ? pct(num(r.renewed), num(r.ended)) : null,
            provisional,
          };
        }
        return { month, ended: 0, renewed: 0, ratePct: null, provisional };
      });
    })(),
    renewalsDue: renewalsDueRows.rows.map((r): RenewalDueRow => ({
      userId: r.user_id,
      operator: r.operator,
      email: r.email,
      planTier: r.plan_tier,
      planName: r.plan_name,
      endsAt: r.ends_at,
      amount: r.granted ? null : (r.amount !== null ? num(r.amount) : null),
      estimated: r.estimated,
      granted: r.granted,
      paidBefore: num(r.paid_before),
    })),
    lost: lostRows.rows.map((r): LostOperatorRow => ({
      userId: r.user_id,
      operator: r.operator,
      email: r.email,
      deleted: r.deleted,
      planTier: r.plan_tier,
      planName: r.plan_name,
      endedAt: r.ended_at,
      monthsPaid: num(r.months_paid),
      totalPaid: num(r.total_paid),
    })),
    paidNotActivated: paidNotActivatedRows.rows.map((r) => ({
      userId: r.user_id,
      operator: r.operator,
      planName: r.plan_name,
      amount: num(r.amount),
      approvedAt: r.approved_at,
    })),
  };

  return { data, meta: metaResult };
}

// ---------------------------------------------------------------------------
// Operators analytics
// ---------------------------------------------------------------------------

export async function getOperatorsAnalytics(
  p: ResolvedPeriod,
): Promise<{ data: OperatorsAnalytics; meta: AnalyticsMeta }> {
  const tz = config.ANALYTICS_TZ;
  const quietBase = config.ANALYTICS_QUIET_MIN_BASE;

  const { meta: metaResult } = await buildMeta(p);

  const [usersRows, cardRows, prevCardRows] = await Promise.all([
    pool.query<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE role = 'user' ORDER BY name`,
      [],
    ),
    pool.query<{ user_id: string; cards_created: string; cards_used: string; sales_value: string }>(
      `SELECT user_id,
              COALESCE(SUM(cards_created), 0) AS cards_created,
              COALESCE(SUM(cards_used), 0) AS cards_used,
              COALESCE(SUM(price * cards_used), 0) AS sales_value
         FROM analytics_card_daily
        WHERE day >= $1::date AND day <= $2::date
        GROUP BY user_id`,
      [p.from, p.to],
    ),
    pool.query<{ user_id: string; cards_used: string }>(
      `SELECT user_id, COALESCE(SUM(cards_used), 0) AS cards_used
         FROM analytics_card_daily
        WHERE day >= $1::date AND day <= $2::date
        GROUP BY user_id`,
      [p.previousFrom, p.previousTo],
    ),
  ]);

  const [routerRows, activityRows, subRows] = await Promise.all([
    pool.query<{ user_id: string; online: string; total: string }>(
      `SELECT user_id,
              COUNT(CASE WHEN status = 'online' THEN 1 END) AS online,
              COUNT(*) AS total
         FROM routers GROUP BY user_id`,
      [],
    ),
    pool.query<{ user_id: string; last_active_at: string }>(
      `SELECT user_id, to_char(last_active_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_active_at FROM operator_activity`,
      [],
    ),
    pool.query<{
      user_id: string; plan_tier: string; plan_name: string | null;
      end_date: string; voucher_quota: string; vouchers_used: string;
    }>(
      `SELECT s.user_id, s.plan_tier, pl.name AS plan_name,
              to_char(s.end_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_date,
              s.voucher_quota, s.vouchers_used
         FROM subscriptions s
         LEFT JOIN plans pl ON pl.tier = s.plan_tier
        WHERE s.status = 'active' AND s.end_date > NOW()`,
      [],
    ),
  ]);

  const [ledgerRows, firstUseRows] = await Promise.all([
    pool.query<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM income_ledger`,
      [],
    ),
    pool.query<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM analytics_card_first_use`,
      [],
    ),
  ]);

  // Index maps for O(1) lookups
  const cardMap = new Map(cardRows.rows.map((r) => [r.user_id, r]));
  const prevCardMap = new Map(prevCardRows.rows.map((r) => [r.user_id, r]));
  const routerMap = new Map(routerRows.rows.map((r) => [r.user_id, r]));
  const activityMap = new Map(activityRows.rows.map((r) => [r.user_id, r.last_active_at]));
  const subMap = new Map(subRows.rows.map((r) => [r.user_id, r]));

  const ledgerSet = new Set(ledgerRows.rows.map((r) => r.user_id));
  const firstUseSet = new Set(firstUseRows.rows.map((r) => r.user_id));

  const rows: OperatorRow[] = usersRows.rows.map((u) => {
    const card = cardMap.get(u.id);
    const prevCard = prevCardMap.get(u.id);
    const router = routerMap.get(u.id);
    const sub = subMap.get(u.id);

    const cardsUsed = num(card?.cards_used);
    const prevUsed = num(prevCard?.cards_used);
    const routersOnline = num(router?.online);
    const routersTotal = num(router?.total);
    const daysLeft = sub
      ? Math.max(0, Math.round((new Date(sub.end_date).getTime() - Date.now()) / 86_400_000))
      : null;

    const prevAvail = isPrevPeriodAvailable(p);

    const changePct =
      prevUsed >= 1 && prevAvail
        ? pct(cardsUsed - prevUsed, prevUsed)
        : null;

    const isQuiet =
      prevUsed >= quietBase &&
      cardsUsed <= prevUsed / 2 &&
      prevAvail;

    const quota = num(sub?.voucher_quota);
    const used = num(sub?.vouchers_used);
    const nearLimit = quota > 0 && used >= quota * 0.8;

    const noRouter = routersTotal === 0;
    const noCards = num(card?.cards_created) === 0;
    const notStarted =
      (noRouter || noCards) &&
      !ledgerSet.has(u.id) &&
      !firstUseSet.has(u.id) &&
      used === 0;

    return {
      userId: u.id,
      operator: u.name,
      email: u.email,
      planTier: sub?.plan_tier ?? null,
      planName: sub?.plan_name ?? null,
      daysLeft,
      routersOnline,
      routersTotal,
      cardsCreated: num(card?.cards_created),
      cardsUsed,
      salesValue: num(card?.sales_value),
      changePct,
      lastActiveAt: activityMap.get(u.id) ?? null,
      flags: { isQuiet, nearLimit, notStarted },
    };
  });

  const active = rows.filter((r) => r.cardsUsed > 0).length;
  const quiet = rows.filter((r) => r.flags.isQuiet).length;
  const nearLimit = rows.filter((r) => r.flags.nearLimit).length;
  const notStarted = rows.filter((r) => r.flags.notStarted).length;

  return {
    data: {
      cards: { active, total: rows.length, quiet, nearLimit, notStarted },
      rows,
    },
    meta: metaResult,
  };
}

// ---------------------------------------------------------------------------
// Single operator analytics
// ---------------------------------------------------------------------------

export async function getOperatorAnalytics(
  userId: string,
  p: ResolvedPeriod,
): Promise<{ data: OperatorAnalytics; meta: AnalyticsMeta }> {
  // Verify the user exists and is role='user'
  const userCheck = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1 AND role = 'user'`,
    [userId],
  );
  if (!userCheck.rows.length) {
    throw new AppError(404, 'Operator not found', 'USER_NOT_FOUND');
  }

  const { meta: metaResult } = await buildMeta(p);

  const [dailyRows, routerRows, paymentRows] = await Promise.all([
    pool.query<{ day: string; cards_created: string; cards_used: string; sales_value: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(cards_created), 0) AS cards_created,
              COALESCE(SUM(cards_used), 0) AS cards_used,
              COALESCE(SUM(price * cards_used), 0) AS sales_value
         FROM analytics_card_daily
        WHERE user_id = $1 AND day >= $2::date AND day <= $3::date
        GROUP BY day ORDER BY day`,
      [userId, p.from, p.to],
    ),
    pool.query<{
      router_id: string; observed_seconds: string; down_seconds: string; drops: string; longest_outage_seconds: string;
    }>(
      `SELECT router_id,
              COALESCE(SUM(observed_seconds), 0) AS observed_seconds,
              COALESCE(SUM(down_seconds), 0) AS down_seconds,
              COALESCE(SUM(drops), 0) AS drops,
              MAX(longest_outage_seconds) AS longest_outage_seconds
         FROM analytics_uptime_daily
        WHERE user_id = $1 AND day >= $2::date AND day <= $3::date
        GROUP BY router_id`,
      [userId, p.from, p.to],
    ),
    pool.query<{
      id: string; plan_tier: string; amount: string; status: string;
      created_at: string; reviewed_at: string | null;
    }>(
      `SELECT id, plan_tier, amount, status,
              to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
              to_char(reviewed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS reviewed_at
         FROM payments WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    ),
  ]);

  const totalPaidRow = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM income_ledger WHERE user_id = $1`,
    [userId],
  );

  // Generate day spine so every day appears
  const daySpine: string[] = [];
  let cur = p.from;
  while (cur <= p.to) {
    daySpine.push(cur);
    cur = addDays(cur, 1);
  }
  const dailyMap = new Map(dailyRows.rows.map((r) => [r.day, r]));

  return {
    data: {
      daily: daySpine.map((day) => {
        const r = dailyMap.get(day);
        return {
          day,
          cardsCreated: num(r?.cards_created),
          cardsUsed: num(r?.cards_used),
          salesValue: num(r?.sales_value),
        };
      }),
      routers: routerRows.rows.map((r) => ({
        routerId: r.router_id,
        uptimePct: num(r.observed_seconds) > 0
          ? pct(num(r.observed_seconds) - num(r.down_seconds), num(r.observed_seconds))
          : null,
        drops: num(r.drops),
        longestOutageSec: num(r.longest_outage_seconds),
      })),
      payments: paymentRows.rows.map((r) => ({
        id: r.id,
        planTier: r.plan_tier,
        amount: num(r.amount),
        status: r.status,
        createdAt: r.created_at,
        reviewedAt: r.reviewed_at,
      })),
      totalPaid: num(totalPaidRow.rows[0]?.total),
    },
    meta: metaResult,
  };
}

// ---------------------------------------------------------------------------
// Network analytics
// ---------------------------------------------------------------------------

export async function getNetworkAnalytics(
  p: ResolvedPeriod,
): Promise<{ data: NetworkAnalytics; meta: AnalyticsMeta }> {
  const tz = config.ANALYTICS_TZ;

  const { meta: metaResult, heartbeat: heartbeatStr } = await buildMeta(p);

  const routerLiveRows = await pool.query<{
    id: string; name: string; user_id: string; user_name: string;
    tunnel_ip: string | null; status: string; last_seen: string | null;
  }>(
    `SELECT r.id, r.name, r.user_id, u.name AS user_name, r.tunnel_ip, r.status,
            to_char(r.last_seen, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen
       FROM routers r JOIN users u ON u.id = r.user_id`,
    [],
  );

  const heartbeat = heartbeatStr ? new Date(heartbeatStr) : null;
  const monitorStale = !heartbeat || (Date.now() - heartbeat.getTime() > 3 * 60 * 1000);

  const [dailyRows, hourlyRows, uptimeRows] = await Promise.all([
    pool.query<{ day: string; cards_created: string; cards_used: string; data_bytes: string }>(
      `WITH card_daily AS (
         SELECT day, COALESCE(SUM(cards_created), 0) AS cards_created, COALESCE(SUM(cards_used), 0) AS cards_used
           FROM analytics_card_daily WHERE day >= $1::date AND day <= $2::date GROUP BY day
       ), usage_daily AS (
         SELECT day, COALESCE(SUM(data_bytes), 0) AS data_bytes
           FROM analytics_usage_daily WHERE day >= $1::date AND day <= $2::date GROUP BY day
       )
       SELECT d.day::text AS day, COALESCE(c.cards_created, 0) AS cards_created,
              COALESCE(c.cards_used, 0) AS cards_used, COALESCE(u.data_bytes, 0) AS data_bytes
         FROM generate_series($1::date, $2::date, '1 day'::interval) d(day)
         LEFT JOIN card_daily c ON c.day = d.day
         LEFT JOIN usage_daily u ON u.day = d.day
        ORDER BY d.day`,
      [p.from, p.to],
    ),
    pool.query<{ dow: string; hour: string; sessions: string }>(
      `SELECT EXTRACT(DOW FROM (day + make_interval(hours => hour)))::int AS dow,
              hour,
              COALESCE(SUM(sessions), 0) AS sessions
         FROM analytics_usage_hourly
        WHERE day >= $1::date AND day <= $2::date
        GROUP BY 1, 2`,
      [p.from, p.to],
    ),
    pool.query<{
      router_id: string; observed_seconds: string; down_seconds: string; drops: string; longest_outage_seconds: string;
      sessions: string; data_bytes: string;
    }>(
      `SELECT ud.router_id,
              COALESCE(SUM(ud.observed_seconds), 0) AS observed_seconds,
              COALESCE(SUM(ud.down_seconds), 0) AS down_seconds,
              COALESCE(SUM(ud.drops), 0) AS drops,
              COALESCE(MAX(ud.longest_outage_seconds), 0) AS longest_outage_seconds,
              COALESCE(SUM(uu.sessions), 0) AS sessions,
              COALESCE(SUM(uu.data_bytes), 0) AS data_bytes
         FROM analytics_uptime_daily ud
         LEFT JOIN analytics_usage_daily uu ON uu.router_id = ud.router_id AND uu.day = ud.day
        WHERE ud.day >= $1::date AND ud.day <= $2::date
        GROUP BY ud.router_id`,
      [p.from, p.to],
    ),
  ]);

  const [cardTypeRows, dropsRowsRaw] = await Promise.all([
    pool.query<{ price: string | null; limit_type: string | null; cards_used: string }>(
      `SELECT price, limit_type, COALESCE(SUM(cards_used), 0) AS cards_used
         FROM analytics_card_daily
        WHERE day >= $1::date AND day <= $2::date
        GROUP BY price, limit_type`,
      [p.from, p.to],
    ),
    // 7-day drop window for "dropping" flag
    pool.query<{ router_id: string; drops: string }>(
      `SELECT router_id, COALESCE(SUM(drops), 0) AS drops
         FROM analytics_uptime_daily
        WHERE day >= $1::date AND day <= $2::date
        GROUP BY router_id`,
      [addDays(p.to, -6), p.to],
    ),
  ]);

  const [uptimeStateRows, seenSinceLaunchRows] = await Promise.all([
    pool.query<{ router_id: string; tracked_since: string }>(
      `SELECT router_id, to_char(tracked_since, 'YYYY-MM-DD') AS tracked_since FROM router_uptime_state`,
      [],
    ),
    pool.query<{ router_id: string }>(
      `SELECT DISTINCT router_id FROM analytics_uptime_daily
        WHERE observed_seconds > 0 AND day >= $1::date
       UNION
       SELECT DISTINCT router_id FROM analytics_usage_daily
        WHERE sessions > 0 AND day >= $1::date`,
      [config.ANALYTICS_USAGE_START_DATE],
    ),
  ]);

  // Build 168-cell heatmap (all dow 0-6, hour 0-23)
  const hourMap = new Map(hourlyRows.rows.map((r) => [`${r.dow}:${r.hour}`, num(r.sessions)]));
  const hours: { dow: number; hour: number; sessions: number }[] = [];
  for (let dow = 0; dow <= 6; dow++) {
    for (let hr = 0; hr <= 23; hr++) {
      hours.push({ dow, hour: hr, sessions: hourMap.get(`${dow}:${hr}`) ?? 0 });
    }
  }

  // Build router rows with live status
  const uptimeMap = new Map(uptimeRows.rows.map((r) => [r.router_id, r]));
  const dropsMap = new Map(dropsRowsRaw.rows.map((r) => [r.router_id, num(r.drops)]));

  const routerRows_: RouterRow[] = routerLiveRows.rows.map((lr): RouterRow => {
    const up = uptimeMap.get(lr.id);
    const obsS = num(up?.observed_seconds);
    const downS = num(up?.down_seconds);
    const drops7 = dropsMap.get(lr.id) ?? 0;
    const status = monitorStale
      ? 'unknown'
      : (lr.status as 'online' | 'offline' | 'degraded' | 'unknown');

    return {
      routerId: lr.id,
      router: lr.name,
      userId: lr.user_id,
      operator: lr.user_name,
      uptimePct: obsS > 0 ? pct(obsS - downS, obsS) : null,
      drops: num(up?.drops),
      longestOutageSec: num(up?.longest_outage_seconds),
      sessions: num(up?.sessions),
      dataBytes: num(up?.data_bytes),
      status,
      flags: {
        dropping: drops7 >= 5,
        offlineNow: !monitorStale && lr.status === 'offline',
      },
    };
  });

  // Sort: uptimePct ascending (nulls last), then drops descending
  routerRows_.sort((a, b) => {
    if (a.uptimePct === null && b.uptimePct === null) return b.drops - a.drops;
    if (a.uptimePct === null) return 1;
    if (b.uptimePct === null) return -1;
    if (a.uptimePct !== b.uptimePct) return a.uptimePct - b.uptimePct;
    return b.drops - a.drops;
  });

  // Counts
  const routersOnline = monitorStale
    ? 0
    : routerLiveRows.rows.filter((r) => r.status === 'online').length;
  const routersTotal = routerLiveRows.rows.length;

  // Uptime across all routers
  const totalObs = uptimeRows.rows.reduce((s, r) => s + num(r.observed_seconds), 0);
  const totalDown = uptimeRows.rows.reduce((s, r) => s + num(r.down_seconds), 0);
  const uptimePct = totalObs > 0 ? pct(totalObs - totalDown, totalObs) : null;

  // Platform card totals
  const dailyCardsCreated = dailyRows.rows.reduce((s, r) => s + num(r.cards_created), 0);
  const dailyCardsUsed = dailyRows.rows.reduce((s, r) => s + num(r.cards_used), 0);
  const salesValue = cardTypeRows.rows.reduce((s, r) => s + (r.price !== null ? num(r.price) * num(r.cards_used) : 0), 0);
  const unpricedUsed = cardTypeRows.rows
    .filter((r) => r.price === null)
    .reduce((s, r) => s + num(r.cards_used), 0);

  // neverConnected: routers with no row in router_uptime_state
  const seenSet = new Set(seenSinceLaunchRows.rows.map((r) => r.router_id));
  const trackedSet = new Set(uptimeStateRows.rows.map((r) => r.router_id));
  const neverConnected = routerLiveRows.rows.filter((r) => !trackedSet.has(r.id)).length;
  const notSeenSinceLaunch = routerLiveRows.rows.filter(
    (r) => trackedSet.has(r.id) && !seenSet.has(r.id),
  ).length;

  // Card types
  const byPriceMap = new Map<number | null, number>();
  const byKindMap = new Map<string | null, number>();
  for (const r of cardTypeRows.rows) {
    const price = r.price !== null ? num(r.price) : null;
    byPriceMap.set(price, (byPriceMap.get(price) ?? 0) + num(r.cards_used));
    const kind = r.limit_type ?? null;
    byKindMap.set(kind, (byKindMap.get(kind) ?? 0) + num(r.cards_used));
  }

  return {
    data: {
      cards: {
        routersOnline,
        routersTotal,
        neverConnected,
        notSeenSinceLaunch,
        uptimePct,
        dropping: [...dropsMap.values()].filter((d) => d >= 5).length,
        cardsUsed: dailyCardsUsed,
        cardsCreated: dailyCardsCreated,
        salesValue,
        unpricedUsed,
      },
      monitorStale,
      daily: dailyRows.rows.map((r) => ({
        day: typeof r.day === 'string' ? r.day.slice(0, 10) : String(r.day),
        cardsCreated: num(r.cards_created),
        cardsUsed: num(r.cards_used),
        dataBytes: num(r.data_bytes),
      })),
      hours,
      cardTypes: {
        byPrice: [...byPriceMap.entries()].map(([price, cardsUsed]) => ({ price, cardsUsed })),
        byKind: [...byKindMap.entries()].map(([limitType, cardsUsed]) => ({ limitType, cardsUsed })),
      },
      routers: routerRows_,
    },
    meta: metaResult,
  };
}
