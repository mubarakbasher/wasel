/**
 * backfillWgEndpoint.ts — one-shot maintenance script
 *
 * Purpose
 * -------
 * Every router in the Wasel fleet has a WireGuard peer entry on its own
 * MikroTik pointing at the VPS. That peer's `endpoint-address` was set at
 * provisioning time from `config.WG_SERVER_ENDPOINT`. Historically that value
 * has been a raw IP (76.13.59.23), which means the whole fleet is pinned to
 * that IP — moving the VPS off it requires editing every router by hand.
 *
 * Going forward we point routers at a DNS hostname (e.g. wg.wa-sel.com) so a
 * single DNS record change repoints everyone. This script rewrites the
 * MikroTik-side `endpoint-address` on every existing router to whatever
 * WG_SERVER_ENDPOINT is currently set to on the backend.
 *
 * Safety model
 * ------------
 *   • DEFAULT is a dry run — connects, reads the current peer, prints what it
 *     would change, disconnects, changes nothing.
 *   • Set the CONFIRM=1 env var to actually write the change.
 *   • Processes routers sequentially — no concurrent writes to different
 *     routers in flight. Each router is wrapped in its own try/catch so one
 *     unreachable router does not abort the run.
 *   • Only the `endpoint-address` field is touched. `endpoint-port`,
 *     `allowed-address`, `public-key`, `preshared-key`, `persistent-keepalive`
 *     — nothing else is modified.
 *
 * Recommended sequence
 * --------------------
 *   1. Create the DNS record (e.g. `wg.wa-sel.com` -> current VPS IP) and
 *      wait for propagation (dig from the backend host).
 *   2. Update the backend `.env` on the VPS to
 *      `WG_SERVER_ENDPOINT=wg.wa-sel.com` and restart the backend so the new
 *      value is loaded. New routers provisioned after this will already get
 *      the hostname.
 *   3. Run this script against STAGING first, dry-run then CONFIRM=1.
 *   4. Verify a couple of staging routers still have a WireGuard handshake
 *      (via `wg show` / router status).
 *   5. Only then run against production, dry-run first, then CONFIRM=1.
 *
 * Usage
 * -----
 *   # dry run — prints what would change, writes nothing
 *   npx ts-node src/scripts/backfillWgEndpoint.ts
 *
 *   # actually apply — writes endpoint-address on every router
 *   CONFIRM=1 npx ts-node src/scripts/backfillWgEndpoint.ts
 *
 * Note on routeros-client field names
 * -----------------------------------
 * `.get()` strips the leading dot and camelCases keys, so the peer's public
 * key is `p.publicKey` (not `p['public-key']`) and its RouterOS ID is `p.id`
 * (not `p['.id']`). The `.update()` payload still expects the dashed keys
 * (`endpoint-address`), matching how RouterOS accepts writes.
 */
import { RouterOSClient } from 'routeros-client';
import { pool } from '../config/database';
import { config } from '../config';
import logger from '../config/logger';
import { decrypt } from '../utils/encryption';
import { verifyServerEndpointResolves } from '../services/wireguardConfig';

interface RouterRow {
  id: string;
  name: string;
  tunnel_ip: string | null;
  api_user: string | null;
  api_pass_enc: string | null;
  wg_public_key: string | null;
}

interface Result {
  routerId: string;
  name: string;
  status: 'skipped' | 'already-correct' | 'would-update' | 'updated' | 'failed';
  detail: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = any;

const CONFIRM = process.env.CONFIRM === '1';

/**
 * Extract just the host portion of WG_SERVER_ENDPOINT — mirrors parseEndpoint
 * in wireguardConfig.ts. The RouterOS peer's endpoint-port is set separately
 * at provision time and this script never touches it.
 */
function endpointHost(endpoint: string): string {
  const bracket = endpoint.match(/^\[(.+)\]:?\d*$/);
  if (bracket) return bracket[1];
  const lastColon = endpoint.lastIndexOf(':');
  if (lastColon === -1) return endpoint;
  return endpoint.substring(0, lastColon);
}

async function loadRouters(): Promise<RouterRow[]> {
  const res = await pool.query<RouterRow>(
    `SELECT id, name, tunnel_ip, api_user, api_pass_enc, wg_public_key
       FROM routers
      WHERE wg_public_key IS NOT NULL
        AND tunnel_ip     IS NOT NULL
        AND api_user      IS NOT NULL
        AND api_pass_enc  IS NOT NULL
      ORDER BY created_at ASC`,
  );
  return res.rows;
}

async function processRouter(
  row: RouterRow,
  targetHost: string,
  serverPubKey: string,
): Promise<Result> {
  if (!row.tunnel_ip || !row.api_user || !row.api_pass_enc) {
    return { routerId: row.id, name: row.name, status: 'skipped', detail: 'missing credentials' };
  }

  const password = decrypt(row.api_pass_enc);
  const client = new RouterOSClient({
    host: row.tunnel_ip,
    user: row.api_user,
    password,
    port: 8728,
    timeout: 5,
  });

  let api: Api;
  try {
    api = await client.connect();
  } catch (err) {
    return {
      routerId: row.id,
      name: row.name,
      status: 'failed',
      detail: `connect failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    // Read peers on the router; find the Wasel one by matching the server's
    // public key. Matching by public key is safer than by interface name in
    // case an operator renamed wg-wasel.
    const peers = (await api.menu('/interface/wireguard/peers').get()) as Array<
      Record<string, unknown>
    >;

    // routeros-client returns camelCase keys stripped of the leading dot,
    // but we also fall back to the raw dashed keys just in case some client
    // version behaves differently.
    const wasel = peers.find((p) => {
      const pk = String(p.publicKey ?? p['public-key'] ?? '');
      return pk === serverPubKey;
    });

    if (!wasel) {
      return {
        routerId: row.id,
        name: row.name,
        status: 'failed',
        detail: 'no peer matched WG_SERVER_PUBLIC_KEY',
      };
    }

    const peerId = String(wasel.id ?? wasel['.id'] ?? '');
    const currentEndpoint = String(wasel.endpointAddress ?? wasel['endpoint-address'] ?? '');

    if (currentEndpoint === targetHost) {
      return {
        routerId: row.id,
        name: row.name,
        status: 'already-correct',
        detail: `endpoint-address=${currentEndpoint}`,
      };
    }

    if (!CONFIRM) {
      return {
        routerId: row.id,
        name: row.name,
        status: 'would-update',
        detail: `dry-run: ${currentEndpoint} -> ${targetHost}`,
      };
    }

    // Only touch endpoint-address. Do NOT reset endpoint-port, allowed-address,
    // preshared-key, persistent-keepalive, or anything else on this peer.
    await api
      .menu('/interface/wireguard/peers')
      .where('.id', peerId)
      .update({ 'endpoint-address': targetHost });

    return {
      routerId: row.id,
      name: row.name,
      status: 'updated',
      detail: `${currentEndpoint} -> ${targetHost}`,
    };
  } catch (err) {
    return {
      routerId: row.id,
      name: row.name,
      status: 'failed',
      detail: `update failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}

async function main(): Promise<void> {
  const targetHost = endpointHost(config.WG_SERVER_ENDPOINT);
  const serverPubKey = config.WG_SERVER_PUBLIC_KEY;

  logger.info('backfillWgEndpoint starting', {
    targetHost,
    confirm: CONFIRM,
    mode: CONFIRM ? 'APPLY' : 'DRY-RUN',
  });

  // Sanity-check that the new endpoint resolves before we push it to routers.
  // Non-fatal — the check just logs a warning if it does not.
  await verifyServerEndpointResolves();

  const routers = await loadRouters();
  logger.info('backfillWgEndpoint: routers loaded', { count: routers.length });

  const results: Result[] = [];
  for (const row of routers) {
    const r = await processRouter(row, targetHost, serverPubKey);
    results.push(r);
    logger.info('backfillWgEndpoint: router processed', {
      routerId: r.routerId,
      name: r.name,
      status: r.status,
      detail: r.detail,
    });
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  logger.info('backfillWgEndpoint: summary', {
    total: results.length,
    ...summary,
    mode: CONFIRM ? 'APPLY' : 'DRY-RUN',
  });

  if (!CONFIRM) {
    logger.info(
      'DRY RUN complete — no changes were written. Re-run with CONFIRM=1 to apply.',
    );
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error('backfillWgEndpoint failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    try {
      await pool.end();
    } catch {
      // ignore
    }
    process.exit(1);
  });
