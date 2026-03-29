import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';

// ----- Interfaces -----

export interface VoucherMetaRow {
  id: string;
  user_id: string;
  router_id: string;
  radius_username: string;
  group_profile: string;
  comment: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface VoucherInfo {
  id: string;
  userId: string;
  routerId: string;
  username: string;
  password: string | null;
  profileName: string;
  groupProfile: string;
  comment: string | null;
  status: string;
  expiration: string | null;
  simultaneousUse: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoucherListResult {
  vouchers: VoucherInfo[];
  total: number;
  page: number;
  limit: number;
}

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
 * Transform a voucher_meta row + RADIUS data into VoucherInfo.
 */
async function toVoucherInfo(row: VoucherMetaRow): Promise<VoucherInfo> {
  // Fetch password from radcheck
  const pwResult = await pool.query(
    `SELECT value FROM radcheck WHERE username = $1 AND attribute = 'Cleartext-Password'`,
    [row.radius_username],
  );
  const password = pwResult.rows.length > 0 ? pwResult.rows[0].value : null;

  // Fetch expiration from radcheck
  const expResult = await pool.query(
    `SELECT value FROM radcheck WHERE username = $1 AND attribute = 'Expiration'`,
    [row.radius_username],
  );
  const expiration = expResult.rows.length > 0 ? expResult.rows[0].value : null;

  // Fetch simultaneous use from radcheck
  const simResult = await pool.query(
    `SELECT value FROM radcheck WHERE username = $1 AND attribute = 'Simultaneous-Use'`,
    [row.radius_username],
  );
  const simultaneousUse = simResult.rows.length > 0 ? parseInt(simResult.rows[0].value, 10) : null;

  // Fetch profile display name
  const profileResult = await pool.query(
    `SELECT display_name FROM radius_profiles WHERE group_name = $1 AND user_id = $2`,
    [row.group_profile, row.user_id],
  );
  const profileName = profileResult.rows.length > 0 ? profileResult.rows[0].display_name : row.group_profile;

  return {
    id: row.id,
    userId: row.user_id,
    routerId: row.router_id,
    username: row.radius_username,
    password,
    profileName,
    groupProfile: row.group_profile,
    comment: row.comment,
    status: row.status,
    expiration,
    simultaneousUse,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Verify router belongs to the user. Returns the router row.
 */
async function verifyRouterOwnership(userId: string, routerId: string): Promise<void> {
  const result = await pool.query(
    'SELECT id FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }
}

/**
 * Verify profile belongs to the user and return its group_name.
 */
async function verifyProfileOwnership(userId: string, profileId: string): Promise<string> {
  const result = await pool.query(
    'SELECT group_name FROM radius_profiles WHERE id = $1 AND user_id = $2',
    [profileId, userId],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, 'RADIUS profile not found', 'PROFILE_NOT_FOUND');
  }
  return result.rows[0].group_name;
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
 * Insert RADIUS entries for a single voucher within a transaction.
 */
async function insertRadiusEntries(
  client: PgClient,
  username: string,
  password: string,
  groupName: string,
  expiration?: string,
  simultaneousUse?: number,
): Promise<void> {
  // radcheck: Cleartext-Password
  await client.query(
    'INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)',
    [username, 'Cleartext-Password', ':=', password],
  );

  // radcheck: Expiration (optional)
  if (expiration) {
    await client.query(
      'INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)',
      [username, 'Expiration', ':=', formatRadiusExpiration(expiration)],
    );
  }

  // radcheck: Simultaneous-Use (optional)
  if (simultaneousUse != null) {
    await client.query(
      'INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)',
      [username, 'Simultaneous-Use', ':=', String(simultaneousUse)],
    );
  }

  // radusergroup: map username to group profile
  await client.query(
    'INSERT INTO radusergroup (username, groupname, priority) VALUES ($1, $2, $3)',
    [username, groupName, 1],
  );
}

// ----- Service Functions -----

/**
 * Create a single voucher.
 */
export async function createVoucher(
  userId: string,
  routerId: string,
  data: {
    profileId: string;
    username?: string;
    password?: string;
    comment?: string;
    expiration?: string;
    simultaneousUse?: number;
  },
): Promise<VoucherInfo> {
  await verifyRouterOwnership(userId, routerId);
  const groupName = await verifyProfileOwnership(userId, data.profileId);

  const username = data.username || generateRandomString(8);
  const password = data.password || generateRandomString(8);

  // Check username uniqueness
  const existingUser = await pool.query(
    'SELECT id FROM radcheck WHERE username = $1 LIMIT 1',
    [username],
  );
  if (existingUser.rows.length > 0) {
    throw new AppError(409, `Username '${username}' is already taken`, 'USERNAME_TAKEN');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert into voucher_meta
    const result = await client.query<VoucherMetaRow>(
      `INSERT INTO voucher_meta (user_id, router_id, radius_username, group_profile, comment, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING *`,
      [userId, routerId, username, groupName, data.comment || null],
    );
    const voucher = result.rows[0];

    // Insert RADIUS entries
    await insertRadiusEntries(client, username, password, groupName, data.expiration, data.simultaneousUse);

    // Increment vouchers_used in subscription
    await client.query(
      `UPDATE subscriptions SET vouchers_used = vouchers_used + 1
       WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );

    await client.query('COMMIT');

    logger.info('Voucher created', {
      voucherId: voucher.id,
      userId,
      routerId,
      username,
      groupProfile: groupName,
    });

    return toVoucherInfo(voucher);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create vouchers in bulk (up to 100 per batch).
 */
export async function createVouchersBulk(
  userId: string,
  routerId: string,
  data: {
    profileId: string;
    count: number;
    usernamePrefix?: string;
    usernameLength?: number;
    passwordLength?: number;
    comment?: string;
    expiration?: string;
    simultaneousUse?: number;
  },
): Promise<VoucherInfo[]> {
  await verifyRouterOwnership(userId, routerId);
  const groupName = await verifyProfileOwnership(userId, data.profileId);

  const count = data.count;
  const usernameLength = data.usernameLength || 8;
  const passwordLength = data.passwordLength || 8;
  const prefix = data.usernamePrefix || '';

  // Generate unique usernames
  const credentials: Array<{ username: string; password: string }> = [];
  const usedUsernames = new Set<string>();

  for (let i = 0; i < count; i++) {
    let username: string;
    let attempts = 0;
    do {
      username = prefix + generateRandomString(usernameLength);
      attempts++;
      if (attempts > 100) {
        throw new AppError(500, 'Failed to generate unique usernames', 'USERNAME_GENERATION_FAILED');
      }
    } while (usedUsernames.has(username));

    usedUsernames.add(username);
    credentials.push({
      username,
      password: generateRandomString(passwordLength),
    });
  }

  // Verify none of the usernames already exist in radcheck
  const usernames = credentials.map((c) => c.username);
  const existingCheck = await pool.query(
    `SELECT DISTINCT username FROM radcheck WHERE username = ANY($1)`,
    [usernames],
  );
  if (existingCheck.rows.length > 0) {
    const taken = existingCheck.rows.map((r: { username: string }) => r.username);
    throw new AppError(409, `Username(s) already taken: ${taken.join(', ')}`, 'USERNAME_TAKEN');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const vouchers: VoucherMetaRow[] = [];

    for (const cred of credentials) {
      // Insert into voucher_meta
      const result = await client.query<VoucherMetaRow>(
        `INSERT INTO voucher_meta (user_id, router_id, radius_username, group_profile, comment, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING *`,
        [userId, routerId, cred.username, groupName, data.comment || null],
      );
      vouchers.push(result.rows[0]);

      // Insert RADIUS entries
      await insertRadiusEntries(client, cred.username, cred.password, groupName, data.expiration, data.simultaneousUse);
    }

    // Increment vouchers_used in subscription
    await client.query(
      `UPDATE subscriptions SET vouchers_used = vouchers_used + $1
       WHERE user_id = $2 AND status = 'active'`,
      [count, userId],
    );

    await client.query('COMMIT');

    logger.info('Vouchers created in bulk', {
      userId,
      routerId,
      count,
      groupProfile: groupName,
    });

    const voucherInfos: VoucherInfo[] = [];
    for (const v of vouchers) {
      voucherInfos.push(await toVoucherInfo(v));
    }
    return voucherInfos;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * List vouchers for a router with pagination and filtering.
 */
export async function getVouchersByRouter(
  userId: string,
  routerId: string,
  options: {
    status?: string;
    profileId?: string;
    page?: number;
    limit?: number;
    search?: string;
  } = {},
): Promise<VoucherListResult> {
  await verifyRouterOwnership(userId, routerId);

  const page = options.page || 1;
  const limit = options.limit || 20;
  const offset = (page - 1) * limit;

  const conditions: string[] = ['vm.user_id = $1', 'vm.router_id = $2'];
  const values: unknown[] = [userId, routerId];
  let paramIndex = 3;

  if (options.status) {
    conditions.push(`vm.status = $${paramIndex++}`);
    values.push(options.status);
  }

  if (options.profileId) {
    // Resolve profile group_name from profileId
    const profileResult = await pool.query(
      'SELECT group_name FROM radius_profiles WHERE id = $1 AND user_id = $2',
      [options.profileId, userId],
    );
    if (profileResult.rows.length > 0) {
      conditions.push(`vm.group_profile = $${paramIndex++}`);
      values.push(profileResult.rows[0].group_name);
    }
  }

  if (options.search) {
    conditions.push(`vm.radius_username ILIKE $${paramIndex++}`);
    values.push(`%${options.search}%`);
  }

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

  const vouchers: VoucherInfo[] = [];
  for (const row of result.rows) {
    vouchers.push(await toVoucherInfo(row));
  }

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
      // Remove any existing Auth-Type entry first
      await client.query(
        `DELETE FROM radcheck WHERE username = $1 AND attribute = 'Auth-Type'`,
        [username],
      );
      // Insert Auth-Type := Reject
      await client.query(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, $2, $3, $4)`,
        [username, 'Auth-Type', ':=', 'Reject'],
      );
    } else if (data.status === 'active' && voucher.status === 'disabled') {
      // Remove Auth-Type := Reject
      await client.query(
        `DELETE FROM radcheck WHERE username = $1 AND attribute = 'Auth-Type'`,
        [username],
      );
    }

    // Handle expiration update
    if (data.expiration !== undefined) {
      // Remove existing Expiration
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
 * Send a CoA Disconnect-Request to terminate active sessions for a username.
 * Uses radclient via CLI. Non-fatal if unavailable.
 */
async function sendCoaDisconnect(userId: string, routerId: string, username: string): Promise<void> {
  // Look up the router's NAS IP and RADIUS secret
  const routerResult = await pool.query(
    'SELECT tunnel_ip, radius_secret_enc FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId],
  );

  if (routerResult.rows.length === 0) return;

  const router = routerResult.rows[0];
  if (!router.tunnel_ip || !router.radius_secret_enc) return;

  // Check for active sessions in radacct
  const sessionResult = await pool.query(
    `SELECT acctsessionid FROM radacct
     WHERE username = $1 AND nasipaddress = $2 AND acctstoptime IS NULL`,
    [username, router.tunnel_ip],
  );

  if (sessionResult.rows.length === 0) return;

  // Import decrypt lazily to avoid circular dependencies
  const { decrypt } = await import('../utils/encryption');
  const radiusSecret = decrypt(router.radius_secret_enc);

  // Use radclient to send Disconnect-Request
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  for (const session of sessionResult.rows) {
    const coaCommand = `echo "Acct-Session-Id=${session.acctsessionid},User-Name=${username}" | radclient ${router.tunnel_ip}:3799 disconnect ${radiusSecret}`;
    try {
      await execAsync(coaCommand, { timeout: 5000 });
      logger.info('CoA disconnect sent', {
        username,
        sessionId: session.acctsessionid,
        nasIp: router.tunnel_ip,
      });
    } catch {
      logger.warn('radclient disconnect failed', {
        username,
        sessionId: session.acctsessionid,
      });
    }
  }
}
