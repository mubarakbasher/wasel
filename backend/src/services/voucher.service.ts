import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';
import { decrypt } from '../utils/encryption';
import { isSafeAcctSessionId } from '../utils/radius';
import { sendDisconnectRequest } from './radclient.service';

// ----- Interfaces -----

export interface VoucherMetaRow {
  id: string;
  user_id: string;
  router_id: string;
  radius_username: string;
  group_profile: string | null;
  comment: string | null;
  status: string;
  limit_type: string | null;
  limit_value: string | null; // BIGINT comes as string from pg
  limit_unit: string | null;
  validity_seconds: number | null;
  price: string | null; // DECIMAL comes as string from pg
  created_at: Date;
  updated_at: Date;
}

export interface VoucherInfo {
  id: string;
  userId: string;
  routerId: string;
  username: string;
  password: string | null;
  profileName: string | null;
  groupProfile: string | null;
  comment: string | null;
  status: string;
  expiration: string | null;
  simultaneousUse: number | null;
  limitType: string | null;
  limitValue: number | null;
  limitUnit: string | null;
  usedValue: number | null;
  validitySeconds: number | null;
  price: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoucherListResult {
  vouchers: VoucherInfo[];
  total: number;
  page: number;
  limit: number;
}

// ----- Constants -----

/**
 * Default maximum concurrent sessions per voucher.
 * Set to 20 to tolerate MAC-randomization overlap and brief double-connect
 * during handoff (e.g. a phone reconnects before the old session accounting
 * row is closed). The stale-session reaper closes abandoned rows once interim
 * updates stop arriving, so live session counts converge quickly.
 */
const VOUCHER_SIMULTANEOUS_USE = 20;

// ----- Helpers -----

/**
 * Generate a random alphanumeric string.
 */
function generateRandomString(length: number, charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'): string {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[bytes[i] % charset.length];
  }
  return result;
}

/**
 * Allocate `count` numeric voucher codes that are unique within the batch AND not already
 * present in the shared RADIUS namespace. Collisions are REGENERATED, not rejected — the
 * namespace is global across all routers/operators, so collisions are expected as it fills
 * and must never abort the creation.
 *
 * @param usernameExists - returns the subset of candidates already taken (the DB check).
 */
export async function allocateVoucherUsernames(
  count: number,
  usernameExists: (candidates: string[]) => Promise<string[]>,
  opts: { length?: number; maxRounds?: number } = {},
): Promise<string[]> {
  const length = opts.length ?? 8;
  const maxRounds = opts.maxRounds ?? 5;
  const used = new Set<string>();

  const fresh = (): string => {
    let candidate: string;
    let attempts = 0;
    do {
      candidate = generateRandomString(length, '0123456789');
      if (++attempts > 100) {
        throw new AppError(500, 'Failed to generate unique usernames', 'USERNAME_GENERATION_FAILED');
      }
    } while (used.has(candidate));
    used.add(candidate);
    return candidate;
  };

  const codes = Array.from({ length: count }, fresh);

  for (let round = 0; round < maxRounds; round++) {
    const taken = new Set(await usernameExists(codes));
    if (taken.size === 0) return codes; // collision-free → done
    for (let i = 0; i < codes.length; i++) {
      if (taken.has(codes[i])) {
        used.delete(codes[i]);
        codes[i] = fresh(); // regenerate ONLY the colliding ones
      }
    }
  }
  // Exhausted retries → namespace near-saturated; clean retryable 409 (effectively unreachable).
  throw new AppError(409, 'Could not allocate unique voucher codes. Please try again.', 'USERNAME_TAKEN');
}

/**
 * Convert limit value + unit to base units (seconds or bytes).
 */
function normalizeLimit(value: number, unit: string): number {
  switch (unit) {
    case 'minutes': return value * 60;
    case 'hours': return value * 3600;
    case 'days': return value * 86400;
    case 'MB': return value * 1024 * 1024;
    case 'GB': return value * 1024 * 1024 * 1024;
    default: return value;
  }
}

/**
 * Build a human-readable limit description for display.
 */
function buildLimitDisplayName(limitType: string, limitValue: number, limitUnit: string): string {
  if (limitType === 'time') {
    return `${limitValue} ${limitUnit}`;
  }
  return `${limitValue} ${limitUnit}`;
}

// ----- Batch RADIUS helpers (eliminate N+1) ----------------------------------

interface RadcheckBatchRow {
  username: string;
  attribute: string;
  value: string;
}

interface RadacctBatchRow {
  username: string;
  active_count: number;
  total_count: number;
  total_time_used: string;   // bigint as string from pg
  total_data_used: string;   // bigint as string from pg
}

interface ProfileBatchRow {
  group_name: string;
  user_id: string;
  display_name: string;
}

/**
 * Fetch all relevant radcheck attributes for a list of usernames in ONE query.
 * Returns a map: username → { password, expiration, simultaneousUse }.
 */
async function batchFetchRadcheck(usernames: string[]): Promise<Map<string, {
  password: string | null;
  expiration: string | null;
  simultaneousUse: number | null;
}>> {
  const result = await pool.query<RadcheckBatchRow>(
    `SELECT username, attribute, value
     FROM radcheck
     WHERE username = ANY($1)
       AND attribute IN ('Cleartext-Password', 'Expiration', 'Simultaneous-Use')`,
    [usernames],
  );

  const map = new Map<string, { password: string | null; expiration: string | null; simultaneousUse: number | null }>();
  for (const row of result.rows) {
    if (!map.has(row.username)) {
      map.set(row.username, { password: null, expiration: null, simultaneousUse: null });
    }
    const entry = map.get(row.username)!;
    if (row.attribute === 'Cleartext-Password') entry.password = row.value;
    else if (row.attribute === 'Expiration') entry.expiration = row.value;
    else if (row.attribute === 'Simultaneous-Use') entry.simultaneousUse = parseInt(row.value, 10);
  }
  return map;
}

/**
 * Fetch session counts + cumulative usage for a list of usernames in ONE query.
 * Returns a map: username → radacct aggregate row.
 */
async function batchFetchRadacct(usernames: string[]): Promise<Map<string, RadacctBatchRow>> {
  const result = await pool.query<RadacctBatchRow>(
    `SELECT
       username,
       COUNT(*) FILTER (WHERE acctstoptime IS NULL)::int AS active_count,
       COUNT(*)::int                                      AS total_count,
       COALESCE(SUM(acctsessiontime), 0)::bigint          AS total_time_used,
       COALESCE(SUM(acctinputoctets + acctoutputoctets), 0)::bigint AS total_data_used
     FROM radacct
     WHERE username = ANY($1)
     GROUP BY username`,
    [usernames],
  );

  const map = new Map<string, RadacctBatchRow>();
  for (const row of result.rows) {
    map.set(row.username, row);
  }
  return map;
}

/**
 * Fetch profile display names for a set of (group_name, user_id) pairs in ONE query.
 * Returns a map: `${group_name}:${user_id}` → display_name.
 */
async function batchFetchProfiles(
  pairs: Array<{ groupName: string; userId: string }>,
): Promise<Map<string, string>> {
  if (pairs.length === 0) return new Map();

  // Unnest parallel arrays — one round-trip for all profiles.
  const groupNames = pairs.map((p) => p.groupName);
  const userIds = pairs.map((p) => p.userId);

  const result = await pool.query<ProfileBatchRow>(
    `SELECT rp.group_name, rp.user_id, rp.display_name
     FROM radius_profiles rp
     WHERE (rp.group_name, rp.user_id) IN (
       SELECT unnest($1::text[]), unnest($2::uuid[])
     )`,
    [groupNames, userIds],
  );

  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(`${row.group_name}:${row.user_id}`, row.display_name);
  }
  return map;
}

/**
 * Assemble a VoucherInfo DTO from a VoucherMetaRow plus pre-fetched batch maps.
 * No additional DB queries are issued here.
 */
function assembleVoucherInfo(
  row: VoucherMetaRow,
  radcheckMap: Map<string, { password: string | null; expiration: string | null; simultaneousUse: number | null }>,
  radacctMap: Map<string, RadacctBatchRow>,
  profileMap: Map<string, string>,
): VoucherInfo {
  const rc = radcheckMap.get(row.radius_username) ?? { password: null, expiration: null, simultaneousUse: null };
  const ra = radacctMap.get(row.radius_username);

  const activeCount = ra?.active_count ?? 0;
  const totalCount  = ra?.total_count ?? 0;

  // Compute usage & check if limit exceeded
  let usageExceeded = false;
  let usedValue: number | null = null;
  if (row.limit_type && row.limit_value && ra) {
    const limitVal = BigInt(row.limit_value);
    if (row.limit_type === 'time') {
      const totalUsed = BigInt(ra.total_time_used);
      usedValue = Number(totalUsed);
      usageExceeded = totalUsed >= limitVal;
    } else if (row.limit_type === 'data') {
      const totalUsed = BigInt(ra.total_data_used);
      usedValue = Number(totalUsed);
      usageExceeded = totalUsed >= limitVal;
    }
  }

  // Compute effective status
  let computedStatus = row.status;
  if (row.status !== 'disabled') {
    if (usageExceeded) {
      computedStatus = 'expired';
    } else if (rc.expiration && new Date(rc.expiration) < new Date()) {
      computedStatus = 'expired';
    } else if (activeCount > 0) {
      computedStatus = 'active';
    } else if (totalCount > 0) {
      computedStatus = 'used';
    } else {
      computedStatus = 'unused';
    }
  }

  // Build profile name
  let profileName: string | null = null;
  if (row.group_profile) {
    const key = `${row.group_profile}:${row.user_id}`;
    profileName = profileMap.get(key) ?? row.group_profile;
  } else if (row.limit_type && row.limit_value && row.limit_unit) {
    profileName = buildLimitDisplayName(row.limit_type, Number(row.limit_value), row.limit_unit);
  }

  return {
    id: row.id,
    userId: row.user_id,
    routerId: row.router_id,
    username: row.radius_username,
    password: rc.password,
    profileName,
    groupProfile: row.group_profile,
    comment: row.comment,
    status: computedStatus,
    expiration: rc.expiration,
    simultaneousUse: rc.simultaneousUse,
    limitType: row.limit_type,
    limitValue: row.limit_value ? Number(row.limit_value) : null,
    limitUnit: row.limit_unit,
    usedValue,
    validitySeconds: row.validity_seconds,
    price: row.price ? parseFloat(row.price) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Batch-enrich a list of VoucherMetaRows into VoucherInfo DTOs.
 * Issues exactly 3 SQL queries regardless of page size:
 *   1. radcheck (batch)
 *   2. radacct  (batch GROUP BY)
 *   3. radius_profiles (batch, only when group_profile is set)
 *
 * Exported so the platform-wide admin voucher list (admin.service.ts) shares the
 * IDENTICAL derived-status / usage computation as the operator list — there is a
 * single enrichment path, so the two lists can never drift.
 */
export async function batchToVoucherInfo(rows: VoucherMetaRow[]): Promise<VoucherInfo[]> {
  if (rows.length === 0) return [];

  const usernames = rows.map((r) => r.radius_username);

  // Issue the 3 batch queries in parallel.
  const profilePairs = rows
    .filter((r) => r.group_profile !== null)
    .map((r) => ({ groupName: r.group_profile as string, userId: r.user_id }));

  const [radcheckMap, radacctMap, profileMap] = await Promise.all([
    batchFetchRadcheck(usernames),
    batchFetchRadacct(usernames),
    batchFetchProfiles(profilePairs),
  ]);

  return rows.map((row) => assembleVoucherInfo(row, radcheckMap, radacctMap, profileMap));
}

/**
 * Single-voucher helper: reuses the batch path (no separate code path to drift).
 */
async function toVoucherInfo(row: VoucherMetaRow): Promise<VoucherInfo> {
  const [info] = await batchToVoucherInfo([row]);
  return info;
}

/**
 * Verify router belongs to the user. Returns the router's tunnel_ip
 * since most callers need it to NAS-scope the vouchers they create.
 */
async function verifyRouterOwnership(userId: string, routerId: string): Promise<{ tunnelIp: string | null }> {
  const result = await pool.query<{ tunnel_ip: string | null }>(
    'SELECT tunnel_ip FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }
  return { tunnelIp: result.rows[0].tunnel_ip };
}

/**
 * Format expiration date for FreeRADIUS.
 * FreeRADIUS expects: "January 01 2026 00:00:00" format.
 */
function formatRadiusExpiration(isoDate: string): string {
  const expDate = new Date(isoDate);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[expDate.getUTCMonth()]} ${String(expDate.getUTCDate()).padStart(2, '0')} ${expDate.getUTCFullYear()} ${String(expDate.getUTCHours()).padStart(2, '0')}:${String(expDate.getUTCMinutes()).padStart(2, '0')}:${String(expDate.getUTCSeconds()).padStart(2, '0')}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgClient = { query: (...args: any[]) => Promise<any> };

/**
 * Insert RADIUS entries for a new-style voucher (no profiles).
 *
 * No per-voucher NAS scoping: vouchers authenticate on any NAS that
 * successfully presents its shared secret. Voucher usernames are random
 * 8-char strings and Simultaneous-Use=20 tolerates MAC-rotation overlap;
 * the stale-session reaper closes stragglers quickly. Cross-router replay
 * is a negligible concern. A previous NAS-IP-Address
 * scope row (commit 588eeb5) compared against the NAS-self-reported
 * NAS-IP-Address AVP (RFC 2865 §5.4), which RouterOS sets to the router's
 * own IP — not the WireGuard peer IP — so the comparison structurally
 * could not succeed on this deployment's topology.
 */
async function insertRadiusEntriesV2(
  client: PgClient,
  username: string,
  password: string,
  limitType: 'time' | 'data',
  normalizedLimitValue: number,
  validitySeconds: number | null | undefined,
): Promise<void> {
  // radcheck: Cleartext-Password
  await client.query(
    'INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)',
    [username, 'Cleartext-Password', ':=', password],
  );

  // radcheck: Simultaneous-Use
  await client.query(
    'INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)',
    [username, 'Simultaneous-Use', ':=', String(VOUCHER_SIMULTANEOUS_USE)],
  );

  // radcheck: limit attribute
  if (limitType === 'time') {
    // Max-All-Session: total allowed online time in seconds
    await client.query(
      'INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)',
      [username, 'Max-All-Session', ':=', String(normalizedLimitValue)],
    );
  } else {
    // Data limit
    if (normalizedLimitValue <= 4294967295) {
      await client.query(
        'INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)',
        [username, 'Max-Total-Octets', ':=', String(normalizedLimitValue)],
      );
    } else {
      // Split into base + gigawords for values > 4GB
      const gigawords = Math.floor(normalizedLimitValue / 4294967296);
      const remainder = normalizedLimitValue % 4294967296;
      await client.query(
        'INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)',
        [username, 'Max-Total-Octets', ':=', String(remainder)],
      );
      await client.query(
        'INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)',
        [username, 'Max-Total-Octets-Gigawords', ':=', String(gigawords)],
      );
    }
  }

  // Expiration is NOT set here — the validityExpiration job sets it
  // after first login (validity from first use, not from creation).

  // Session-Timeout caps the *first* session at validity_seconds. Without this
  // the first session has no validity-derived upper bound (rlm_expiration only
  // takes effect on the next Access-Request, after the validityExpiration cron
  // has written the Expiration radcheck row). On any subsequent re-auth,
  // rlm_expiration overwrites Session-Timeout with the correct remaining time
  // via FR's `:=` semantics, so this radreply value never masks the wall-clock
  // validity check.
  if (validitySeconds && validitySeconds > 0) {
    await client.query(
      'INSERT INTO radreply (username, attribute, op, value) VALUES ($1, $2, $3, $4)',
      [username, 'Session-Timeout', ':=', String(validitySeconds)],
    );
  }
}

// ----- Service Functions -----

/**
 * Create vouchers (unified: handles both single and bulk creation).
 */
export async function createVouchers(
  userId: string,
  routerId: string,
  data: {
    limitType: 'time' | 'data';
    limitValue: number;
    limitUnit: string;
    validitySeconds?: number | null;
    count: number;
    price: number;
  },
): Promise<VoucherInfo[]> {
  const { tunnelIp } = await verifyRouterOwnership(userId, routerId);
  if (!tunnelIp) {
    throw new AppError(
      409,
      'Router is still being provisioned — tunnel IP not yet allocated. Try again once the router is online.',
      'ROUTER_NOT_READY',
    );
  }

  const count = data.count;
  const normalizedValue = normalizeLimit(data.limitValue, data.limitUnit);

  // Generate codes, regenerating any that collide with the shared global RADIUS namespace
  // (instead of aborting the whole batch on the first collision).
  const usernames = await allocateVoucherUsernames(count, async (candidates) => {
    const res = await pool.query<{ username: string }>(
      `SELECT DISTINCT username FROM radcheck WHERE username = ANY($1)`,
      [candidates],
    );
    return res.rows.map((r) => r.username);
  });
  const credentials: Array<{ username: string }> = usernames.map((username) => ({ username }));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── F2 atomic quota guard ─────────────────────────────────────────────────
    // Increment vouchers_used only when the resulting total stays within quota.
    // voucher_quota = -1 means Enterprise (unlimited). Using a single UPDATE
    // with an inline guard makes this race-condition-free: two concurrent
    // creates that both passed the pre-check (checkQuota middleware) cannot
    // both succeed here — only one will find rowCount > 0.
    const quotaResult = await client.query<{ vouchers_used: number }>(
      `UPDATE subscriptions
       SET vouchers_used = vouchers_used + $1
       WHERE user_id = $2
         AND status = 'active'
         AND (voucher_quota = -1 OR vouchers_used + $1 <= voucher_quota)
       RETURNING vouchers_used`,
      [count, userId],
    );

    if ((quotaResult.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      throw new AppError(403, 'Voucher quota exceeded. Upgrade your plan for more vouchers.', 'QUOTA_EXCEEDED');
    }

    // ── Batched INSERT: voucher_meta ──────────────────────────────────────────
    // Build a single multi-row INSERT instead of N round-trips. All vouchers in
    // a batch share the same limit_type/limit_value/limit_unit/validity/price.
    const vmValues: unknown[] = [];
    const vmPlaceholders: string[] = [];
    let pIdx = 1;
    for (const cred of credentials) {
      vmPlaceholders.push(
        `($${pIdx++}, $${pIdx++}, $${pIdx++}, NULL, NULL, 'unused', $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`,
      );
      vmValues.push(
        userId, routerId, cred.username,
        data.limitType, normalizedValue, data.limitUnit,
        data.validitySeconds ?? null, data.price,
      );
    }
    const vmResult = await client.query<VoucherMetaRow>(
      `INSERT INTO voucher_meta
         (user_id, router_id, radius_username, group_profile, comment, status,
          limit_type, limit_value, limit_unit, validity_seconds, price)
       VALUES ${vmPlaceholders.join(', ')}
       RETURNING *`,
      vmValues,
    );
    const vouchers = vmResult.rows;

    // ── Batched INSERT: radcheck ──────────────────────────────────────────────
    // Determine the limit attribute name and values once for the whole batch —
    // all vouchers share the same limitType and normalizedValue.
    const rcValues: unknown[] = [];
    const rcPlaceholders: string[] = [];
    let rcIdx = 1;

    for (const cred of credentials) {
      // Cleartext-Password (username == password for numeric vouchers)
      rcPlaceholders.push(`($${rcIdx++}, $${rcIdx++}, $${rcIdx++}, $${rcIdx++})`);
      rcValues.push(cred.username, 'Cleartext-Password', ':=', cred.username);

      // Simultaneous-Use
      rcPlaceholders.push(`($${rcIdx++}, $${rcIdx++}, $${rcIdx++}, $${rcIdx++})`);
      rcValues.push(cred.username, 'Simultaneous-Use', ':=', String(VOUCHER_SIMULTANEOUS_USE));

      // Limit attribute
      if (data.limitType === 'time') {
        rcPlaceholders.push(`($${rcIdx++}, $${rcIdx++}, $${rcIdx++}, $${rcIdx++})`);
        rcValues.push(cred.username, 'Max-All-Session', ':=', String(normalizedValue));
      } else if (normalizedValue <= 4294967295) {
        rcPlaceholders.push(`($${rcIdx++}, $${rcIdx++}, $${rcIdx++}, $${rcIdx++})`);
        rcValues.push(cred.username, 'Max-Total-Octets', ':=', String(normalizedValue));
      } else {
        // > 4 GB: split into base + gigawords
        const gigawords = Math.floor(normalizedValue / 4294967296);
        const remainder = normalizedValue % 4294967296;
        rcPlaceholders.push(`($${rcIdx++}, $${rcIdx++}, $${rcIdx++}, $${rcIdx++})`);
        rcValues.push(cred.username, 'Max-Total-Octets', ':=', String(remainder));
        rcPlaceholders.push(`($${rcIdx++}, $${rcIdx++}, $${rcIdx++}, $${rcIdx++})`);
        rcValues.push(cred.username, 'Max-Total-Octets-Gigawords', ':=', String(gigawords));
      }
    }

    await client.query(
      `INSERT INTO radcheck (username, attribute, op, value) VALUES ${rcPlaceholders.join(', ')}`,
      rcValues,
    );

    // ── Batched INSERT: radreply (Session-Timeout) ────────────────────────────
    if (data.validitySeconds && data.validitySeconds > 0) {
      const rrValues: unknown[] = [];
      const rrPlaceholders: string[] = [];
      let rrIdx = 1;
      for (const cred of credentials) {
        rrPlaceholders.push(`($${rrIdx++}, $${rrIdx++}, $${rrIdx++}, $${rrIdx++})`);
        rrValues.push(cred.username, 'Session-Timeout', ':=', String(data.validitySeconds));
      }
      await client.query(
        `INSERT INTO radreply (username, attribute, op, value) VALUES ${rrPlaceholders.join(', ')}`,
        rrValues,
      );
    }

    await client.query('COMMIT');

    logger.info('Vouchers created', {
      userId,
      routerId,
      count,
      limitType: data.limitType,
      limitValue: data.limitValue,
      limitUnit: data.limitUnit,
    });

    return batchToVoucherInfo(vouchers);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && typeof error === 'object' && (error as { code?: string }).code === '23505') {
      // Concurrent batch grabbed the same code between our check and INSERT.
      throw new AppError(409, 'A voucher code collided. Please try again.', 'USERNAME_TAKEN');
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Build the derived-status WHERE fragments for a voucher query.
 *
 * These are pure SQL string literals with NO bound parameters. They reference
 * the `vm` (voucher_meta) alias plus correlated radcheck/radacct EXISTS
 * subqueries, so they are alias-portable: both the operator-scoped list
 * (buildFilterConditions below) and the platform-wide admin list
 * (admin.service.getAllVouchers) reuse them verbatim, guaranteeing IDENTICAL
 * derived-status semantics.
 *
 * Supported statuses: active | used | unused | expired | disabled. Any other
 * value yields no fragments (preserves the prior no-op fall-through behavior).
 */
export function buildVoucherStatusConditions(status: string): string[] {
  if (status === 'disabled') {
    return [`vm.status = 'disabled'`];
  }
  if (status === 'expired') {
    return [
      `vm.status != 'disabled'`,
      `EXISTS (SELECT 1 FROM radcheck rc WHERE rc.username = vm.radius_username AND rc.attribute = 'Expiration' AND to_timestamp(rc.value, 'Month DD YYYY HH24:MI:SS') < NOW())`,
    ];
  }
  if (status === 'active') {
    return [
      `vm.status != 'disabled'`,
      `EXISTS (SELECT 1 FROM radacct ra WHERE ra.username = vm.radius_username AND ra.acctstoptime IS NULL)`,
    ];
  }
  if (status === 'used') {
    return [
      `vm.status != 'disabled'`,
      `NOT EXISTS (SELECT 1 FROM radcheck rc WHERE rc.username = vm.radius_username AND rc.attribute = 'Expiration' AND to_timestamp(rc.value, 'Month DD YYYY HH24:MI:SS') < NOW())`,
      `NOT EXISTS (SELECT 1 FROM radacct ra WHERE ra.username = vm.radius_username AND ra.acctstoptime IS NULL)`,
      `EXISTS (SELECT 1 FROM radacct ra WHERE ra.username = vm.radius_username)`,
    ];
  }
  if (status === 'unused') {
    return [
      `vm.status != 'disabled'`,
      `NOT EXISTS (SELECT 1 FROM radacct ra WHERE ra.username = vm.radius_username)`,
      `NOT EXISTS (SELECT 1 FROM radcheck rc WHERE rc.username = vm.radius_username AND rc.attribute = 'Expiration' AND to_timestamp(rc.value, 'Month DD YYYY HH24:MI:SS') < NOW())`,
    ];
  }
  return [];
}

/**
 * Build WHERE-clause conditions for voucher queries.
 * Shared between getVouchersByRouter and bulkDeleteVouchers.
 */
function buildFilterConditions(
  userId: string,
  routerId: string,
  options: { status?: string; limitType?: string; search?: string },
): { conditions: string[]; values: unknown[]; paramIndex: number } {
  const conditions: string[] = ['vm.user_id = $1', 'vm.router_id = $2'];
  const values: unknown[] = [userId, routerId];
  let paramIndex = 3;

  if (options.status) {
    conditions.push(...buildVoucherStatusConditions(options.status));
  }

  if (options.limitType) {
    conditions.push(`vm.limit_type = $${paramIndex++}`);
    values.push(options.limitType);
  }

  if (options.search) {
    conditions.push(`vm.radius_username ILIKE $${paramIndex++}`);
    values.push(`%${options.search}%`);
  }

  return { conditions, values, paramIndex };
}

/**
 * List vouchers for a router with pagination and filtering.
 */
export async function getVouchersByRouter(
  userId: string,
  routerId: string,
  options: {
    status?: string;
    limitType?: string;
    page?: number;
    limit?: number;
    search?: string;
  } = {},
): Promise<VoucherListResult> {
  await verifyRouterOwnership(userId, routerId);

  const page = Number(options.page) || 1;
  const limit = Number(options.limit) || 20;
  const offset = (page - 1) * limit;

  const { conditions, values, paramIndex } = buildFilterConditions(userId, routerId, options);
  const whereClause = conditions.join(' AND ');

  // Count total
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM voucher_meta vm WHERE ${whereClause}`,
    values,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Fetch page
  const listValues = [...values, limit, offset];
  const result = await pool.query<VoucherMetaRow>(
    `SELECT vm.* FROM voucher_meta vm
     WHERE ${whereClause}
     ORDER BY vm.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    listValues,
  );

  const vouchers = await batchToVoucherInfo(result.rows);

  return { vouchers, total, page, limit };
}

/**
 * Get a single voucher by ID.
 */
export async function getVoucherById(
  userId: string,
  routerId: string,
  voucherId: string,
): Promise<VoucherInfo> {
  await verifyRouterOwnership(userId, routerId);

  const result = await pool.query<VoucherMetaRow>(
    'SELECT * FROM voucher_meta WHERE id = $1 AND user_id = $2 AND router_id = $3',
    [voucherId, userId, routerId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Voucher not found', 'VOUCHER_NOT_FOUND');
  }

  return toVoucherInfo(result.rows[0]);
}

/**
 * Update voucher status or attributes.
 * - Setting status to 'disabled' inserts Auth-Type := Reject in radcheck
 * - Setting status to 'active' removes Auth-Type := Reject
 * - Updating expiration replaces the Expiration attribute in radcheck
 */
export async function updateVoucher(
  userId: string,
  routerId: string,
  voucherId: string,
  data: {
    status?: 'active' | 'disabled';
    expiration?: string | null;
    comment?: string;
  },
): Promise<VoucherInfo> {
  await verifyRouterOwnership(userId, routerId);

  const existing = await pool.query<VoucherMetaRow>(
    'SELECT * FROM voucher_meta WHERE id = $1 AND user_id = $2 AND router_id = $3',
    [voucherId, userId, routerId],
  );

  if (existing.rows.length === 0) {
    throw new AppError(404, 'Voucher not found', 'VOUCHER_NOT_FOUND');
  }

  const voucher = existing.rows[0];
  const username = voucher.radius_username;

  // FIX 4: Guard against reactivating a genuinely exhausted voucher.
  // Queries cumulative usage from radacct and throws 409 if the voucher has
  // already consumed its full allowance — consistent with the usage-limit
  // enforcement cron. A "false latch" (cron fired but real usage < limit due
  // to stale-reaped rows) will have an accurate sum < limit_value here and
  // will pass through normally, allowing clean reactivation without
  // re-latching within 30 s via the cron.
  if (
    data.status === 'active' &&
    voucher.status !== 'active' &&
    (voucher.limit_type === 'time' || voucher.limit_type === 'data') &&
    voucher.limit_value
  ) {
    const usageResult = await pool.query<{ total_used: string }>(
      voucher.limit_type === 'time'
        ? `SELECT COALESCE(SUM(acctsessiontime), 0)::bigint AS total_used FROM radacct WHERE username = $1`
        : `SELECT COALESCE(SUM(acctinputoctets + acctoutputoctets), 0)::bigint AS total_used FROM radacct WHERE username = $1`,
      [username],
    );
    const totalUsed = BigInt(usageResult.rows[0]?.total_used ?? '0');
    if (totalUsed >= BigInt(voucher.limit_value)) {
      throw new AppError(
        409,
        'Voucher has reached its usage limit and cannot be reactivated — please issue a new voucher.',
        'VOUCHER_LIMIT_REACHED',
      );
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update voucher_meta fields
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }
    if (data.comment !== undefined) {
      setClauses.push(`comment = $${paramIndex++}`);
      values.push(data.comment);
    }

    let updatedVoucher = voucher;
    if (setClauses.length > 0) {
      values.push(voucherId);
      const updateResult = await client.query<VoucherMetaRow>(
        `UPDATE voucher_meta SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values,
      );
      updatedVoucher = updateResult.rows[0];
    }

    // Handle status change in RADIUS
    if (data.status === 'disabled') {
      await client.query(
        `DELETE FROM radcheck WHERE username = $1 AND attribute = 'Auth-Type'`,
        [username],
      );
      await client.query(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)`,
        [username, 'Auth-Type', ':=', 'Reject'],
      );
    } else if (data.status === 'active' && voucher.status !== 'active') {
      // Clear any Auth-Type := Reject row regardless of how it was latched
      // (disabled by operator OR expired by the usage-limit enforcement cron).
      // This lets operators reactivate an 'expired' voucher directly without
      // the awkward disable→reactivate two-step.
      await client.query(
        `DELETE FROM radcheck WHERE username = $1 AND attribute = 'Auth-Type'`,
        [username],
      );
    }

    // Handle expiration update
    if (data.expiration !== undefined) {
      await client.query(
        `DELETE FROM radcheck WHERE username = $1 AND attribute = 'Expiration'`,
        [username],
      );

      if (data.expiration !== null) {
        await client.query(
          `INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)`,
          [username, 'Expiration', ':=', formatRadiusExpiration(data.expiration)],
        );
      }
    }

    await client.query('COMMIT');

    // FIX 3: Fire-and-forget CoA disconnect when an operator disables a voucher,
    // mirroring deleteVoucher. This terminates the live session immediately so
    // the device is kicked off the network rather than waiting for the next
    // Access-Request or session timeout.
    if (data.status === 'disabled') {
      try { await sendCoaDisconnect(userId, routerId, username); }
      catch (error) { logger.warn('CoA disconnect on disable failed (non-fatal)', { voucherId, username, error: error instanceof Error ? error.message : String(error) }); }
    }

    logger.info('Voucher updated', {
      voucherId,
      userId,
      routerId,
      changes: data,
    });

    return toVoucherInfo(updatedVoucher);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete a voucher. Removes from voucher_meta, radcheck, radreply, radusergroup.
 * Optionally sends a CoA Disconnect-Request to terminate active sessions.
 */
export async function deleteVoucher(
  userId: string,
  routerId: string,
  voucherId: string,
): Promise<void> {
  await verifyRouterOwnership(userId, routerId);

  const existing = await pool.query<VoucherMetaRow>(
    'SELECT * FROM voucher_meta WHERE id = $1 AND user_id = $2 AND router_id = $3',
    [voucherId, userId, routerId],
  );

  if (existing.rows.length === 0) {
    throw new AppError(404, 'Voucher not found', 'VOUCHER_NOT_FOUND');
  }

  const voucher = existing.rows[0];
  const username = voucher.radius_username;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Remove RADIUS entries
    await client.query('DELETE FROM radcheck WHERE username = $1', [username]);
    await client.query('DELETE FROM radreply WHERE username = $1', [username]);
    await client.query('DELETE FROM radusergroup WHERE username = $1', [username]);

    // Remove voucher_meta
    await client.query('DELETE FROM voucher_meta WHERE id = $1', [voucherId]);

    // Decrement vouchers_used on the active subscription, mirroring
    // bulkDeleteVouchers exactly (GREATEST guard, active-status/user predicate).
    // Without this a single delete permanently over-counts quota for finite-tier
    // operators, causing false QUOTA_EXCEEDED until renewal. The -1 "unlimited"
    // sentinel needs no special-case: the GREATEST floor keeps it harmless.
    await client.query(
      `UPDATE subscriptions SET vouchers_used = GREATEST(vouchers_used - $1, 0)
       WHERE user_id = $2 AND status = 'active'`,
      [1, userId],
    );

    await client.query('COMMIT');

    // Send CoA Disconnect-Request (fire-and-forget, non-fatal)
    try {
      await sendCoaDisconnect(userId, routerId, username);
    } catch (error) {
      logger.warn('CoA disconnect failed (non-fatal)', {
        voucherId,
        username,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('Voucher deleted', {
      voucherId,
      userId,
      routerId,
      username,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Bulk delete vouchers by IDs or by filter criteria.
 * Removes from voucher_meta, radcheck, radreply, radusergroup.
 * Sends CoA Disconnect-Requests for active sessions (fire-and-forget).
 */
export async function bulkDeleteVouchers(
  userId: string,
  routerId: string,
  body: {
    ids?: string[];
    filter?: {
      status?: string;
      limitType?: string;
      search?: string;
      all?: boolean;
    };
  },
): Promise<{ deletedCount: number }> {
  await verifyRouterOwnership(userId, routerId);

  let voucherRows: Array<{ id: string; radius_username: string }>;

  if (body.ids) {
    // Mode 1: Delete by explicit IDs
    const result = await pool.query<{ id: string; radius_username: string }>(
      `SELECT id, radius_username FROM voucher_meta
       WHERE id = ANY($1) AND user_id = $2 AND router_id = $3`,
      [body.ids, userId, routerId],
    );
    voucherRows = result.rows;
  } else if (body.filter) {
    // Mode 2: Delete by filter criteria (same filters as list endpoint)
    const { conditions, values } = buildFilterConditions(userId, routerId, {
      status: body.filter.status,
      limitType: body.filter.limitType,
      search: body.filter.search,
    });
    const whereClause = conditions.join(' AND ');
    // Cap filter-mode deletes at 500 rows per request to prevent unbounded
    // single-transaction deletes that could lock the table for seconds.
    const result = await pool.query<{ id: string; radius_username: string }>(
      `SELECT vm.id, vm.radius_username FROM voucher_meta vm WHERE ${whereClause} LIMIT 500`,
      values,
    );
    voucherRows = result.rows;
  } else {
    throw new AppError(400, 'Either ids or filter must be provided', 'INVALID_REQUEST');
  }

  if (voucherRows.length === 0) {
    return { deletedCount: 0 };
  }

  const ids = voucherRows.map((r) => r.id);
  const usernames = voucherRows.map((r) => r.radius_username);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Remove RADIUS entries in bulk
    await client.query('DELETE FROM radcheck WHERE username = ANY($1)', [usernames]);
    await client.query('DELETE FROM radreply WHERE username = ANY($1)', [usernames]);
    await client.query('DELETE FROM radusergroup WHERE username = ANY($1)', [usernames]);

    // Remove voucher_meta entries
    await client.query(
      'DELETE FROM voucher_meta WHERE id = ANY($1) AND user_id = $2 AND router_id = $3',
      [ids, userId, routerId],
    );

    // Decrement vouchers_used in subscription
    await client.query(
      `UPDATE subscriptions SET vouchers_used = GREATEST(vouchers_used - $1, 0)
       WHERE user_id = $2 AND status = 'active'`,
      [voucherRows.length, userId],
    );

    await client.query('COMMIT');

    // Fire-and-forget CoA disconnects for active sessions
    for (const username of usernames) {
      sendCoaDisconnect(userId, routerId, username).catch((error) => {
        logger.warn('CoA disconnect failed during bulk delete (non-fatal)', {
          username,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    logger.info('Vouchers bulk deleted', {
      userId,
      routerId,
      deletedCount: voucherRows.length,
    });

    return { deletedCount: voucherRows.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Send CoA Disconnect-Requests to terminate all active RADIUS sessions for a
 * username. Uses the shell-free sendDisconnectRequest helper (spawn, no /bin/sh).
 * Non-fatal: logs warnings on nak/timeout but does not throw.
 */
async function sendCoaDisconnect(userId: string, routerId: string, username: string): Promise<void> {
  const routerResult = await pool.query<{ tunnel_ip: string | null; radius_secret_enc: string | null }>(
    'SELECT tunnel_ip, radius_secret_enc FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId],
  );

  if (routerResult.rows.length === 0) return;

  const router = routerResult.rows[0];
  if (!router.tunnel_ip || !router.radius_secret_enc) return;

  const sessionResult = await pool.query<{ acctsessionid: string; framedipaddress: string | null }>(
    `SELECT acctsessionid, framedipaddress FROM radacct
     WHERE username = $1 AND nasipaddress = $2 AND acctstoptime IS NULL`,
    [username, router.tunnel_ip],
  );

  if (sessionResult.rows.length === 0) return;

  const radiusSecret = decrypt(router.radius_secret_enc);

  for (const session of sessionResult.rows) {
    // Defense-in-depth: acctsessionid comes from FreeRADIUS accounting records
    // written by the router — an attacker who controls router firmware or the
    // WireGuard peer could craft a malicious value. Reject anything outside
    // [A-Za-z0-9._-] before forwarding to any external process.
    if (!isSafeAcctSessionId(session.acctsessionid)) {
      logger.warn('CoA skipped: acctsessionid contains unsafe characters', {
        username,
        sessionId: session.acctsessionid,
        nasIp: router.tunnel_ip,
      });
      continue;
    }

    const result = await sendDisconnectRequest({
      secret: radiusSecret,
      nasIp: router.tunnel_ip,
      username,
      acctSessionId: session.acctsessionid,
      framedIp: session.framedipaddress ?? undefined,
    });

    if (result === 'ack') {
      logger.info('CoA disconnect acknowledged', {
        username,
        sessionId: session.acctsessionid,
        nasIp: router.tunnel_ip,
      });
    } else {
      logger.warn('CoA disconnect not acknowledged (non-fatal)', {
        username,
        sessionId: session.acctsessionid,
        nasIp: router.tunnel_ip,
        result,
      });
    }
  }
}
