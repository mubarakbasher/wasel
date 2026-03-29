import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';

// ----- Interfaces -----

export interface ProfileRow {
  id: string;
  user_id: string;
  group_name: string;
  display_name: string;
  bandwidth_up: string | null;
  bandwidth_down: string | null;
  session_timeout: number | null;
  total_time: number | null;
  total_data: string | null; // BIGINT comes as string from pg
  created_at: Date;
  updated_at: Date;
}

export interface ProfileInfo {
  id: string;
  userId: string;
  groupName: string;
  displayName: string;
  bandwidthUp: string | null;
  bandwidthDown: string | null;
  sessionTimeout: number | null;
  totalTime: number | null;
  totalData: number | null;
  radiusAttributes: RadiusAttribute[];
  createdAt: string;
  updatedAt: string;
}

export interface RadiusAttribute {
  type: 'check' | 'reply';
  attribute: string;
  op: string;
  value: string;
}

// ----- Helpers -----

function toProfileInfo(row: ProfileRow, attrs: RadiusAttribute[] = []): ProfileInfo {
  return {
    id: row.id,
    userId: row.user_id,
    groupName: row.group_name,
    displayName: row.display_name,
    bandwidthUp: row.bandwidth_up,
    bandwidthDown: row.bandwidth_down,
    sessionTimeout: row.session_timeout,
    totalTime: row.total_time,
    totalData: row.total_data ? parseInt(row.total_data, 10) : null,
    radiusAttributes: attrs,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Build the Mikrotik-Rate-Limit string from upload/download values.
 * Format: "upload/download" e.g. "2M/5M"
 */
function buildRateLimit(up: string | null, down: string | null): string | null {
  if (!up && !down) return null;
  return `${up || '0'}/${down || '0'}`;
}

/**
 * Fetch RADIUS group attributes (check + reply) for a group name.
 */
async function getRadiusAttributes(groupName: string): Promise<RadiusAttribute[]> {
  const attrs: RadiusAttribute[] = [];

  const checkResult = await pool.query(
    'SELECT attribute, op, value FROM radgroupcheck WHERE groupname = $1',
    [groupName],
  );
  for (const row of checkResult.rows) {
    attrs.push({ type: 'check', attribute: row.attribute, op: row.op, value: row.value });
  }

  const replyResult = await pool.query(
    'SELECT attribute, op, value FROM radgroupreply WHERE groupname = $1',
    [groupName],
  );
  for (const row of replyResult.rows) {
    attrs.push({ type: 'reply', attribute: row.attribute, op: row.op, value: row.value });
  }

  return attrs;
}

// ----- Service Functions -----

/**
 * Create a new RADIUS group profile.
 * Inserts into radius_profiles + radgroupcheck + radgroupreply.
 */
export async function createProfile(
  userId: string,
  data: {
    groupName: string;
    displayName: string;
    bandwidthUp?: string;
    bandwidthDown?: string;
    sessionTimeout?: number;
    totalTime?: number;
    totalData?: number;
  },
): Promise<ProfileInfo> {
  // Check for duplicate group name for this user
  const existing = await pool.query(
    'SELECT id FROM radius_profiles WHERE user_id = $1 AND group_name = $2',
    [userId, data.groupName],
  );
  if (existing.rows.length > 0) {
    throw new AppError(409, `Profile with group name '${data.groupName}' already exists`, 'PROFILE_DUPLICATE');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert into radius_profiles
    const result = await client.query<ProfileRow>(
      `INSERT INTO radius_profiles (user_id, group_name, display_name, bandwidth_up, bandwidth_down, session_timeout, total_time, total_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        data.groupName,
        data.displayName,
        data.bandwidthUp || null,
        data.bandwidthDown || null,
        data.sessionTimeout ?? null,
        data.totalTime ?? null,
        data.totalData ?? null,
      ],
    );
    const profile = result.rows[0];

    // Insert radgroupcheck attributes
    if (data.totalTime != null && data.totalTime > 0) {
      await client.query(
        'INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES ($1, $2, $3, $4)',
        [data.groupName, 'Max-All-Session', ':=', String(data.totalTime)],
      );
    }

    if (data.totalData != null && data.totalData > 0) {
      await client.query(
        'INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES ($1, $2, $3, $4)',
        [data.groupName, 'Max-Total-Octets', ':=', String(data.totalData)],
      );
    }

    // Insert radgroupreply attributes
    const rateLimit = buildRateLimit(data.bandwidthUp || null, data.bandwidthDown || null);
    if (rateLimit) {
      await client.query(
        'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES ($1, $2, $3, $4)',
        [data.groupName, 'Mikrotik-Rate-Limit', ':=', rateLimit],
      );
    }

    if (data.sessionTimeout != null && data.sessionTimeout > 0) {
      await client.query(
        'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES ($1, $2, $3, $4)',
        [data.groupName, 'Session-Timeout', ':=', String(data.sessionTimeout)],
      );
    }

    await client.query('COMMIT');

    const attrs = await getRadiusAttributes(data.groupName);

    logger.info('RADIUS profile created', {
      profileId: profile.id,
      userId,
      groupName: data.groupName,
    });

    return toProfileInfo(profile, attrs);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * List all profiles for a user.
 */
export async function getProfilesByUser(userId: string): Promise<ProfileInfo[]> {
  const result = await pool.query<ProfileRow>(
    'SELECT * FROM radius_profiles WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );

  const profiles: ProfileInfo[] = [];
  for (const row of result.rows) {
    const attrs = await getRadiusAttributes(row.group_name);
    profiles.push(toProfileInfo(row, attrs));
  }

  return profiles;
}

/**
 * Get a single profile by ID with ownership check.
 */
export async function getProfileById(userId: string, profileId: string): Promise<ProfileInfo> {
  const result = await pool.query<ProfileRow>(
    'SELECT * FROM radius_profiles WHERE id = $1 AND user_id = $2',
    [profileId, userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Profile not found', 'PROFILE_NOT_FOUND');
  }

  const row = result.rows[0];
  const attrs = await getRadiusAttributes(row.group_name);
  return toProfileInfo(row, attrs);
}

/**
 * Update a RADIUS group profile.
 * Updates radius_profiles + replaces radgroupcheck/radgroupreply attributes.
 */
export async function updateProfile(
  userId: string,
  profileId: string,
  data: {
    displayName?: string;
    bandwidthUp?: string;
    bandwidthDown?: string;
    sessionTimeout?: number | null;
    totalTime?: number | null;
    totalData?: number | null;
  },
): Promise<ProfileInfo> {
  const existing = await pool.query<ProfileRow>(
    'SELECT * FROM radius_profiles WHERE id = $1 AND user_id = $2',
    [profileId, userId],
  );

  if (existing.rows.length === 0) {
    throw new AppError(404, 'Profile not found', 'PROFILE_NOT_FOUND');
  }

  const profile = existing.rows[0];
  const groupName = profile.group_name;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update radius_profiles fields
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.displayName !== undefined) {
      setClauses.push(`display_name = $${paramIndex++}`);
      values.push(data.displayName);
    }
    if (data.bandwidthUp !== undefined) {
      setClauses.push(`bandwidth_up = $${paramIndex++}`);
      values.push(data.bandwidthUp || null);
    }
    if (data.bandwidthDown !== undefined) {
      setClauses.push(`bandwidth_down = $${paramIndex++}`);
      values.push(data.bandwidthDown || null);
    }
    if (data.sessionTimeout !== undefined) {
      setClauses.push(`session_timeout = $${paramIndex++}`);
      values.push(data.sessionTimeout);
    }
    if (data.totalTime !== undefined) {
      setClauses.push(`total_time = $${paramIndex++}`);
      values.push(data.totalTime);
    }
    if (data.totalData !== undefined) {
      setClauses.push(`total_data = $${paramIndex++}`);
      values.push(data.totalData);
    }

    let updatedProfile = profile;
    if (setClauses.length > 0) {
      values.push(profileId);
      const updateResult = await client.query<ProfileRow>(
        `UPDATE radius_profiles SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values,
      );
      updatedProfile = updateResult.rows[0];
    }

    // Rebuild RADIUS group attributes (delete + re-insert)
    // Determine effective values (use updated if provided, else keep existing)
    const effectiveBwUp = data.bandwidthUp !== undefined ? (data.bandwidthUp || null) : profile.bandwidth_up;
    const effectiveBwDown = data.bandwidthDown !== undefined ? (data.bandwidthDown || null) : profile.bandwidth_down;
    const effectiveSessionTimeout = data.sessionTimeout !== undefined ? data.sessionTimeout : profile.session_timeout;
    const effectiveTotalTime = data.totalTime !== undefined ? data.totalTime : profile.total_time;
    const effectiveTotalData = data.totalData !== undefined ? data.totalData : (profile.total_data ? parseInt(profile.total_data, 10) : null);

    // Clear existing RADIUS attributes for this group
    await client.query('DELETE FROM radgroupcheck WHERE groupname = $1', [groupName]);
    await client.query('DELETE FROM radgroupreply WHERE groupname = $1', [groupName]);

    // Re-insert radgroupcheck
    if (effectiveTotalTime != null && effectiveTotalTime > 0) {
      await client.query(
        'INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES ($1, $2, $3, $4)',
        [groupName, 'Max-All-Session', ':=', String(effectiveTotalTime)],
      );
    }
    if (effectiveTotalData != null && effectiveTotalData > 0) {
      await client.query(
        'INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES ($1, $2, $3, $4)',
        [groupName, 'Max-Total-Octets', ':=', String(effectiveTotalData)],
      );
    }

    // Re-insert radgroupreply
    const rateLimit = buildRateLimit(effectiveBwUp, effectiveBwDown);
    if (rateLimit) {
      await client.query(
        'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES ($1, $2, $3, $4)',
        [groupName, 'Mikrotik-Rate-Limit', ':=', rateLimit],
      );
    }
    if (effectiveSessionTimeout != null && effectiveSessionTimeout > 0) {
      await client.query(
        'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES ($1, $2, $3, $4)',
        [groupName, 'Session-Timeout', ':=', String(effectiveSessionTimeout)],
      );
    }

    await client.query('COMMIT');

    const attrs = await getRadiusAttributes(groupName);

    logger.info('RADIUS profile updated', {
      profileId,
      userId,
      groupName,
    });

    return toProfileInfo(updatedProfile, attrs);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete a RADIUS group profile.
 * Fails if vouchers are still assigned to this profile via radusergroup.
 */
export async function deleteProfile(userId: string, profileId: string): Promise<void> {
  const existing = await pool.query<ProfileRow>(
    'SELECT * FROM radius_profiles WHERE id = $1 AND user_id = $2',
    [profileId, userId],
  );

  if (existing.rows.length === 0) {
    throw new AppError(404, 'Profile not found', 'PROFILE_NOT_FOUND');
  }

  const profile = existing.rows[0];
  const groupName = profile.group_name;

  // Check if vouchers are assigned to this profile
  const voucherCheck = await pool.query(
    'SELECT COUNT(*) as count FROM radusergroup WHERE groupname = $1',
    [groupName],
  );
  const assignedCount = parseInt(voucherCheck.rows[0].count, 10);

  if (assignedCount > 0) {
    throw new AppError(
      409,
      `Cannot delete profile: ${assignedCount} voucher(s) are still assigned to this profile`,
      'PROFILE_IN_USE',
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete RADIUS group attributes
    await client.query('DELETE FROM radgroupcheck WHERE groupname = $1', [groupName]);
    await client.query('DELETE FROM radgroupreply WHERE groupname = $1', [groupName]);

    // Delete the profile record
    await client.query('DELETE FROM radius_profiles WHERE id = $1', [profileId]);

    await client.query('COMMIT');

    logger.info('RADIUS profile deleted', {
      profileId,
      userId,
      groupName,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
