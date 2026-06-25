import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getTemplate } from '../hotspot-templates/manifest';
import { getTemplatesRootDir } from '../services/hotspotTemplate.service';

const router = Router();

// Allowed extra files beyond template.files (render-only / preview artefacts)
const EXTRA_ALLOWED = new Set(['preview.png', 'preview.html']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

/**
 * GET /public/hotspot-templates/:key/:file
 *
 * Streams a single file from a hotspot template bundle.
 *
 * Security:
 *   - :key must be a known template id (from the manifest); anything else → 404.
 *   - :file must appear in template.files OR be exactly "preview.png" / "preview.html".
 *   - Any :file containing '/', '\', or '..' is rejected before any path join.
 *   - The resolved path is confirmed to stay inside the templates root.
 */
router.get(
  '/hotspot-templates/:key/:file',
  (req: Request, res: Response): void => {
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

    // 7. Stream the file
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
