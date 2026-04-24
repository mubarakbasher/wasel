import { execFile } from 'child_process';
import { promisify } from 'util';
import { pool } from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { getPeerStatus } from './wireguardPeer';
import { connectToRouter, testConnection, listHotspotServers } from './routerOs.service';
import { sendAccessRequest } from './radclient.service';
import { provisionRouter, autoHealAllowed, recordAutoHeal } from './routerProvision.service';

const execFileAsync = promisify(execFile);

// ----- Types -----

export type ProbeStatus = 'pass' | 'fail' | 'skipped';

export interface ProbeResult {
  id: string;
  label: string;
  status: ProbeStatus;
  detail: string;
  remediation?: string;
  setupStep?: number;
  durationMs: number;
}

export interface RouterHealthReport {
  routerId: string;
  ranAt: string;
  overall: 'healthy' | 'degraded' | 'broken';
  probes: ProbeResult[];
}

// ----- Constants -----

/** WG handshake older than this means the tunnel is down. Matches wireguardMonitor.ts. */
const HANDSHAKE_TIMEOUT_S = 150;

/** Minimum spacing between health-check runs for the same router unless force=true. */
const RATE_LIMIT_MS = 30_000;

// ----- Rate-limit state (module-level) -----

const lastRunByRouter = new Map<string, number>();

// ----- DB row types -----

interface RouterHealthRow {
  id: string;
  tunnel_ip: string | null;
  wg_public_key: string | null;
  radius_secret_enc: string | null;
  last_health_check_at: Date | null;
  last_health_report: unknown;
  provision_applied_at: Date | null;
}

// ----- Internal probe helpers -----

async function timed<T extends Omit<ProbeResult, 'durationMs'>>(
  run: () => Promise<T>,
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const result = await run();
    return { ...result, durationMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: 'unknown',
      label: 'Probe crashed',
      status: 'fail',
      detail: `Probe threw: ${message}`,
      durationMs: Date.now() - started,
    };
  }
}

function skipped(id: string, label: string, reason: string, setupStep?: number): ProbeResult {
  return {
    id,
    label,
    status: 'skipped',
    detail: reason,
    ...(setupStep !== undefined ? { setupStep } : {}),
    durationMs: 0,
  };
}

// ----- Individual probes -----

async function probeNasRowPresent(tunnelIp: string): Promise<ProbeResult> {
  return timed(async () => {
    const result = await pool.query(
      'SELECT 1 AS present FROM nas WHERE nasname = $1 LIMIT 1',
      [tunnelIp],
    );
    const present = result.rows.length > 0;
    return {
      id: 'nasRowPresent',
      label: 'NAS client registered in database',
      status: present ? 'pass' : 'fail',
      detail: present
        ? `nas row found for ${tunnelIp}`
        : `No nas row for ${tunnelIp}`,
      remediation: present
        ? undefined
        : 'The NAS client row is missing — re-save the router in the app.',
    };
  });
}

async function probeWgHandshakeRecent(publicKey: string | null): Promise<ProbeResult> {
  return timed(async () => {
    if (!publicKey) {
      return {
        id: 'wgHandshakeRecent',
        label: 'WireGuard tunnel is up',
        status: 'fail',
        detail: 'Router has no WireGuard public key',
        remediation: 'Re-save the router so WireGuard keys are regenerated.',
      };
    }

    const peer = await getPeerStatus(publicKey);
    const now = Math.floor(Date.now() / 1000);
    if (!peer || peer.latestHandshake === 0) {
      return {
        id: 'wgHandshakeRecent',
        label: 'WireGuard tunnel is up',
        status: 'fail',
        detail: 'No WireGuard handshake recorded yet',
        remediation: 'WireGuard tunnel is not up — verify the router applied setup steps 1-3.',
      };
    }

    const ageS = now - peer.latestHandshake;
    const fresh = ageS <= HANDSHAKE_TIMEOUT_S;
    return {
      id: 'wgHandshakeRecent',
      label: 'WireGuard tunnel is up',
      status: fresh ? 'pass' : 'fail',
      detail: fresh
        ? `Handshake ${ageS}s ago`
        : `Last handshake was ${ageS}s ago (threshold ${HANDSHAKE_TIMEOUT_S}s)`,
      remediation: fresh
        ? undefined
        : 'WireGuard tunnel is not up — verify the router applied setup steps 1-3.',
    };
  });
}

async function probePingTunnel(tunnelIp: string): Promise<ProbeResult> {
  return timed(async () => {
    try {
      await execFileAsync('ping', ['-c', '3', '-W', '2', tunnelIp]);
      return {
        id: 'pingTunnel',
        label: 'Router responds over the tunnel',
        status: 'pass',
        detail: `ping ${tunnelIp} succeeded`,
      };
    } catch (error) {
      return {
        id: 'pingTunnel',
        label: 'Router responds over the tunnel',
        status: 'fail',
        detail: `ping ${tunnelIp} failed: ${error instanceof Error ? error.message : String(error)}`,
        remediation: 'Router is not responding over the tunnel — check the router is powered on and WireGuard is active.',
      };
    }
  });
}

async function probeRouterOsApiReachable(
  userId: string,
  routerId: string,
): Promise<ProbeResult> {
  return timed(async () => {
    const ok = await testConnection(routerId, userId);
    return {
      id: 'routerOsApiReachable',
      label: 'RouterOS API is reachable',
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? 'RouterOS API accepted the TCP/8728 connection'
        : 'Could not open RouterOS API connection over the tunnel',
      remediation: ok
        ? undefined
        : 'RouterOS API unreachable — verify api_user and api_pass are correct and /ip service api is enabled.',
    };
  });
}

async function probeHotspotUsesRadius(
  userId: string,
  routerId: string,
): Promise<ProbeResult> {
  return timed(async () => {
    const { client, api } = await connectToRouter(routerId, userId);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profiles = (await (api as any).menu('/ip/hotspot/profile').get()) as Array<
        Record<string, unknown>
      >;

      // Check the profile(s) actually used by active hotspot servers. Falling
      // back to 'default' when no hotspot server exists yet (bootstrap case).
      const servers = await listHotspotServers(api);
      const activeProfileNames = Array.from(
        new Set(
          servers
            .filter((s) => !s.disabled)
            .map((s) => s.profile)
            .filter((p): p is string => Boolean(p)),
        ),
      );
      const targetNames = activeProfileNames.length > 0 ? activeProfileNames : ['default'];
      const targetProfiles = targetNames
        .map((n) => profiles.find((p) => p.name === n))
        .filter((p): p is Record<string, unknown> => Boolean(p));

      if (targetProfiles.length === 0) {
        const fallback = profiles.find((p) => p.name === 'default') ?? profiles[0];
        if (!fallback) {
          return {
            id: 'hotspotUsesRadius',
            label: 'Hotspot profile uses RADIUS',
            status: 'fail',
            detail: 'No hotspot profile found on router',
            setupStep: 6,
            remediation: 'Run step 6 of the setup guide: `/ip hotspot profile set default use-radius=yes`.',
          };
        }
        targetProfiles.push(fallback);
      }

      const failing = targetProfiles.filter((p) => {
        const v = String(p['use-radius'] ?? '').toLowerCase();
        return v !== 'yes' && v !== 'true';
      });

      const ok = failing.length === 0;
      const names = targetProfiles.map((p) => String(p.name)).join(', ');
      const failNames = failing.map((p) => String(p.name)).join(', ');
      return {
        id: 'hotspotUsesRadius',
        label: 'Hotspot profile uses RADIUS',
        status: ok ? 'pass' : 'fail',
        detail: ok
          ? `Profile(s) "${names}" have use-radius=yes`
          : `Profile(s) "${failNames}" still have use-radius=no`,
        setupStep: 6,
        remediation: ok
          ? undefined
          : `Set use-radius=yes on the profile used by your hotspot server: \`/ip hotspot profile set [find name=${failNames.split(',')[0].trim()}] use-radius=yes\`.`,
      };
    } finally {
      try { await client.disconnect(); } catch { /* ignore */ }
    }
  });
}

async function probeRadiusClientConfigured(
  userId: string,
  routerId: string,
): Promise<ProbeResult> {
  return timed(async () => {
    const { client, api } = await connectToRouter(routerId, userId);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = (await (api as any).menu('/radius').get()) as Array<
        Record<string, unknown>
      >;

      const match = entries.find((e) => {
        const address = String(e.address ?? '');
        const service = String(e.service ?? '').toLowerCase();
        const secret = String(e.secret ?? '');
        return address === '10.10.0.1' && service.includes('hotspot') && secret.length > 0;
      });

      return {
        id: 'radiusClientConfigured',
        label: 'RADIUS client points at Wasel',
        status: match ? 'pass' : 'fail',
        detail: match
          ? `Found /radius entry with address=10.10.0.1 service=${match.service}`
          : 'No /radius entry with address=10.10.0.1, hotspot service, and a non-empty secret',
        setupStep: 5,
        remediation: match
          ? undefined
          : 'Run step 5 of the setup guide.',
      };
    } finally {
      try { await client.disconnect(); } catch { /* ignore */ }
    }
  });
}

/**
 * Parse a RouterOS firewall filter `dst-port` attribute — can be a single
 * port, a comma list (`1812,1813`), a range (`1812-1813`), or absent.
 */
function firewallPortMatches(raw: unknown, needle: number): boolean {
  if (raw === undefined || raw === null) return false;
  const text = String(raw);
  for (const part of text.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const dash = trimmed.indexOf('-');
    if (dash > 0) {
      const lo = parseInt(trimmed.slice(0, dash), 10);
      const hi = parseInt(trimmed.slice(dash + 1), 10);
      if (!Number.isNaN(lo) && !Number.isNaN(hi) && needle >= lo && needle <= hi) return true;
    } else {
      const single = parseInt(trimmed, 10);
      if (!Number.isNaN(single) && single === needle) return true;
    }
  }
  return false;
}

async function probeFirewallAllowsRadius(
  userId: string,
  routerId: string,
): Promise<ProbeResult> {
  return timed(async () => {
    const { client, api } = await connectToRouter(routerId, userId);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rules = (await (api as any).menu('/ip/firewall/filter').get()) as Array<
        Record<string, unknown>
      >;

      const required = [1812, 3799, 51820];
      const missing: number[] = [];

      for (const port of required) {
        const found = rules.some((r) => {
          const action = String(r.action ?? '').toLowerCase();
          const proto = String(r.protocol ?? '').toLowerCase();
          const disabled = String(r.disabled ?? 'false').toLowerCase() === 'true';
          if (disabled) return false;
          if (action !== 'accept') return false;
          if (proto && proto !== 'udp') return false;
          return firewallPortMatches(r['dst-port'], port);
        });
        if (!found) missing.push(port);
      }

      const ok = missing.length === 0;
      return {
        id: 'firewallAllowsRadius',
        label: 'Firewall allows RADIUS + WireGuard',
        status: ok ? 'pass' : 'fail',
        detail: ok
          ? 'UDP accept rules present for 1812, 3799, 51820'
          : `Missing UDP accept rule(s) for port(s): ${missing.join(', ')}`,
        setupStep: 7,
        remediation: ok
          ? undefined
          : 'Run step 7 of the setup guide.',
      };
    } finally {
      try { await client.disconnect(); } catch { /* ignore */ }
    }
  });
}

/**
 * Synthetic Access-Request to FreeRADIUS, signed with the `localhost` client's
 * shared secret (testing123, defined in freeradius/raddb/clients.conf). This
 * is a global health check on the FreeRADIUS service itself — it does NOT
 * verify the per-router secret because radclient runs from 127.0.0.1 and
 * FreeRADIUS authenticates the source IP, not the NAS-IP-Address attribute.
 *
 * The previous version of this probe signed with the per-router secret and
 * therefore always timed out (the source-IP-matched localhost client uses
 * testing123, not the router's secret). That false-negative was putting
 * every router into overall=broken and disabling the auto-heal path that
 * would otherwise re-provision routers stuck in a partial state.
 */
async function probeFreeradiusAlive(): Promise<ProbeResult> {
  return timed(async () => {
    const outcome = await sendAccessRequest({
      secret: 'testing123',
      nasIp: '127.0.0.1',
      username: '__wasel_healthcheck__',
      password: 'x',
      timeoutMs: 2_000,
    });

    if (outcome === 'reject') {
      return {
        id: 'freeradiusAlive',
        label: 'FreeRADIUS is alive and answering',
        status: 'pass',
        detail: 'FreeRADIUS responded with Access-Reject for the synthetic user — RADIUS service is healthy.',
      };
    }

    if (outcome === 'accept') {
      // Very unlikely — the synthetic user should never exist in radcheck.
      return {
        id: 'freeradiusAlive',
        label: 'FreeRADIUS is alive and answering',
        status: 'fail',
        detail: 'Unexpected Access-Accept for synthetic health-check user',
        remediation: 'Contact support — the probe user unexpectedly authenticated.',
      };
    }

    return {
      id: 'freeradiusAlive',
      label: 'FreeRADIUS is alive and answering',
      status: 'fail',
      detail: 'No RADIUS reply (timeout) — FreeRADIUS may be down or unreachable from the backend.',
      remediation: 'Check that the wasel-freeradius container is running and that radmin/radclient on the backend can reach 127.0.0.1:1812.',
    };
  });
}

async function probeHotspotServerBound(
  userId: string,
  routerId: string,
): Promise<ProbeResult> {
  return timed(async () => {
    let client: import('routeros-client').RouterOSClient | null = null;
    try {
      const conn = await connectToRouter(routerId, userId);
      client = conn.client;
      const servers = await listHotspotServers(conn.api);
      const active = servers.filter((s) => !s.disabled);
      const ok = active.length > 0;
      return {
        id: 'hotspotServerBound',
        label: 'Hotspot server is bound to an interface',
        status: ok ? 'pass' : 'fail',
        detail: ok
          ? `Hotspot server "${active[0].name}" bound to "${active[0].interface}"`
          : 'No enabled hotspot server found on router',
        remediation: ok
          ? undefined
          : 'No hotspot server is configured. The app will prompt you to confirm an interface for automatic setup.',
      };
    } catch {
      // API unreachable — skip rather than fail to avoid noise
      return {
        id: 'hotspotServerBound',
        label: 'Hotspot server is bound to an interface',
        status: 'skipped',
        detail: 'Skipped — RouterOS API unreachable',
      };
    } finally {
      if (client) {
        try { await client.disconnect(); } catch { /* ignore */ }
      }
    }
  });
}

// ----- Orchestrator -----

function computeOverall(probes: ProbeResult[]): RouterHealthReport['overall'] {
  const failedIds = new Set(
    probes.filter((p) => p.status === 'fail').map((p) => p.id),
  );

  // freeradiusAlive is a GLOBAL signal (whole-RADIUS-down) — intentionally
  // not in brokenIds because it's not per-router-actionable; auto-heal can't
  // fix FreeRADIUS being down and the failure surfaces via the probe label.
  const brokenIds = ['nasRowPresent', 'wgHandshakeRecent'];
  if (brokenIds.some((id) => failedIds.has(id))) return 'broken';

  if (failedIds.size > 0) return 'degraded';
  return 'healthy';
}

/**
 * Load the router row needed for the health check, scoped to the
 * authenticated user. Throws AppError(404) on mismatch.
 */
async function loadRouterForHealth(
  userId: string,
  routerId: string,
): Promise<RouterHealthRow> {
  const result = await pool.query<RouterHealthRow>(
    `SELECT id, tunnel_ip, wg_public_key, radius_secret_enc,
            last_health_check_at, last_health_report, provision_applied_at
       FROM routers
      WHERE id = $1 AND user_id = $2`,
    [routerId, userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }

  return result.rows[0];
}

async function persistReport(routerId: string, report: RouterHealthReport): Promise<void> {
  try {
    await pool.query(
      `UPDATE routers
          SET last_health_check_at = NOW(),
              last_health_report = $1::jsonb,
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(report), routerId],
    );
  } catch (error) {
    logger.warn('Failed to persist router health report', {
      routerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Run the 9-probe router health check in order, short-circuiting where
 * a failure makes later probes meaningless, and persist the result.
 *
 * Rate-limited to one run per 30 s per router unless `opts.force` is
 * set (used by the initial run fired from createRouter).
 */
export async function runHealthCheck(
  userId: string,
  routerId: string,
  opts?: { force?: boolean },
): Promise<RouterHealthReport> {
  const force = opts?.force === true;
  const now = Date.now();
  const last = lastRunByRouter.get(routerId);

  const router = await loadRouterForHealth(userId, routerId);

  // Non-forced callers (polling, initial page load) get the last persisted
  // report within the rate-limit window. Avoids hammering real probes and
  // the 429 UX we were showing on the mobile auto-config screen.
  if (!force && last !== undefined && now - last < RATE_LIMIT_MS) {
    const cached = router.last_health_report as RouterHealthReport | null;
    if (cached) return cached;
  }
  lastRunByRouter.set(routerId, now);

  if (!router.tunnel_ip) {
    throw new AppError(
      400,
      'Router is not fully provisioned — no tunnel IP',
      'ROUTER_NOT_CONFIGURED',
    );
  }

  const tunnelIp = router.tunnel_ip;
  const probes: ProbeResult[] = [];

  // Probe 1 — database nas row. Previously we also ran a
  // probeFreeradiusSeesNas here, but with the dynamic_clients path a
  // freshly-added NAS doesn't appear in `show clients` output until its
  // first real Access-Request, so the signal was misleading. The admin
  // /admin/freeradius/status endpoint still exposes `show clients` for
  // manual diagnostics.
  const p1 = await probeNasRowPresent(tunnelIp);
  probes.push(p1);

  // Short-circuit: no nas row = every other probe is meaningless.
  if (p1.status === 'fail') {
    const report: RouterHealthReport = {
      routerId,
      ranAt: new Date().toISOString(),
      overall: computeOverall(probes),
      probes,
    };
    await persistReport(routerId, report);
    return report;
  }

  // Probe 3 — WireGuard handshake
  const p3 = await probeWgHandshakeRecent(router.wg_public_key);
  probes.push(p3);

  // Probe 4 — tunnel reachability via ping
  probes.push(await probePingTunnel(tunnelIp));

  // Probe 5 — RouterOS API
  const p5 = await probeRouterOsApiReachable(userId, routerId);
  probes.push(p5);

  if (p5.status === 'fail') {
    probes.push(skipped(
      'hotspotUsesRadius',
      'Hotspot profile uses RADIUS',
      'Skipped — RouterOS API unreachable',
      6,
    ));
    probes.push(skipped(
      'radiusClientConfigured',
      'RADIUS client points at Wasel',
      'Skipped — RouterOS API unreachable',
      5,
    ));
    probes.push(skipped(
      'firewallAllowsRadius',
      'Firewall allows RADIUS + WireGuard',
      'Skipped — RouterOS API unreachable',
      7,
    ));
  } else {
    probes.push(await probeHotspotUsesRadius(userId, routerId));
    probes.push(await probeRadiusClientConfigured(userId, routerId));
    probes.push(await probeFirewallAllowsRadius(userId, routerId));
  }

  // Probe 9 — FreeRADIUS alive (global signal via localhost client)
  probes.push(await probeFreeradiusAlive());

  // Probe 10 — hotspot server bound (skipped if API unreachable)
  if (p5.status === 'fail') {
    probes.push(skipped(
      'hotspotServerBound',
      'Hotspot server is bound to an interface',
      'Skipped — RouterOS API unreachable',
    ));
  } else {
    probes.push(await probeHotspotServerBound(userId, routerId));
  }

  const report: RouterHealthReport = {
    routerId,
    ranAt: new Date().toISOString(),
    overall: computeOverall(probes),
    probes,
  };

  await persistReport(routerId, report);

  logger.info('Router health check complete', {
    routerId,
    overall: report.overall,
    failed: probes.filter((p) => p.status === 'fail').map((p) => p.id),
  });

  // Auto-heal hook: fire whenever the router isn't healthy AND the API is
  // reachable AND provisioning would actually help. Previously gated on
  // `=== 'degraded'` only, which was fatally combined with the broken
  // synthRadiusAuth probe forcing every router into 'broken' — so auto-heal
  // never fired in production.
  if (
    report.overall !== 'healthy' &&
    p5.status === 'pass' &&
    autoHealAllowed(routerId)
  ) {
    const failedIds = new Set(probes.filter((p) => p.status === 'fail').map((p) => p.id));
    const provisionNeeded =
      router.provision_applied_at === null ||
      failedIds.has('radiusClientConfigured') ||
      failedIds.has('hotspotUsesRadius') ||
      failedIds.has('firewallAllowsRadius');

    if (provisionNeeded) {
      recordAutoHeal(routerId);
      logger.info('Auto-heal: triggering re-provision', { routerId, userId });
      void provisionRouter(userId, routerId, { trigger: 'auto-heal' });
    }
  }

  return report;
}
