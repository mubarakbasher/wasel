import path from 'path';
import { pool } from '../config/database';
import { config } from '../config';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { connectToRouter, ensureHotspotRadiusSettings } from './routerOs.service';
import { HOTSPOT_TEMPLATE_DIR, getTemplate } from '../hotspot-templates/manifest';
import { RouterRow, RouterInfo } from './router.service';

// VPS wg0 address — the router reaches the backend over the WireGuard tunnel at
// this IP (the same constant used in router.service.ts for the RADIUS server).
// Template files are pulled over the tunnel rather than the public WAN: the tunnel
// is already encrypted + peer-authenticated, so no TLS/CA trust is needed on the
// router and there is no MITM surface for the login page that gets pushed.
const WG_SERVER_TUNNEL_IP = '10.10.0.1';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toRouterInfo(row: RouterRow): RouterInfo {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    model: row.model,
    rosVersion: row.ros_version,
    apiUser: row.api_user,
    wgPublicKey: row.wg_public_key,
    tunnelIp: row.tunnel_ip,
    nasIdentifier: row.nas_identifier,
    status: row.status,
    lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
    lastHealthCheckAt: row.last_health_check_at
      ? new Date(row.last_health_check_at).toISOString()
      : null,
    lastHealthReport: row.last_health_report ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    hotspotTemplateId: row.hotspot_template_id ?? null,
    hotspotTemplateStatus: row.hotspot_template_status ?? null,
    hotspotTemplateAppliedAt: row.hotspot_template_applied_at
      ? new Date(row.hotspot_template_applied_at).toISOString()
      : null,
    hotspotTemplateError: row.hotspot_template_error ?? null,
    hotspotAccentColor: row.hotspot_accent_color ?? null,
  };
}

async function persistStatus(
  routerId: string,
  patch: {
    status: 'pending' | 'applied' | 'failed';
    templateId?: string;
    accentColor?: string;
    error?: string | null;
    setAppliedAt?: boolean;
  },
): Promise<RouterRow> {
  const setClauses: string[] = [
    'hotspot_template_status = $1',
    'hotspot_template_error = $2',
    'updated_at = NOW()',
  ];
  const values: unknown[] = [patch.status, patch.error ?? null];
  let paramIndex = 3;

  if (patch.templateId !== undefined) {
    setClauses.push(`hotspot_template_id = $${paramIndex++}`);
    values.push(patch.templateId);
  }
  if (patch.accentColor !== undefined) {
    setClauses.push(`hotspot_accent_color = $${paramIndex++}`);
    values.push(patch.accentColor);
  }
  if (patch.setAppliedAt) {
    setClauses.push(`hotspot_template_applied_at = NOW()`);
  }

  values.push(routerId);
  const result = await pool.query<RouterRow>(
    `UPDATE routers SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Public service function
// ---------------------------------------------------------------------------

/**
 * Apply a hotspot login-page template to a router.
 *
 * Status lifecycle:
 *   → pending  (immediate, before touching the router)
 *   → applied  (all files fetched + html-directory updated)
 *   → failed   (any RouterOS error; returns the router row rather than throwing)
 *
 * Only 4xx validation / ownership errors are thrown — the caller returns those
 * as error responses. A RouterOS-level failure is swallowed and surfaced as
 * { hotspotTemplateStatus: 'failed', hotspotTemplateError: '...' } so the
 * mobile app can show "Failed – Retry" without receiving a 500.
 *
 * @param accentColor  Optional preset hex (e.g. '#0f766e'). When provided,
 *                     persisted in the SAME UPDATE as the pending status so the
 *                     public serve endpoint sees the new value immediately.
 *                     When omitted, the stored column is left unchanged.
 */
export async function applyHotspotTemplate(
  userId: string,
  routerId: string,
  templateId: string,
  accentColor?: string,
): Promise<RouterInfo> {
  // 1. Ownership check
  const ownerCheck = await pool.query<RouterRow>(
    'SELECT * FROM routers WHERE id = $1 AND user_id = $2',
    [routerId, userId],
  );
  if (ownerCheck.rows.length === 0) {
    throw new AppError(404, 'Router not found', 'ROUTER_NOT_FOUND');
  }

  // 2. Template existence check (4xx — the caller passed a bad id somehow)
  const template = getTemplate(templateId);
  if (!template) {
    throw new AppError(400, `Unknown template id: ${templateId}`, 'TEMPLATE_NOT_FOUND');
  }

  // 3. Persist pending immediately so the mobile app shows progress.
  //    If accentColor is provided, persist it in the SAME UPDATE so the
  //    public serve-time lookup sees the new value before any /tool/fetch runs.
  await persistStatus(routerId, {
    status: 'pending',
    templateId,
    ...(accentColor !== undefined && { accentColor }),
    error: null,
  });

  // 4. Connect to the router (circuit-breaker + retries inside connectToRouter)
  let client: import('routeros-client').RouterOSClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let api: any;

  try {
    ({ client, api } = await connectToRouter(routerId, userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('applyHotspotTemplate: could not connect to router', { routerId, error: msg });
    const row = await persistStatus(routerId, { status: 'failed', error: msg });
    return toRouterInfo(row);
  }

  try {
    // 5. Fetch each template file onto the router via /tool/fetch.
    // The router pulls over the WireGuard tunnel (plain HTTP to the VPS wg0 IP),
    // NOT the public WAN — the tunnel is encrypted and peer-authenticated, so the
    // pushed login page cannot be tampered with in transit and no router-side CA
    // trust is required.
    //
    // ?router=<uuid> is appended so the serve-time substitution picks up the
    // router's name and accent colour and bakes them into the fetched HTML files.
    const baseUrl = `http://${WG_SERVER_TUNNEL_IP}:${config.PORT}/api/v1/public/hotspot-templates/${templateId}`;

    for (const file of template.files) {
      const url = `${baseUrl}/${file}?router=${routerId}`;
      const dstPath = `${HOTSPOT_TEMPLATE_DIR}/${file}`;

      logger.info('Fetching hotspot template file onto router', { routerId, url, dstPath });

      // Invoke as menu `/tool` + command `fetch`. The routeros-client builds the
      // API sentence by appending the exec() verb to the menu path, so
      // `.menu('/tool/fetch').exec('run')` emits the command word `/tool/fetch/run`
      // — which RouterOS does not have, and answers with `!trap "no such command"`.
      // `fetch` IS the command under the `/tool` menu, so the valid sentence is
      // `/tool/fetch` (= menu `/tool` + command `fetch`) followed by the params.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fetchResult = await (api as any)
        .menu('/tool')
        .exec('fetch', {
          url,
          'dst-path': dstPath,
          mode: 'http',
        });

      // /tool/fetch streams progress updates (!re) in emission order —
      // connecting → downloading → a terminal `status=finished` or
      // `status=failed`. Reading only [0] inspects the FIRST line (usually
      // "connecting"), never the terminal state, so a mid-transfer failure
      // (404, reset, flash write error) would slip through and we'd point
      // html-directory at a directory missing this file. Treat the fetch as
      // failed if ANY update reports status=failed. A parse-time failure
      // instead rejects with !trap and is caught by the outer try/catch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates = Array.isArray(fetchResult) ? (fetchResult as any[]) : [];
      if (updates.some((u) => String(u?.status ?? '') === 'failed')) {
        throw new Error(`/tool/fetch failed for ${file} (status=failed)`);
      }
    }

    // 6. Point the hotspot's html-directory at the uploaded template.
    //
    // Theme the profile(s) the RUNNING hotspot servers actually use, NOT the
    // built-in "default" profile: `/ip hotspot setup` runs the server on a
    // generated profile (typically "hsprof1"), so theming "default" drops the
    // files but never changes the live login page. Query /ip/hotspot for the
    // servers and collect their profile names — that list is also the accurate
    // "is a hotspot configured?" signal, since every RouterOS device carries a
    // "default" profile even with no hotspot (so an empty *profile* list never
    // fires, but an empty *server* list does).
    //
    // NOTE ON .id: routeros-client strips the leading dot from returned keys
    // (treatMikrotikProperties → replace(/^\./,"")), so a fetched row exposes
    // `id`, not `.id`. Read `id ?? ['.id']` for safety. The `.where('.id', …)`
    // query arg is the on-the-wire field name and is unaffected — it stays dotted.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const servers = (await (api as any).menu('/ip/hotspot').get()) as Array<Record<string, unknown>>;

    if (!servers || servers.length === 0) {
      throw new Error('No hotspot configured on this router');
    }

    const serverProfileNames = [
      ...new Set(servers.map((s) => String(s.profile ?? '')).filter((n) => n.length > 0)),
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profiles = (await (api as any).menu('/ip/hotspot/profile').get()) as Array<Record<string, unknown>>;

    // Target the profiles the servers use; if none resolve (e.g. a server row
    // with an empty profile field), fall back to default-or-first so the apply
    // still themes something rather than silently no-op'ing.
    let targetProfiles = profiles.filter((p) => serverProfileNames.includes(String(p.name ?? '')));
    if (targetProfiles.length === 0) {
      const fallback =
        profiles.find((p) => String(p.name ?? '').toLowerCase() === 'default') ?? profiles[0];
      targetProfiles = fallback ? [fallback] : [];
    }
    if (targetProfiles.length === 0) {
      throw new Error('No hotspot configured on this router');
    }

    for (const profile of targetProfiles) {
      const profileId = String((profile.id ?? profile['.id']) ?? '');
      if (!profileId) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (api as any).menu('/ip/hotspot/profile').where('.id', profileId).update({
        'html-directory': HOTSPOT_TEMPLATE_DIR,
      });
    }

    // 6b. Best-effort: ensure RADIUS accounting + MAC-cookie on the SAME server
    //     profiles we just themed (not "default"). Never throws.
    await ensureHotspotRadiusSettings(api, { serverProfileNames });

    logger.info('Hotspot template applied successfully', { routerId, templateId });

    // 7. Persist success
    const row = await persistStatus(routerId, {
      status: 'applied',
      templateId,
      error: null,
      setAppliedAt: true,
    });
    return toRouterInfo(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('applyHotspotTemplate: RouterOS operation failed', { routerId, templateId, error: msg });
    const row = await persistStatus(routerId, { status: 'failed', error: msg });
    return toRouterInfo(row);
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore disconnect errors
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime path for static template files
// ---------------------------------------------------------------------------

/**
 * Returns the absolute filesystem path to the hotspot-templates directory.
 *
 * In dev (ts-node from src/): resolves to `<repo>/backend/src/hotspot-templates`.
 * In prod (compiled to dist/): the build script copies the directory to
 * `<repo>/backend/dist/hotspot-templates`; we resolve relative to __dirname
 * which will be `<repo>/backend/dist/services`, so `../hotspot-templates` lands
 * correctly in both environments.
 */
export function getTemplatesRootDir(): string {
  // __dirname is `src/services` (dev) or `dist/services` (prod).
  // One level up gives `src/` or `dist/`; then `hotspot-templates` is a
  // sibling of `services/` in both trees.
  return path.resolve(__dirname, '..', 'hotspot-templates');
}
