/**
 * routerProvision.service.ts
 *
 * Orchestrates Stage-2 auto-provisioning: opens a RouterOS API session via
 * the WireGuard tunnel and idempotently applies RADIUS, CoA, hotspot profile,
 * and firewall rules.
 */

import { pool } from '../config/database';
import logger from '../config/logger';
import { decrypt } from '../utils/encryption';
import {
  connectToRouter,
  upsertByComment,
  setSingleton,
  listHotspotServers,
  ensureWgInLanList,
} from './routerOs.service';
import { getPeerStatus } from './wireguardPeer';
import { testConnection } from './routerOs.service';
import {
  radiusClientCommand,
  coaListenerCommand,
  hotspotProfileCommand,
  hotspotUserProfileDefaultsCommand,
  firewallRadiusAuthCommand,
  firewallRadiusCoaCommand,
  firewallWgCommand,
} from './routerProvisionCommands';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProvisionTrigger = 'post-add' | 'manual' | 'auto-heal';

export interface StepError {
  step: string;
  error: string;
}

export interface ProvisionResult {
  status: 'succeeded' | 'partial' | 'failed';
  errors: StepError[];
}

// ---------------------------------------------------------------------------
// In-process poller state — keyed by routerId
// ---------------------------------------------------------------------------

const pollerMap = new Map<string, NodeJS.Timeout>();

/** Per-router cooldown for auto-heal (10 min) */
const autoHealCooldown = new Map<string, number>();
const AUTO_HEAL_COOLDOWN_MS = 10 * 60 * 1000;

const HANDSHAKE_TIMEOUT_S = 150;

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface RouterProvisionRow {
  id: string;
  user_id: string;
  tunnel_ip: string | null;
  wg_public_key: string | null;
  radius_secret_enc: string | null;
  provision_applied_at: Date | null;
}

async function loadProvisionRow(routerId: string, userId: string): Promise<RouterProvisionRow> {
  const result = await pool.query<RouterProvisionRow>(
    `SELECT id, user_id, tunnel_ip, wg_public_key, radius_secret_enc,
            provision_applied_at
       FROM routers
      WHERE id = $1 AND user_id = $2`,
    [routerId, userId],
  );
  if (result.rows.length === 0) {
    throw new Error(`Router ${routerId} not found for user ${userId}`);
  }
  return result.rows[0];
}

async function setProvisionStatus(
  routerId: string,
  status: string,
  errors: StepError[],
  extra: Partial<{
    provision_applied_at: string;
  }> = {},
): Promise<void> {
  const sets: string[] = [
    `last_provision_status = $1`,
    `last_provision_error = $2::jsonb`,
    `last_provision_at = NOW()`,
  ];
  const values: unknown[] = [status, JSON.stringify(errors)];
  let idx = 3;

  if (extra.provision_applied_at !== undefined) {
    sets.push(`provision_applied_at = $${idx++}`);
    values.push(extra.provision_applied_at);
  }

  values.push(routerId);
  await pool.query(
    `UPDATE routers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
    values,
  );
}

// ---------------------------------------------------------------------------
// Core provisioner
// ---------------------------------------------------------------------------

/**
 * Apply all Stage-2 provisioning steps to the router identified by routerId.
 * Each step is wrapped in try/catch; failures are collected but do not stop
 * subsequent steps — this surfaces all misconfigs at once.
 *
 * The function is idempotent: re-running converges, never duplicates.
 */
export async function provisionRouter(
  userId: string,
  routerId: string,
  opts: { trigger: ProvisionTrigger },
): Promise<ProvisionResult> {
  logger.info('Starting router provision', { routerId, userId, trigger: opts.trigger });

  await setProvisionStatus(routerId, 'in_progress', []);

  const errors: StepError[] = [];

  let rowData: RouterProvisionRow;
  try {
    rowData = await loadProvisionRow(routerId, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setProvisionStatus(routerId, 'failed', [{ step: 'load', error: msg }]);
    return { status: 'failed', errors: [{ step: 'load', error: msg }] };
  }

  if (!rowData.radius_secret_enc || !rowData.tunnel_ip) {
    const msg = 'Router missing radius secret or tunnel IP';
    await setProvisionStatus(routerId, 'failed', [{ step: 'load', error: msg }]);
    return { status: 'failed', errors: [{ step: 'load', error: msg }] };
  }

  const radiusSecret = decrypt(rowData.radius_secret_enc);
  const tunnelIp = rowData.tunnel_ip;
  const radiusServerIp = '10.10.0.1';

  let client: import('routeros-client').RouterOSClient | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let api: any = null;

  try {
    const conn = await connectToRouter(routerId, userId);
    client = conn.client;
    api = conn.api;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Provision: could not connect to router API', { routerId, error: msg });
    await setProvisionStatus(routerId, 'failed', [{ step: 'connect', error: msg }]);
    return { status: 'failed', errors: [{ step: 'connect', error: msg }] };
  }

  // Helper to run a labelled step, catching and collecting errors
  async function runStep(name: string, fn: () => Promise<void>): Promise<boolean> {
    try {
      await fn();
      logger.debug('Provision step succeeded', { routerId, step: name });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Provision step failed', { routerId, step: name, error: msg });
      errors.push({ step: name, error: msg });
      return false;
    }
  }

  // Step 1: RADIUS client entry
  await runStep('radius', async () => {
    const cmd = radiusClientCommand({ radiusServerIp, radiusSecret, tunnelIp });
    await upsertByComment(api, cmd.menu, cmd.commentTag, cmd.desired);
  });

  // Step 2: CoA listener
  await runStep('coaListener', async () => {
    const cmd = coaListenerCommand();
    await setSingleton(api, cmd.menu, cmd.matcher, cmd.args);
  });

  // Step 3: Hotspot profile — use-radius=yes
  // We set 'default' PLUS every profile referenced by an active hotspot
  // server. RouterOS's `/ip hotspot setup` wizard creates a non-default
  // profile (commonly hsprof1) and binds the server to THAT, so touching
  // only 'default' is a no-op on any router configured via the wizard.
  await runStep('hotspotProfile', async () => {
    const cmd = hotspotProfileCommand();
    // Always set 'default' as the fallback/bootstrap case.
    try {
      await setSingleton(api, cmd.menu, cmd.matcher, cmd.args);
    } catch (err) {
      // Some RouterOS versions reject radius-interim-update=received. Retry
      // without it so use-radius=yes still lands.
      logger.warn('hotspotProfile: full set failed on default, retrying with use-radius only', {
        routerId,
        error: err instanceof Error ? err.message : String(err),
      });
      await setSingleton(api, cmd.menu, cmd.matcher, { 'use-radius': 'yes' });
    }

    // Also set every profile that an active hotspot server is actually using.
    const servers = await listHotspotServers(api);
    const activeProfiles = Array.from(
      new Set(
        servers
          .filter((s) => !s.disabled)
          .map((s) => s.profile)
          .filter((p): p is string => Boolean(p) && p !== 'default'),
      ),
    );
    for (const profileName of activeProfiles) {
      try {
        await setSingleton(api, '/ip/hotspot/profile', { name: profileName }, cmd.args);
      } catch {
        await setSingleton(api, '/ip/hotspot/profile', { name: profileName }, { 'use-radius': 'yes' });
      }
      logger.info('Provision: set use-radius=yes on active hotspot profile', {
        routerId,
        profile: profileName,
      });
    }
  });

  // Step 4: Hotspot user profile defaults
  await runStep('hotspotUserProfile', async () => {
    const cmd = hotspotUserProfileDefaultsCommand();
    await setSingleton(api, cmd.menu, cmd.matcher, cmd.args);
  });

  // Step 5: Firewall — RADIUS auth
  await runStep('firewallRadiusAuth', async () => {
    const cmd = firewallRadiusAuthCommand({ radiusServerIp });
    await upsertByComment(api, cmd.menu, cmd.commentTag, cmd.desired);
  });

  // Step 6: Firewall — RADIUS CoA
  await runStep('firewallRadiusCoa', async () => {
    const cmd = firewallRadiusCoaCommand({ radiusServerIp });
    await upsertByComment(api, cmd.menu, cmd.commentTag, cmd.desired);
  });

  // Step 7: Firewall — WireGuard
  await runStep('firewallWg', async () => {
    const cmd = firewallWgCommand();
    await upsertByComment(api, cmd.menu, cmd.commentTag, cmd.desired);
  });

  // Step 7b: add wg-wasel to the LAN interface list so the default
  // /ip/firewall/filter drop !LAN rule doesn't block CoA traffic from Wasel.
  // No-op if the router doesn't use a LAN interface list.
  await runStep('wgInterfaceList', async () => {
    const result = await ensureWgInLanList(api);
    logger.debug('ensureWgInLanList', { routerId, result });
  });

  // Disconnect
  try {
    await client.disconnect();
  } catch {
    // ignore
  }

  // Determine final status
  const succeeded = errors.length === 0;
  const finalStatus = succeeded ? 'succeeded' : errors.length === 8 ? 'failed' : 'partial';

  const extra: Parameters<typeof setProvisionStatus>[3] = {};
  if (succeeded) {
    extra.provision_applied_at = new Date().toISOString();
  }

  await setProvisionStatus(routerId, finalStatus, errors, extra);

  logger.info('Router provision complete', {
    routerId,
    trigger: opts.trigger,
    status: finalStatus,
    errorCount: errors.length,
  });

  return { status: finalStatus, errors };
}

// ---------------------------------------------------------------------------
// Post-add poller
// ---------------------------------------------------------------------------

/**
 * Schedule a background poller that waits for the WireGuard handshake to
 * appear (up to 5 min, 10s cadence) and then calls provisionRouter.
 *
 * Keyed by routerId so at most one poller runs per router at any time.
 * Crash-safe: on restart, the health-check auto-heal hook picks up any
 * routers that missed provisioning.
 */
export function schedulePostAddProvision(routerId: string, userId: string): void {
  // Cancel any existing poller for this router
  const existing = pollerMap.get(routerId);
  if (existing) {
    clearTimeout(existing);
    pollerMap.delete(routerId);
  }

  const MAX_TICKS = 30;
  const INTERVAL_MS = 10_000;
  let ticks = 0;

  logger.info('Post-add provision poller started', { routerId, userId });

  async function tick(): Promise<void> {
    ticks++;

    try {
      // Reload the public key from DB on every tick (it won't change, but
      // defensive against very early ticks before the row is fully written).
      const result = await pool.query<{ wg_public_key: string | null }>(
        'SELECT wg_public_key FROM routers WHERE id = $1',
        [routerId],
      );
      const publicKey = result.rows[0]?.wg_public_key ?? null;

      // Check WireGuard handshake
      let handshakeOk = false;
      if (publicKey) {
        const peer = await getPeerStatus(publicKey);
        const now = Math.floor(Date.now() / 1000);
        if (peer && peer.latestHandshake > 0 && now - peer.latestHandshake <= HANDSHAKE_TIMEOUT_S) {
          handshakeOk = true;
        }
      }

      if (handshakeOk) {
        // Also verify the API is reachable before provisioning
        const apiOk = await testConnection(routerId, userId);
        if (apiOk) {
          pollerMap.delete(routerId);
          logger.info('Post-add poller: WG + API ready, starting provision', { routerId, ticks });
          void provisionRouter(userId, routerId, { trigger: 'post-add' });
          return;
        }
      }
    } catch (err) {
      // Non-fatal — keep polling
      logger.debug('Post-add poller tick error (non-fatal)', {
        routerId,
        ticks,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (ticks >= MAX_TICKS) {
      pollerMap.delete(routerId);
      logger.warn('Post-add provision poller timed out — no WG handshake in 5 min', { routerId });
      void setProvisionStatus(routerId, 'failed', [
        { step: 'waitForHandshake', error: 'No WireGuard handshake seen in 5 minutes' },
      ]);
      return;
    }

    // Schedule next tick
    const handle = setTimeout(() => void tick(), INTERVAL_MS);
    pollerMap.set(routerId, handle);
  }

  // First tick after initial delay
  const handle = setTimeout(() => void tick(), INTERVAL_MS);
  pollerMap.set(routerId, handle);
}

// ---------------------------------------------------------------------------
// Auto-heal gate helper (used by routerHealth.service.ts)
// ---------------------------------------------------------------------------

/**
 * Returns true if an auto-heal provision run is allowed for this router
 * (i.e. last run was more than 10 min ago).  Call BEFORE provisionRouter.
 */
export function autoHealAllowed(routerId: string): boolean {
  const last = autoHealCooldown.get(routerId);
  if (last === undefined) return true;
  return Date.now() - last > AUTO_HEAL_COOLDOWN_MS;
}

/**
 * Record that an auto-heal provision run was just triggered.
 */
export function recordAutoHeal(routerId: string): void {
  autoHealCooldown.set(routerId, Date.now());
}
