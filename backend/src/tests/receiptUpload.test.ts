import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';

const { uploadRoot } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsMod = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('path') as typeof import('path');
  const root = fsMod.mkdtempSync(p.join(os.tmpdir(), 'wasel-receipts-'));
  process.env.UPLOAD_DIR = root;
  return { uploadRoot: root };
});

vi.mock('../services/email.service', () => ({
  sendPaymentSubmittedAdminAlert: vi.fn().mockResolvedValue(undefined),
}));

import app from '../app';
import { RECEIPTS_DIR } from '../middleware/upload';
import { TEST_USER, authHeader } from './helpers';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';

function files(): string[] {
  return fs.existsSync(RECEIPTS_DIR) ? fs.readdirSync(RECEIPTS_DIR) : [];
}

function post(paymentId = PAYMENT_ID) {
  return request(app).post('/api/v1/subscription/receipt').set(authHeader()).field('paymentId', paymentId);
}

beforeEach(() => {
  mockQuery.mockReset();
  for (const f of files()) fs.unlinkSync(`${RECEIPTS_DIR}/${f}`);
});

describe('POST /subscription/receipt upload hardening', () => {
  it('stores a real PNG uploaded as "x.html" under a .png name', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PAYMENT_ID, user_id: TEST_USER.userId, status: 'pending' }] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await post().attach('receipt', PNG, { filename: 'x.html', contentType: 'image/png' });

    expect(res.status).toBe(200);
    const list = files();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatch(/^550e8400-e29b-41d4-a716-446655440000-\d{13}-[0-9a-f]{8}\.png$/);
    expect(list[0].startsWith(TEST_USER.userId)).toBe(true);
    const update = mockQuery.mock.calls[1];
    expect(update[1][0]).toBe(`/uploads/receipts/${list[0]}`);
    expect(RECEIPTS_DIR.startsWith(uploadRoot)).toBe(true);
  });

  it('removes the file when the payment belongs to someone else', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: PAYMENT_ID, user_id: '660e8400-e29b-41d4-a716-446655440000', status: 'pending' }],
    });
    const res = await post().attach('receipt', PNG, { filename: 'r.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PAYMENT_FORBIDDEN');
    await vi.waitFor(() => expect(files()).toEqual([]));
  });

  it('removes the file when paymentId fails validation', async () => {
    const res = await post('nope').attach('receipt', PNG, { filename: 'r.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await vi.waitFor(() => expect(files()).toEqual([]));
  });

  it('rejects text posing as image/png', async () => {
    const res = await post().attach('receipt', Buffer.from('<?php echo 1; ?>'), {
      filename: 'r.png',
      contentType: 'image/png',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_CONTENT');
    await vi.waitFor(() => expect(files()).toEqual([]));
  });

  it('returns 413 VALIDATION_ERROR for a file over 5 MB', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 1 - PNG.length)]);
    const res = await post().attach('receipt', big, { filename: 'r.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await vi.waitFor(() => expect(files()).toEqual([]));
  });

  it('returns 400 VALIDATION_ERROR for a truncated multipart body', async () => {
    const res = await request(app)
      .post('/api/v1/subscription/receipt')
      .set(authHeader())
      .set('Content-Type', 'multipart/form-data; boundary=x')
      .send('--x\r\nContent-Disposition: form-data; name="receipt"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nabc');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await vi.waitFor(() => expect(files()).toEqual([]));
  });

  it('returns 400 VALIDATION_ERROR for two files in one request', async () => {
    const res = await post()
      .attach('receipt', PNG, { filename: 'a.png', contentType: 'image/png' })
      .attach('receipt', PNG, { filename: 'b.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await vi.waitFor(() => expect(files()).toEqual([]));
  });
});
