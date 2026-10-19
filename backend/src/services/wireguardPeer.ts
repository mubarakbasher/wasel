import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import logger from '../config/logger';
import { pool } from '../config/database';
import { decrypt } from '../utils/encryption';

const execFileAsync = promisify(execFile);

const WG_INTERFACE = 'wg0';

/**
 * Parsed status of a single WireGuard peer from `wg show dump`.
 */
export interface WgPeerStatus {
  publicKey: string;
  presharedKey: string;       // base64 PSK, or "(none)" if no PSK was configured
  endpoint: string;           // e.g., "1.2.3.4:51820" or "(none)"
  allowedIps: string;         // e.g., "10.10.0.2/32"
  latestHandshake: number;    // Unix timestamp in seconds, 0 if never
  transferRx: number;         // bytes received
  transferTx: number;         // bytes transmitted
}

/**
 * Add a WireGuard peer to the running wg0 interface.
 *
 * Uses `wg set wg0 peer <publicKey> allowed-ips <routerIp>/32`.
 * If a preshared key is provided, it is written to a temporary file
 * (since `wg set` reads preshared keys from file), passed to the command,
 * and then securely deleted.
 *
 * @param params.publicKey - Base64-encoded public key of the peer
 * @param params.routerIp - Tunnel IP to assign (e.g., "10.10.0.2")
 * @param params.presharedKey - Optional base64-encoded preshared key
 */
export async function addPeer(params: {
  publicKey: string;
  routerIp: string;
  presharedKey?: string;
}): Promise<void> {
  const { publicKey, routerIp, presharedKey } = params;
  const args = ['set', WG_INTERFACE, 'peer', publicKey, 'allowed-ips', `${routerIp}/32`];

  let pskTempFile: string | null = null;

  try {
    if (presharedKey) {
      // Write preshared key to a temp file — wg set reads it from disk
      const randomSuffix = randomBytes(8).toString('hex');
      pskTempFile = join(tmpdir(), `wg_psk_${randomSuffix}`);
      // flag: 'wx' refuses to open if the path already exists, so a planted
      // file or symlink at this path (TOCTOU on tmpdir) cannot be used to
      // intercept the PSK or redirect our write.
      await writeFile(pskTempFile, presharedKey, { flag: 'wx', mode: 0o600 });
      args.push('preshared-key', pskTempFile);
    }

    await execFileAsync('wg', args);

    logger.info('WireGuard peer added', {
      publicKey: publicKey.substring(0, 8) + '...',
      routerIp,
      hasPresharedKey: !!presharedKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to add WireGuard peer', {
      publicKey: publicKey.substring(0, 8) + '...',
      routerIp,
      error: message,
    });
    throw new Error(`Failed to add WireGuard peer: ${message}`);
  } finally {
    // Always clean up the temp preshared key file
    if (pskTempFile) {
      try {
        await unlink(pskTempFile);
      } catch {
        logger.warn('Failed to delete temporary preshared key file', {
          path: pskTempFile,
        });
      }
    }
  }
}

/**
 * Remove a WireGuard peer from the wg0 interface.
 *
 * @param publicKey - Base64-encoded public key of the peer to remove
 */
export async function removePeer(publicKey: string): Promise<void> {
  try {
    await execFileAsync('wg', ['set', WG_INTERFACE, 'peer', publicKey, 'remove']);

    logger.info('WireGuard peer removed', {
      publicKey: publicKey.substring(0, 8) + '...',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to remove WireGuard peer', {
      publicKey: publicKey.substring(0, 8) + '...',
      error: message,
    });
    throw new Error(`Failed to remove WireGuard peer: ${message}`);
  }
}

/**
 * List all current peers and their status from `wg show wg0 dump`.
 *
 * The dump format has one header line (interface info) followed by one line
 * per peer with tab-separated fields:
 *   public-key, preshared-key, endpoint, allowed-ips, latest-handshake, transfer-rx, transfer-tx, persistent-keepalive
 *
 * @returns Array of parsed peer status objects
 */
export async function listPeers(): Promise<WgPeerStatus[]> {
  try {
    const { stdout } = await execFileAsync('wg', ['show', WG_INTERFACE, 'dump']);
    const lines = stdout.trim().split('\n');

    // First line is the interface itself; peer lines follow
    if (lines.length <= 1) {
      return [];
    }

    const peers: WgPeerStatus[] = [];

    for (let i = 1; i < lines.length; i++) {
      const fields = lines[i].split('\t');
      if (fields.length < 8) {
        logger.warn('Skipping malformed wg dump line', { line: lines[i] });
        continue;
      }

      peers.push({
        publicKey: fields[0],
        presharedKey: fields[1], // "(none)" or base64 PSK (sensitive — never log)
        endpoint: fields[2] === '(none)' ? '(none)' : fields[2],
        allowedIps: fields[3],
        latestHandshake: parseInt(fields[4], 10) || 0,
        transferRx: parseInt(fields[5], 10) || 0,
        transferTx: parseInt(fields[6], 10) || 0,
      });
    }

    return peers;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to list WireGuard peers', { error: message });
    throw new Error(`Failed to list WireGuard peers: ${message}`);
  }
}

/**
 * Get the status of a specific peer by public key.
 *
 * @param publicKey - Base64-encoded public key to look up
 * @returns The peer status, or null if no such peer exists
 */
export async function getPeerStatus(publicKey: string): Promise<WgPeerStatus | null> {
  const peers = await listPeers();
  return peers.find((p) => p.publicKey === publicKey) ?? null;
}

// Mirrors the 10.10.0.0/16 range of tunnel_subnet_pool — if that pool is ever
// renumbered, this regex must move with it.
/**
 * Regex for a per-router /30 host IP in the Wasel tunnel pool, e.g.
 * "10.10.0.2/32". Shared with the stale-peer safety net to refuse resets on
 * anything that is not a single-host router allowed-ips.
 */
const ROUTER_ALLOWED_IPS_RE = /^10\.10\.\d{1,3}\.\d{1,3}\/32$/;

/**
 * Canonical WireGuard key: 32 bytes base64-encoded = 44 chars ending in `=`.
 * The 43rd character is constrained by base64 padding (last 2 bits are zero),
 * so it must be one of `AEIMQUYcgkosw480`. We use the strict form for both
 * public keys and preshared keys. A `(none)` sentinel is accepted separately
 * for peers configured without a PSK.
 */
const WG_KEY_RE = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;

/**
 * Remove and immediately re-add a WireGuard peer with the same public key,
 * allowed-ips and preshared key.
 *
 * Why: WireGuard's kernel implementation stores a per-peer `latest_timestamp`
 * (TAI64N) from the last successful handshake, and silently drops any
 * subsequent handshake initiation whose timestamp is ≤ that stored value
 * (replay protection). When a router board without an RTC battery boots with
 * its clock hours in the past (power cut, NTP never ran) its initiations are
 * forever rejected until the server-side peer is torn down and re-added —
 * which resets the stored timestamp to zero. This helper performs exactly
 * that in-memory reset without touching wg0.conf (peers survive restart via
 * syncPeersFromDatabase).
 *
 * Safety:
 *   - allowed-ips is validated as a single-host /32 in the Wasel pool; the
 *     helper refuses to touch anything else (would silently nuke the wrong peer).
 *   - If the re-add fails after the remove succeeded, the peer is temporarily
 *     missing from the running interface. We log the tunnel IP loudly so an
 *     operator sees it, and note that the next backend restart will restore it
 *     via syncPeersFromDatabase().
 *   - Never log the preshared key. Public key is truncated to 8 chars to match
 *     the surrounding addPeer / removePeer log style.
 */
export async function resetPeer(params: {
  publicKey: string;
  allowedIps: string;         // from wg dump; must be a single "10.10.x.y/32"
  presharedKey: string;       // from wg dump; "(none)" means no PSK
}): Promise<void> {
  const { publicKey, allowedIps, presharedKey } = params;

  if (!ROUTER_ALLOWED_IPS_RE.test(allowedIps)) {
    logger.warn('WireGuard peer reset skipped: allowed-ips is not a single /32 in the Wasel pool', {
      publicKey: publicKey.substring(0, 8) + '...',
      allowedIps,
    });
    return;
  }

  const routerIp = allowedIps.split('/')[0];

  // Shape-check the keys BEFORE touching the kernel. The values flow in from
  // `wg show wg0 dump` which should always be well-formed, but if they ever
  // aren't (parse bug, corrupt dump) we must not pass them verbatim to
  // `wg set`, which could succeed on a mangled key and either delete the
  // wrong peer or add garbage. Mismatch → log + return, matching the
  // allowed-ips guard above.
  if (!WG_KEY_RE.test(publicKey)) {
    logger.warn('WireGuard peer reset skipped: public key does not match the WireGuard key shape', {
      publicKey: publicKey.substring(0, 8) + '...',
      tunnelIp: routerIp,
    });
    return;
  }

  if (presharedKey !== '(none)' && !WG_KEY_RE.test(presharedKey)) {
    // Deliberately do NOT log the PSK value — only the public key prefix and
    // tunnel IP are safe to surface.
    logger.warn('WireGuard peer reset skipped: preshared key is neither "(none)" nor a valid WireGuard key', {
      publicKey: publicKey.substring(0, 8) + '...',
      tunnelIp: routerIp,
    });
    return;
  }

  const psk = presharedKey !== '(none)' ? presharedKey : undefined;

  await removePeer(publicKey);

  try {
    await addPeer({ publicKey, routerIp, presharedKey: psk });
    logger.info('WireGuard peer reset (remove+add) to clear stale handshake timestamp', {
      publicKey: publicKey.substring(0, 8) + '...',
      routerIp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      'WireGuard peer reset: re-add FAILED after remove — peer is missing from wg0 ' +
        'until the next backend restart (syncPeersFromDatabase will restore it)',
      {
        publicKey: publicKey.substring(0, 8) + '...',
        routerIp,
        error: message,
      },
    );
    throw error;
  }
}

/**
 * Write the full wg0.conf content and reload the interface to persist
 * configuration changes across restarts.
 *
 * This performs:
 * 1. Write the config content to /etc/wireguard/wg0.conf
 * 2. Run `wg syncconf wg0 <(wg-quick strip wg0)` to reload without downtime
 *
 * Note: `wg syncconf` applies config changes to the running interface
 * without tearing it down, preserving existing sessions.
 *
 * @param configContent - Full contents of the wg0.conf file
 */
export async function syncConfigFile(configContent: string): Promise<void> {
  const configPath = '/etc/wireguard/wg0.conf';

  try {
    await writeFile(configPath, configContent, { mode: 0o600 });

    // wg syncconf reads a stripped config (no Address/DNS/etc.) and applies
    // peer changes without restarting the interface. We use wg-quick strip
    // to produce the stripped version from the full config.
    await execFileAsync('bash', [
      '-c',
      `wg syncconf ${WG_INTERFACE} <(wg-quick strip ${WG_INTERFACE})`,
    ]);

    logger.info('WireGuard config synced successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to sync WireGuard config', { error: message });
    throw new Error(`Failed to sync WireGuard config: ${message}`);
  }
}

/**
 * Restore all router peers from the database to the running wg0 interface.
 *
 * Called on backend startup to ensure peers survive container restarts.
 * Each peer is added individually; failures are logged but don't block others.
 */
export async function syncPeersFromDatabase(): Promise<void> {
  const result = await pool.query<{
    id: string;
    wg_public_key: string;
    tunnel_ip: string;
    wg_preshared_key_enc: string | null;
  }>(
    'SELECT id, wg_public_key, tunnel_ip, wg_preshared_key_enc FROM routers WHERE wg_public_key IS NOT NULL AND tunnel_ip IS NOT NULL'
  );

  const routers = result.rows;
  if (routers.length === 0) {
    logger.info('WireGuard peer sync: no routers to sync');
    return;
  }

  let synced = 0;
  let failed = 0;

  for (const router of routers) {
    try {
      const presharedKey = router.wg_preshared_key_enc
        ? decrypt(router.wg_preshared_key_enc)
        : undefined;

      await addPeer({
        publicKey: router.wg_public_key,
        routerIp: router.tunnel_ip,
        presharedKey,
      });
      synced++;
    } catch (error) {
      failed++;
      logger.error('WireGuard peer sync: failed to add peer', {
        routerId: router.id,
        tunnelIp: router.tunnel_ip,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('WireGuard peer sync complete', { total: routers.length, synced, failed });
}
