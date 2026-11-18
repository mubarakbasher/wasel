import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

const { uploadRoot } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsMod = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('path') as typeof import('path');
  const root = fsMod.mkdtempSync(p.join(os.tmpdir(), 'wasel-receipt-route-'));
  process.env.UPLOAD_DIR = root;
  return { uploadRoot: root };
});

import fs from 'fs';
import path from 'path';
import app from '../app';
import { RECEIPTS_DIR } from '../middleware/upload';
import { signReceiptUrl } from '../utils/receiptLinks';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const UID = '550e8400-e29b-41d4-a716-446655440000';
const A = `${UID}-1795000000000-abcdef12.png`;
const B = `${UID}-1700000000000.jpeg`;
const C = `${UID}-1795000000001-abcdef13.png`;
const GONE = `${UID}-1795000000002-abcdef14.png`;

function link(name: string): string {
  return signReceiptUrl(`/uploads/receipts/${name}`)!;
}

beforeAll(() => {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RECEIPTS_DIR, A), PNG);
  fs.writeFileSync(
    path.join(RECEIPTS_DIR, B),
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]),
  );
  fs.writeFileSync(path.join(RECEIPTS_DIR, C), 'this is not an image');
});

describe('GET /api/v1/receipts/:name', () => {
  it('serves a valid link with locked-down headers', async () => {
    const res = await request(app).get(link(A));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
  });

  it('serves a legacy .jpeg receipt by its sniffed type', async () => {
    const res = await request(app).get(link(B));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
  });

  it('refuses an expired, tampered or malformed link', async () => {
    const expired = signReceiptUrl(`/uploads/receipts/${A}`, Date.now() - 2 * 3600_000)!;
    const good = link(A);
    const flipped = good.replace(/sig=(.)/, (_m, c: string) => `sig=${c === 'A' ? 'B' : 'A'}`);
    const short = good.slice(0, -1);
    const missing = `/api/v1/receipts/${A}`;
    for (const url of [expired, flipped, short, missing]) {
      const res = await request(app).get(url);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    }
  });

  it('404 for a name outside the pattern', async () => {
    for (const name of ['x.html', '..%2F..%2Fetc%2Fpasswd', 'a.png']) {
      const res = await request(app).get(`/api/v1/receipts/${name}?exp=9999999999&sig=${'a'.repeat(43)}`);
      expect(res.status).toBe(404);
    }
  });

  it('404 when the signed file is missing or not an image', async () => {
    for (const name of [GONE, C]) {
      const res = await request(app).get(link(name));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('the old public path is gone', async () => {
    expect(RECEIPTS_DIR.startsWith(uploadRoot)).toBe(true);
    const res = await request(app).get(`/uploads/receipts/${A}`);
    expect(res.status).toBe(404);
  });
});

describe('bad percent-encoding in the receipt name', () => {
  it('answers 400 VALIDATION_ERROR, not 500', async () => {
    for (const bad of ['%zz', '%E0%A4%A']) {
      const res = await request(app).get(`/api/v1/receipts/${bad}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
