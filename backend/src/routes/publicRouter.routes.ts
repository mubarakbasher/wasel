import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getTemplate } from '../hotspot-templates/manifest';
import { getTemplatesRootDir } from '../services/hotspotTemplate.service';
import { pool } from '../config/database';
import logger from '../config/logger';
import { resolveAccent, substituteTemplateTokens } from '../services/hotspotTemplateRender';

const router = Router();

// Allowed extra files beyond template.files (render-only / preview artefacts)
const EXTRA_ALLOWED = new Set(['preview.png', 'preview.html']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// UUID v4 regex — must be validated BEFORE any DB call to prevent DB noise from
// arbitrary string inputs.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Defaults used when no/invalid router context is available.
const DEFAULT_ROUTER_NAME = 'Guest Wi-Fi';

/**
 * GET /public/hotspot-templates/:key/:file
 *
 * Streams (or substitutes + sends) a single file from a hotspot template bundle.
 *
 * Security:
 *   - :key must be a known template id (from the manifest); anything else → 404.
 *   - :file must appear in template.files OR be exactly "preview.png" / "preview.html".
 *   - Any :file containing '/', '\', or '..' is rejected before any path join.
 *   - The resolved path is confirmed to stay inside the templates root.
 *
 * HTML files:
 *   Read with fs.promises.readFile, substitute %WASEL_*% tokens from the router
 *   row identified by ?router=<uuid>, then send with Cache-Control: no-store so
 *   every MikroTik hotspot client gets fresh branding on each page load.
 *
 * Non-HTML files:
 *   Streamed with long-lived cache headers (fonts/scripts: 1 day; images: 5 min).
 */
router.get(
  '/hotspot-templates/:key/:file',
  async (req: Request, res: Response): Promise<void> => {
    // Express v5 types have params as string | string[]; coerce to string.
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const file = Array.isArray(req.params.file) ? req.params.file[0] : req.params.file;

    // 1. Validate key against the manifest
    const template = getTemplate(key);
    if (!template) {
      res.status(404).json({ success: false, error: { message: 'Template not found', code: 'NOT_FOUND' } });
      return;
    }

    // 2. Reject traversal characters before any path join
    if (file.includes('/') || file.includes('\\') || file.includes('..')) {
      res.status(404).json({ success: false, error: { message: 'File not found', code: 'NOT_FOUND' } });
      return;
    }

    // 3. Whitelist: must be in template.files OR one of the extra-allowed names
    if (!template.files.includes(file) && !EXTRA_ALLOWED.has(file)) {
      res.status(404).json({ success: false, error: { message: 'File not found', code: 'NOT_FOUND' } });
      return;
    }

    // 4. Resolve path and confirm it stays inside the templates root (belt-and-suspenders)
    const templatesRoot = getTemplatesRootDir();
    const filePath = path.resolve(templatesRoot, key, file);
    if (!filePath.startsWith(templatesRoot + path.sep) && filePath !== templatesRoot) {
      res.status(404).json({ success: false, error: { message: 'File not found', code: 'NOT_FOUND' } });
      return;
    }

    // 5. Confirm file exists
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: { message: 'File not found', code: 'NOT_FOUND' } });
      return;
    }

    // 6. Set Content-Type from extension
    const ext = path.extname(file).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    // 7a. HTML files: read → resolve router context → substitute tokens → send
    if (ext === '.html') {
      try {
        const html = await fs.promises.readFile(filePath, 'utf8');

        // Resolve router context from ?router=<uuid> query param.
        // UUID must be validated BEFORE any DB call — malformed params are
        // silently ignored (use defaults) and generate no DB queries.
        const routerParam = Array.isArray(req.query.router)
          ? req.query.router[0]
          : req.query.router;

        let routerName = DEFAULT_ROUTER_NAME;
        let storedAccent: string | null = null;

        if (typeof routerParam === 'string' && UUID_REGEX.test(routerParam)) {
          try {
            const result = await pool.query<{ name: string; hotspot_accent_color: string | null }>(
              'SELECT name, hotspot_accent_color FROM routers WHERE id = $1',
              [routerParam],
            );
            if (result.rows.length > 0) {
              routerName = result.rows[0].name;
              storedAccent = result.rows[0].hotspot_accent_color;
            }
          } catch (dbErr) {
            // DB errors use defaults — a failing DB lookup must never cause a 5xx;
            // the router's /tool/fetch must always succeed so the login page loads.
            logger.warn('publicRouter: DB error resolving router context', {
              routerId: routerParam,
              error: dbErr instanceof Error ? dbErr.message : String(dbErr),
            });
          }
        }

        const accentHex = resolveAccent(key, storedAccent);
        const substituted = substituteTemplateTokens(html, { name: routerName, accentHex });

        res.setHeader('Cache-Control', 'no-store');
        res.send(substituted);
      } catch (err) {
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: { message: 'Failed to read file', code: 'READ_ERROR' } });
        }
      }
      return;
    }

    // 7b. Non-HTML files: add cache headers and stream
    if (ext === '.woff2' || ext === '.js') {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (ext === '.png') {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: { message: 'Failed to read file', code: 'READ_ERROR' } });
      }
    });
    stream.pipe(res);
  },
);

export default router;
