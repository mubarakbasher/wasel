import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import { MemoryStore } from 'express-rate-limit';

const { uploadRoot } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsMod = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('path') as typeof import('path');
  const root = fsMod.mkdtempSync(p.join(os.tmpdir(), 'wasel-receipt-limit-'));
  process.env.UPLOAD_DIR = root;
  return { uploadRoot: root };
});

// Force every receipt-upload limiter built by the real route to be enabled and memory-backed (the test below exhausts it).
vi.mock('../middleware/rateLimiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/rateLimiter')>();
  const store = new MemoryStore();
  return {
    ...actual,
    receiptUploadLimiter: actual.makeReceiptUploadLimiter({
      skip: () => false,
      store,
    }),
  };
});

import app from '../app';
import { makeReceiptUploadLimiter } from '../middleware/rateLimiter';
import { RECEIPTS_DIR } from '../middleware/upload';
import { authHeader } from './helpers';

function makeApp() {
  const a = express();
  a.use((req, _res, next) => {
    (req as unknown as { user: { id: string } }).user = { id: String(req.header('x-user')) };
    next();
  });
  a.use(makeReceiptUploadLimiter({ skip: () => false, store: new MemoryStore() }));
  a.post('/r', (_req, res) => res.json({ ok: true }));
  return a;
}

describe('makeReceiptUploadLimiter', () => {
  it('allows 10 per user, then 429 RATE_LIMIT_EXCEEDED; other users unaffected', async () => {
    const a = makeApp();
    for (let i = 0; i < 10; i++) {
      expect((await request(a).post('/r').set('x-user', 'u1')).status).toBe(200);
    }
    const res = await request(a).post('/r').set('x-user', 'u1');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect((await request(a).post('/r').set('x-user', 'u2')).status).toBe(200);
  });
});

describe('route order: limiter runs before multer', () => {
  beforeEach(() => {
    fs.rmSync(RECEIPTS_DIR, { recursive: true, force: true });
  });

  it('a rate-limited upload writes nothing to disk', async () => {
    // Exhaust the (memory-backed, enabled) limiter that the route uses.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/v1/subscription/receipt')
        .set(authHeader())
        .field('paymentId', '11111111-1111-4111-8111-111111111111')
        .attach('receipt', PNG, { filename: 'r.png', contentType: 'image/png' });
      last = res.status;
      if (i === 9) {
        // wipe whatever the first 10 wrote so only the limited request is measured
        fs.rmSync(RECEIPTS_DIR, { recursive: true, force: true });
      }
    }
    expect(last).toBe(429);
    // Only multer would recreate the (wiped) directory.
    expect(fs.existsSync(RECEIPTS_DIR)).toBe(false);
    expect(uploadRoot).toBeTruthy();
  });
});
